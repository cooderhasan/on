import "server-only";
import Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { VOID_EDOC } from "@/lib/edoc-status";
import { EXPENSE_KIND_LABELS } from "./expenses";
import { invoicePaid, invoiceSign } from "./ledger";
import { startOfToday } from "./invoices";

/**
 * Rapor kuralları (tek yer):
 *  - Tutarlar TL: dövizli belge × belge kuru. Kasa / banka raporları hesabın kendi dövizinde.
 *  - Satış = satış faturaları − satış iadeleri; gider = alış faturaları − alış iadeleri + fatura dışı giderler.
 *  - Gelir / gider KDV hariç (matrah); KDV raporu belge KDV'si (tevkifat ayrı sütun).
 *  - Reddedilen / iptal edilen e-belgeler hiçbir rapora girmez.
 *  - Tarih: belge düzenleme tarihi (fatura / gider), hareket tarihi (tahsilat / ödeme).
 */

const D = (v: { toString(): string } | null | undefined) => new Decimal(v?.toString() ?? 0);
const ZERO = new Decimal(0);
const tl = (v: { toString(): string }, rate: { toString(): string }) => D(v).times(D(rate)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

export interface Period { from: string; to: string }

/** Varsayılan dönem: bu yılın başı → bugün */
export function resolvePeriod(from?: string, to?: string): Period {
  const today = startOfToday().toISOString().slice(0, 10);
  const ok = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const t = ok(to) ?? today;
  const f = ok(from) ?? `${t.slice(0, 4)}-01-01`;
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

const range = (p: Period) => ({ gte: new Date(p.from), lte: new Date(p.to) });

/** Dönemdeki ayların anahtarları (2026-01 …) */
export function monthsBetween(p: Period): string[] {
  const out: string[] = [];
  let y = Number(p.from.slice(0, 4));
  let m = Number(p.from.slice(5, 7));
  const end = p.to.slice(0, 7);
  for (let i = 0; i < 240; i++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push(k);
    if (k >= end) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

const validInvoice = (direction: "SALE" | "PURCHASE", p?: Period): Prisma.InvoiceWhereInput => ({
  direction,
  eDocStatus: { notIn: [...VOID_EDOC] },
  ...(p ? { issueDate: range(p) } : {}),
});

export interface GroupRow { key: string; label: string; href?: string; net: Decimal; vat: Decimal; total: Decimal; count: number; quantity?: Decimal }

function addTo(map: Map<string, GroupRow>, key: string, label: string, href: string | undefined, net: Decimal, vat: Decimal, total: Decimal, qty?: Decimal) {
  const r = map.get(key) ?? { key, label, href, net: ZERO, vat: ZERO, total: ZERO, count: 0, quantity: qty ? ZERO : undefined };
  r.net = r.net.plus(net);
  r.vat = r.vat.plus(vat);
  r.total = r.total.plus(total);
  r.count++;
  if (qty) r.quantity = (r.quantity ?? ZERO).plus(qty);
  map.set(key, r);
}

function finish(map: Map<string, GroupRow>, sortByKey: boolean) {
  const rows = [...map.values()].sort((a, b) => (sortByKey ? a.key.localeCompare(b.key) : b.net.comparedTo(a.net)));
  const totals = rows.reduce((t, r) => ({ net: t.net.plus(r.net), vat: t.vat.plus(r.vat), total: t.total.plus(r.total) }), { net: ZERO, vat: ZERO, total: ZERO });
  return { rows, totals };
}

// ── Satışlar ───────────────────────────────────────────────

export type SalesGroup = "month" | "customer" | "product" | "category";

export async function salesReport(user: CurrentUser, p: Period, group: SalesGroup) {
  assertCan(user, "reports.read");
  const invoices = await db.invoice.findMany({
    where: validInvoice("SALE", p),
    select: {
      id: true, kind: true, issueDate: true, exchangeRate: true, netTotal: true, vatTotal: true, grandTotal: true,
      contact: { select: { id: true, title: true } }, category: { select: { id: true, name: true } },
      // Satırlar yalnızca ürün bazında gruplamada gerekir
      lines: { where: group === "product" ? {} : { id: "-" }, select: { productId: true, name: true, quantity: true, netAmount: true, vatAmount: true, totalAmount: true, product: { select: { name: true } } } },
    },
  });
  const map = new Map<string, GroupRow>();
  for (const i of invoices) {
    const s = invoiceSign("SALE", i.kind);
    const net = tl(i.netTotal, i.exchangeRate).times(s);
    const vat = tl(i.vatTotal, i.exchangeRate).times(s);
    const total = tl(i.grandTotal, i.exchangeRate).times(s);
    if (group === "month") { const k = monthKey(i.issueDate); addTo(map, k, monthLabel(k), undefined, net, vat, total); }
    else if (group === "customer") addTo(map, i.contact.id, i.contact.title, `/musteriler/${i.contact.id}`, net, vat, total);
    else if (group === "category") addTo(map, i.category?.id ?? "-", i.category?.name ?? "Kategorisiz", undefined, net, vat, total);
    else {
      for (const l of i.lines) {
        const k = l.productId ?? `ad:${l.name}`;
        addTo(map, k, l.product?.name ?? l.name, l.productId ? `/hizmet-ve-urunler/${l.productId}` : undefined, tl(l.netAmount, i.exchangeRate).times(s), tl(l.vatAmount, i.exchangeRate).times(s), tl(l.totalAmount, i.exchangeRate).times(s), D(l.quantity).times(s));
      }
    }
  }
  return finish(map, group === "month");
}

// ── Giderler ───────────────────────────────────────────────

export type ExpenseGroup = "month" | "supplier" | "category" | "kind";

export async function expenseReport(user: CurrentUser, p: Period, group: ExpenseGroup) {
  assertCan(user, "reports.read");
  const [invoices, expenses] = await Promise.all([
    db.invoice.findMany({
      where: validInvoice("PURCHASE", p),
      select: { kind: true, issueDate: true, exchangeRate: true, netTotal: true, vatTotal: true, grandTotal: true, contact: { select: { id: true, title: true } }, category: { select: { id: true, name: true } } },
    }),
    db.expense.findMany({
      where: { date: range(p) },
      select: { kind: true, date: true, netAmount: true, vatAmount: true, totalAmount: true, contact: { select: { id: true, title: true } }, employee: { select: { id: true, name: true } }, category: { select: { id: true, name: true } } },
    }),
  ]);
  const map = new Map<string, GroupRow>();
  for (const i of invoices) {
    const s = -invoiceSign("PURCHASE", i.kind); // alış faturası +, alış iadesi −
    const [net, vat, total] = [tl(i.netTotal, i.exchangeRate).times(s), tl(i.vatTotal, i.exchangeRate).times(s), tl(i.grandTotal, i.exchangeRate).times(s)];
    if (group === "month") { const k = monthKey(i.issueDate); addTo(map, k, monthLabel(k), undefined, net, vat, total); }
    else if (group === "supplier") addTo(map, i.contact.id, i.contact.title, `/tedarikciler/${i.contact.id}`, net, vat, total);
    else if (group === "category") addTo(map, i.category?.id ?? "-", i.category?.name ?? "Kategorisiz", undefined, net, vat, total);
    else addTo(map, "INVOICE", "Alış faturası", undefined, net, vat, total);
  }
  for (const e of expenses) {
    const [net, vat, total] = [D(e.netAmount), D(e.vatAmount), D(e.totalAmount)];
    if (group === "month") { const k = monthKey(e.date); addTo(map, k, monthLabel(k), undefined, net, vat, total); }
    else if (group === "supplier") {
      if (e.contact) addTo(map, e.contact.id, e.contact.title, `/tedarikciler/${e.contact.id}`, net, vat, total);
      else if (e.employee) addTo(map, `emp:${e.employee.id}`, e.employee.name, `/calisanlar/${e.employee.id}`, net, vat, total);
      else addTo(map, "-", "Carisiz", undefined, net, vat, total);
    } else if (group === "category") addTo(map, e.category?.id ?? "-", e.category?.name ?? "Kategorisiz", undefined, net, vat, total);
    else addTo(map, e.kind, EXPENSE_KIND_LABELS[e.kind], undefined, net, vat, total);
  }
  return finish(map, group === "month");
}

// ── Gelir / gider ──────────────────────────────────────────

export async function incomeExpenseReport(user: CurrentUser, p: Period) {
  const [sales, expenses] = await Promise.all([salesReport(user, p, "month"), expenseReport(user, p, "month")]);
  const rows = monthsBetween(p).map((k) => {
    const income = sales.rows.find((r) => r.key === k)?.net ?? ZERO;
    const expense = expenses.rows.find((r) => r.key === k)?.net ?? ZERO;
    return { key: k, label: monthLabel(k), income, expense, profit: income.minus(expense) };
  });
  const totals = { income: sales.totals.net, expense: expenses.totals.net, profit: sales.totals.net.minus(expenses.totals.net) };
  return { rows, totals };
}

// ── KDV ────────────────────────────────────────────────────

export interface VatRow { key: string; label: string; output: Decimal; input: Decimal; outputWithholding: Decimal; inputWithholding: Decimal; net: Decimal }

/** Hesaplanan (satış) − indirilecek (alış + fiş) KDV, aylara göre */
export async function vatReport(user: CurrentUser, p: Period) {
  assertCan(user, "reports.read");
  const [sales, purchases, expenses] = await Promise.all([
    db.invoice.findMany({ where: validInvoice("SALE", p), select: { kind: true, issueDate: true, exchangeRate: true, vatTotal: true, withholdingTotal: true } }),
    db.invoice.findMany({ where: validInvoice("PURCHASE", p), select: { kind: true, issueDate: true, exchangeRate: true, vatTotal: true, withholdingTotal: true } }),
    db.expense.findMany({ where: { date: range(p), vatAmount: { gt: 0 } }, select: { date: true, vatAmount: true } }),
  ]);
  const map = new Map<string, VatRow>(monthsBetween(p).map((k) => [k, { key: k, label: monthLabel(k), output: ZERO, input: ZERO, outputWithholding: ZERO, inputWithholding: ZERO, net: ZERO }]));
  const row = (d: Date) => map.get(monthKey(d))!;
  for (const i of sales) {
    const r = row(i.issueDate);
    const s = invoiceSign("SALE", i.kind);
    r.output = r.output.plus(tl(i.vatTotal, i.exchangeRate).times(s));
    r.outputWithholding = r.outputWithholding.plus(tl(i.withholdingTotal, i.exchangeRate).times(s));
  }
  for (const i of purchases) {
    const r = row(i.issueDate);
    const s = -invoiceSign("PURCHASE", i.kind);
    r.input = r.input.plus(tl(i.vatTotal, i.exchangeRate).times(s));
    r.inputWithholding = r.inputWithholding.plus(tl(i.withholdingTotal, i.exchangeRate).times(s));
  }
  for (const e of expenses) { const r = row(e.date); r.input = r.input.plus(D(e.vatAmount)); }
  const rows = [...map.values()].map((r) => ({ ...r, net: r.output.minus(r.input) }));
  const totals = rows.reduce(
    (t, r) => ({ output: t.output.plus(r.output), input: t.input.plus(r.input), outputWithholding: t.outputWithholding.plus(r.outputWithholding), inputWithholding: t.inputWithholding.plus(r.inputWithholding), net: t.net.plus(r.net) }),
    { output: ZERO, input: ZERO, outputWithholding: ZERO, inputWithholding: ZERO, net: ZERO },
  );
  return { rows, totals };
}

export interface VatDetailRow { kind: string; docNo: string | null; name: string; party: string; date: Date; href: string; vat: Decimal; side: "SALE" | "PURCHASE" }

/** Seçili ayın KDV dökümü (belge belge) */
export async function vatDetail(user: CurrentUser, month: string) {
  assertCan(user, "reports.read");
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const start = new Date(`${month}-01`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const p = { gte: start, lte: end };
  const [invoices, expenses] = await Promise.all([
    db.invoice.findMany({ where: { eDocStatus: { notIn: [...VOID_EDOC] }, issueDate: p, vatTotal: { not: 0 } }, orderBy: { issueDate: "asc" }, select: { id: true, direction: true, kind: true, invoiceNo: true, name: true, issueDate: true, exchangeRate: true, vatTotal: true, contact: { select: { title: true } } } }),
    db.expense.findMany({ where: { date: p, vatAmount: { gt: 0 } }, orderBy: { date: "asc" }, select: { id: true, description: true, receiptNo: true, date: true, vatAmount: true, contact: { select: { title: true } } } }),
  ]);
  const rows: VatDetailRow[] = [
    ...invoices.map((i) => ({
      kind: i.direction === "SALE" ? (i.kind === "RETURN" ? "Satış iadesi" : "Satış faturası") : i.kind === "RETURN" ? "Alış iadesi" : "Alış faturası",
      docNo: i.invoiceNo, name: i.name ?? "", party: i.contact.title, date: i.issueDate, href: `${i.direction === "SALE" ? "/satislar" : "/giderler"}/${i.id}`,
      vat: tl(i.vatTotal, i.exchangeRate).times(i.kind === "RETURN" ? -1 : 1), side: i.direction,
    })),
    ...expenses.map((e) => ({ kind: "Fiş / fatura", docNo: e.receiptNo, name: e.description, party: e.contact?.title ?? "—", date: e.date, href: `/giderler/kayit/${e.id}`, vat: D(e.vatAmount), side: "PURCHASE" as const })),
  ];
  return rows.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ── Açık alacak / borçlar (vade yaşlandırma) ───────────────

export interface OpenItem { id: string; kind: string; title: string; party: string; partyHref?: string; href: string; date: Date; dueDate: Date; currency: string; remaining: Decimal; remainingTl: Decimal }

/** Kalanı olan satış faturaları (alacak) */
export async function openReceivables(): Promise<OpenItem[]> {
  const invs = await db.invoice.findMany({
    where: { ...validInvoice("SALE"), kind: "INVOICE" },
    select: { id: true, name: true, invoiceNo: true, issueDate: true, dueDate: true, currency: true, exchangeRate: true, payableTotal: true, contact: { select: { id: true, title: true } } },
  });
  const paid = await invoicePaid(invs.map((i) => i.id));
  return invs
    .map((i) => {
      const remaining = D(i.payableTotal).minus(paid.get(i.id)!);
      return { id: i.id, kind: "Satış faturası", title: i.name || i.invoiceNo || "Satış faturası", party: i.contact.title, partyHref: `/musteriler/${i.contact.id}`, href: `/satislar/${i.id}`, date: i.issueDate, dueDate: i.dueDate, currency: i.currency, remaining, remainingTl: tl(remaining, i.exchangeRate) };
    })
    .filter((i) => i.remaining.greaterThan(0));
}

/** Kalanı olan alış faturaları ve fatura dışı giderler (borç) */
export async function openPayables(): Promise<OpenItem[]> {
  const [invs, exps] = await Promise.all([
    db.invoice.findMany({
      where: { ...validInvoice("PURCHASE"), kind: "INVOICE" },
      select: { id: true, name: true, invoiceNo: true, issueDate: true, dueDate: true, currency: true, exchangeRate: true, payableTotal: true, contact: { select: { id: true, title: true } } },
    }),
    db.expense.findMany({ select: { id: true, kind: true, description: true, date: true, dueDate: true, currency: true, totalAmount: true, contact: { select: { id: true, title: true } }, employee: { select: { id: true, name: true } }, transactions: { select: { appliedAmount: true } } } }),
  ]);
  const paid = await invoicePaid(invs.map((i) => i.id));
  const a: OpenItem[] = invs.map((i) => {
    const remaining = D(i.payableTotal).minus(paid.get(i.id)!);
    return { id: i.id, kind: "Alış faturası", title: i.name || i.invoiceNo || "Alış faturası", party: i.contact.title, partyHref: `/tedarikciler/${i.contact.id}`, href: `/giderler/${i.id}`, date: i.issueDate, dueDate: i.dueDate, currency: i.currency, remaining, remainingTl: tl(remaining, i.exchangeRate) };
  });
  const b: OpenItem[] = exps.map((e) => {
    const remaining = D(e.totalAmount).minus(e.transactions.reduce((s, t) => s.plus(D(t.appliedAmount)), ZERO));
    return {
      id: e.id, kind: EXPENSE_KIND_LABELS[e.kind], title: e.description, party: e.contact?.title ?? e.employee?.name ?? "—",
      partyHref: e.contact ? `/tedarikciler/${e.contact.id}` : e.employee ? `/calisanlar/${e.employee.id}` : undefined, href: `/giderler/kayit/${e.id}`,
      date: e.date, dueDate: e.dueDate, currency: e.currency, remaining, remainingTl: remaining,
    };
  });
  return [...a, ...b].filter((i) => i.remaining.greaterThan(0));
}

export const AGING_BUCKETS = [
  { key: "future", label: "Vadesi gelmemiş" },
  { key: "d30", label: "1–30 gün gecikmiş" },
  { key: "d60", label: "31–60 gün gecikmiş" },
  { key: "d90", label: "61–90 gün gecikmiş" },
  { key: "d90p", label: "90+ gün gecikmiş" },
] as const;

export const daysLate = (due: Date, today = startOfToday()) => Math.round((today.getTime() - due.getTime()) / 86_400_000);

export function aging(items: OpenItem[]) {
  const today = startOfToday();
  const sums = new Map<string, Decimal>(AGING_BUCKETS.map((b) => [b.key, ZERO]));
  for (const i of items) {
    const d = daysLate(i.dueDate, today);
    const k = d <= 0 ? "future" : d <= 30 ? "d30" : d <= 60 ? "d60" : d <= 90 ? "d90" : "d90p";
    sums.set(k, sums.get(k)!.plus(i.remainingTl));
  }
  const total = [...sums.values()].reduce((a, b) => a.plus(b), ZERO);
  return { buckets: AGING_BUCKETS.map((b) => ({ ...b, amount: sums.get(b.key)! })), total, overdue: total.minus(sums.get("future")!) };
}

/** Cari bazında açık tutar (en büyükten) */
export function byParty(items: OpenItem[]) {
  const m = new Map<string, { party: string; href?: string; amount: Decimal; overdue: Decimal; count: number }>();
  const today = startOfToday();
  for (const i of items) {
    const r = m.get(i.party) ?? { party: i.party === "—" ? "Carisiz giderler" : i.party, href: i.partyHref, amount: ZERO, overdue: ZERO, count: 0 };
    r.amount = r.amount.plus(i.remainingTl);
    if (i.dueDate < today) r.overdue = r.overdue.plus(i.remainingTl);
    r.count++;
    m.set(i.party, r);
  }
  return [...m.values()].sort((a, b) => b.amount.comparedTo(a.amount));
}

/** Dönemdeki tahsilat / ödemeler (hesap dövizinde; çek ile tahsilat / ödeme dahil) */
export async function settlementsReport(user: CurrentUser, p: Period, type: "COLLECTION" | "PAYMENT") {
  assertCan(user, "reports.read");
  const txs = await db.transaction.findMany({
    where: { type, date: range(p) },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: {
      id: true, date: true, amount: true, appliedAmount: true, description: true, chequeId: true,
      account: { select: { id: true, name: true, currency: true } },
      contact: { select: { id: true, title: true, kind: true, currency: true } },
      employee: { select: { id: true, name: true } },
      invoice: { select: { id: true, direction: true, invoiceNo: true, name: true, currency: true } },
      expense: { select: { id: true, description: true } },
      cheque: { select: { id: true, chequeNo: true, currency: true } },
    },
  });
  const rows = txs.map((t) => {
    const currency = t.account?.currency ?? t.cheque?.currency ?? t.invoice?.currency ?? t.contact?.currency ?? "TRY";
    return { ...t, currency, value: t.account ? D(t.amount) : D(t.appliedAmount) };
  });
  const byMonth = new Map<string, Map<string, Decimal>>();
  const totals = new Map<string, Decimal>();
  for (const r of rows) {
    const k = monthKey(r.date);
    const m = byMonth.get(k) ?? new Map<string, Decimal>();
    m.set(r.currency, (m.get(r.currency) ?? ZERO).plus(r.value));
    byMonth.set(k, m);
    totals.set(r.currency, (totals.get(r.currency) ?? ZERO).plus(r.value));
  }
  return {
    rows,
    months: monthsBetween(p).map((k) => ({ key: k, label: monthLabel(k), amounts: [...(byMonth.get(k) ?? new Map())].map(([currency, amount]) => ({ currency, amount })) })),
    totals: [...totals].map(([currency, amount]) => ({ currency, amount })),
  };
}

// ── Kasa / banka ───────────────────────────────────────────

/** Hesap başına dönem başı, giriş, çıkış, dönem sonu (hesap dövizinde) */
export async function cashReport(user: CurrentUser, p: Period) {
  assertCan(user, "reports.read");
  const accounts = await db.account.findMany({ where: { isArchived: false }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true, currency: true, openingBalance: true } });
  const txs = await db.transaction.findMany({
    where: { date: { lte: new Date(p.to) }, OR: [{ accountId: { not: null } }, { targetAccountId: { not: null } }] },
    select: { type: true, date: true, accountId: true, targetAccountId: true, amount: true, targetAmount: true },
  });
  const from = new Date(p.from);
  const rows = accounts.map((a) => {
    let opening = D(a.openingBalance);
    let inflow = ZERO;
    let outflow = ZERO;
    for (const t of txs) {
      let delta: Decimal | null = null;
      if (t.type === "TRANSFER") {
        if (t.accountId === a.id) delta = D(t.amount).negated();
        else if (t.targetAccountId === a.id) delta = D(t.targetAmount);
      } else if (t.accountId === a.id) delta = t.type === "COLLECTION" || t.type === "DEPOSIT" ? D(t.amount) : D(t.amount).negated();
      if (!delta) continue;
      if (t.date < from) opening = opening.plus(delta);
      else if (delta.isNegative()) outflow = outflow.plus(delta.abs());
      else inflow = inflow.plus(delta);
    }
    return { ...a, opening, inflow, outflow, closing: opening.plus(inflow).minus(outflow) };
  });
  return rows;
}

// ── Nakit akışı ────────────────────────────────────────────

/**
 * Geçmiş aylar: TL hesaplara fiilen giren / çıkan (virman hariç).
 * Gelecek aylar: açık alacak / borçların vadeleri + portföydeki / ödenecek çekler (TL karşılığı).
 */
export async function cashFlowReport(user: CurrentUser, back = 3, forward = 3) {
  assertCan(user, "reports.read");
  const today = startOfToday();
  const thisMonth = monthKey(today);
  const shift = (k: string, n: number) => {
    const d = new Date(`${k}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    return monthKey(d);
  };
  const pastKeys = Array.from({ length: back }, (_, i) => shift(thisMonth, i - back + 1));
  const futureKeys = Array.from({ length: forward }, (_, i) => shift(thisMonth, i + 1));
  const [txs, receivables, payables, cheques] = await Promise.all([
    pastKeys.length
      ? db.transaction.findMany({ where: { date: { gte: new Date(`${pastKeys[0]}-01T00:00:00Z`), lte: today }, type: { not: "TRANSFER" }, account: { currency: "TRY" } }, select: { type: true, date: true, amount: true } })
      : Promise.resolve([]),
    openReceivables(),
    openPayables(),
    db.cheque.findMany({ where: { status: { in: ["PORTFOLIO", "PENDING"] } }, select: { direction: true, dueDate: true, amount: true, currency: true } }),
  ]);
  const past = pastKeys.map((k) => ({ key: k, label: monthLabel(k), inflow: ZERO, outflow: ZERO }));
  for (const t of txs) {
    const r = past.find((x) => x.key === monthKey(t.date));
    if (!r) continue;
    if (t.type === "COLLECTION" || t.type === "DEPOSIT") r.inflow = r.inflow.plus(D(t.amount));
    else r.outflow = r.outflow.plus(D(t.amount));
  }
  // Gelecek: gecikmişler "bu ay" sayılır (hemen tahsil / ödeme beklenir)
  const futureAll = [thisMonth, ...futureKeys];
  const future = futureAll.map((k) => ({ key: k, label: k === thisMonth ? `${monthLabel(k)} (gecikmişler dahil)` : monthLabel(k), inflow: ZERO, outflow: ZERO }));
  const bucket = (d: Date) => {
    const k = monthKey(d) < thisMonth ? thisMonth : monthKey(d);
    return future.find((x) => x.key === k);
  };
  for (const i of receivables) { const r = bucket(i.dueDate); if (r) r.inflow = r.inflow.plus(i.remainingTl); }
  for (const i of payables) { const r = bucket(i.dueDate); if (r) r.outflow = r.outflow.plus(i.remainingTl); }
  for (const c of cheques) {
    if (c.currency !== "TRY") continue;
    const r = bucket(c.dueDate);
    if (!r) continue;
    if (c.direction === "RECEIVED") r.inflow = r.inflow.plus(D(c.amount));
    else r.outflow = r.outflow.plus(D(c.amount));
  }
  return { past: past.map((r) => ({ ...r, net: r.inflow.minus(r.outflow) })), future: future.map((r) => ({ ...r, net: r.inflow.minus(r.outflow) })) };
}

// ── Stoktaki ürünler ───────────────────────────────────────

export async function stockReport(user: CurrentUser, warehouseId?: string) {
  assertCan(user, "reports.read");
  const products = await db.product.findMany({ where: { isArchived: false, trackStock: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true, stockQuantity: true, criticalStock: true, buyPrice: true, buyCurrency: true, sellPrice: true, sellCurrency: true } });
  let qty = new Map(products.map((p) => [p.id, D(p.stockQuantity)]));
  if (warehouseId) {
    const g = await db.stockMovement.groupBy({ by: ["productId"], where: { warehouseId }, _sum: { quantity: true } });
    qty = new Map(g.map((r) => [r.productId, D(r._sum.quantity)]));
  }
  const rows = products
    .map((p) => {
      const q = qty.get(p.id) ?? ZERO;
      const value = p.buyPrice ? q.times(D(p.buyPrice)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : null;
      return { ...p, quantity: q, value, critical: p.criticalStock !== null && D(p.stockQuantity).lessThanOrEqualTo(D(p.criticalStock)) };
    })
    .filter((r) => !r.quantity.isZero() || (!warehouseId && r.critical));
  const totals = new Map<string, Decimal>();
  for (const r of rows) if (r.value && r.quantity.greaterThan(0)) totals.set(r.buyCurrency, (totals.get(r.buyCurrency) ?? ZERO).plus(r.value));
  return { rows, totals: [...totals].map(([currency, total]) => ({ currency, total })) };
}
