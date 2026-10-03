import "server-only";
import Decimal from "decimal.js";
import { db } from "@/server/db";

/**
 * Bakiye kuralları (tek yer):
 *  Cari (+ = bize borçlu / tahsil edilecek, − = biz borçluyuz / ödenecek), cari para biriminde:
 *    açılış DEBIT +, CREDIT −
 *    satış faturası +ödenecek, satış iadesi −
 *    alış faturası −ödenecek, alış iadesi +
 *    tahsilat −uygulanan tutar, ödeme +uygulanan tutar
 *  Kasa / banka (hesap para biriminde):
 *    açılış + tahsilat + para girişi + gelen transfer − ödeme − para çıkışı − giden transfer
 *  Fatura kalan = ödenecek − (fatura yönüne uygun) bağlı hareketlerin uygulanan tutarı
 */

const D = (v: { toString(): string } | null | undefined) => new Decimal(v?.toString() ?? 0);

export function invoiceSign(direction: "SALE" | "PURCHASE", kind: "INVOICE" | "RETURN"): 1 | -1 {
  return (direction === "SALE") === (kind === "INVOICE") ? 1 : -1;
}

/** Birden çok carinin bakiyesi (liste ekranları için tek seferde) */
export async function contactBalances(ids: string[]): Promise<Map<string, Decimal>> {
  const out = new Map<string, Decimal>(ids.map((id) => [id, new Decimal(0)]));
  if (ids.length === 0) return out;
  const [contacts, invoices, txs] = await Promise.all([
    db.contact.findMany({ where: { id: { in: ids } }, select: { id: true, openingBalance: true, openingBalanceSide: true } }),
    db.invoice.groupBy({ by: ["contactId", "direction", "kind"], where: { contactId: { in: ids } }, _sum: { payableTotal: true } }),
    db.transaction.groupBy({ by: ["contactId", "type"], where: { contactId: { in: ids }, type: { in: ["COLLECTION", "PAYMENT"] } }, _sum: { appliedAmount: true } }),
  ]);
  const add = (id: string, v: Decimal) => out.set(id, (out.get(id) ?? new Decimal(0)).plus(v));
  for (const c of contacts) if (c.openingBalance) add(c.id, c.openingBalanceSide === "CREDIT" ? D(c.openingBalance).negated() : D(c.openingBalance));
  for (const i of invoices) add(i.contactId, D(i._sum.payableTotal).times(invoiceSign(i.direction, i.kind)));
  for (const t of txs) if (t.contactId) add(t.contactId, t.type === "COLLECTION" ? D(t._sum.appliedAmount).negated() : D(t._sum.appliedAmount));
  return out;
}

export async function contactBalance(id: string): Promise<Decimal> {
  return (await contactBalances([id])).get(id) ?? new Decimal(0);
}

export interface StatementRow {
  date: Date;
  kind: "OPENING" | "INVOICE" | "RETURN" | "COLLECTION" | "PAYMENT";
  label: string;
  href?: string;
  debit: Decimal;
  credit: Decimal;
  balance: Decimal;
}

/** Cari ekstre: tarih sırasıyla hareketler ve yürüyen bakiye */
export async function contactStatement(id: string): Promise<StatementRow[]> {
  const [c, invoices, txs] = await Promise.all([
    db.contact.findUniqueOrThrow({ where: { id }, select: { openingBalance: true, openingBalanceSide: true, openingBalanceDate: true, createdAt: true, kind: true } }),
    db.invoice.findMany({ where: { contactId: id }, select: { id: true, direction: true, kind: true, issueDate: true, name: true, invoiceNo: true, payableTotal: true, createdAt: true } }),
    db.transaction.findMany({ where: { contactId: id, type: { in: ["COLLECTION", "PAYMENT"] } }, select: { id: true, type: true, date: true, appliedAmount: true, description: true, invoiceId: true, createdAt: true, account: { select: { name: true } } } }),
  ]);
  type Raw = Omit<StatementRow, "balance"> & { sortKey: Date };
  const rows: Raw[] = [];
  if (c.openingBalance) {
    const v = D(c.openingBalance);
    const date = c.openingBalanceDate ?? c.createdAt;
    rows.push({ date, sortKey: new Date(0), kind: "OPENING", label: "Açılış bakiyesi", debit: c.openingBalanceSide === "CREDIT" ? new Decimal(0) : v, credit: c.openingBalanceSide === "CREDIT" ? v : new Decimal(0) });
  }
  for (const i of invoices) {
    const sign = invoiceSign(i.direction, i.kind);
    const v = D(i.payableTotal);
    const base = i.direction === "SALE" ? (i.kind === "RETURN" ? "Satış iadesi" : "Satış faturası") : i.kind === "RETURN" ? "Alış iadesi" : "Alış faturası";
    rows.push({
      date: i.issueDate,
      sortKey: i.createdAt,
      kind: i.kind === "RETURN" ? "RETURN" : "INVOICE",
      label: [base, i.invoiceNo, i.name].filter(Boolean).join(" · "),
      href: `${i.direction === "SALE" ? "/satislar" : "/giderler"}/${i.id}`,
      debit: sign > 0 ? v : new Decimal(0),
      credit: sign < 0 ? v : new Decimal(0),
    });
  }
  for (const t of txs) {
    const v = D(t.appliedAmount);
    rows.push({
      date: t.date,
      sortKey: t.createdAt,
      kind: t.type === "COLLECTION" ? "COLLECTION" : "PAYMENT",
      label: [t.type === "COLLECTION" ? "Tahsilat" : "Ödeme", t.account.name, t.description].filter(Boolean).join(" · "),
      debit: t.type === "PAYMENT" ? v : new Decimal(0),
      credit: t.type === "COLLECTION" ? v : new Decimal(0),
    });
  }
  rows.sort((a, b) => (a.kind === "OPENING" ? -1 : b.kind === "OPENING" ? 1 : a.date.getTime() - b.date.getTime() || a.sortKey.getTime() - b.sortKey.getTime()));
  let bal = new Decimal(0);
  return rows.map(({ sortKey: _s, ...r }) => {
    void _s;
    bal = bal.plus(r.debit).minus(r.credit);
    return { ...r, balance: bal };
  });
}

/** Faturaların tahsil / ödenen ve kalan tutarı */
export async function invoicePaid(ids: string[]): Promise<Map<string, Decimal>> {
  const out = new Map<string, Decimal>(ids.map((id) => [id, new Decimal(0)]));
  if (!ids.length) return out;
  const rows = await db.transaction.groupBy({ by: ["invoiceId"], where: { invoiceId: { in: ids } }, _sum: { appliedAmount: true } });
  for (const r of rows) if (r.invoiceId) out.set(r.invoiceId, D(r._sum.appliedAmount));
  return out;
}

/** Hesap bakiyeleri */
export async function accountBalances(ids: string[]): Promise<Map<string, Decimal>> {
  const out = new Map<string, Decimal>(ids.map((id) => [id, new Decimal(0)]));
  if (!ids.length) return out;
  const [accounts, outgoing, incoming] = await Promise.all([
    db.account.findMany({ where: { id: { in: ids } }, select: { id: true, openingBalance: true } }),
    db.transaction.groupBy({ by: ["accountId", "type"], where: { accountId: { in: ids } }, _sum: { amount: true } }),
    db.transaction.groupBy({ by: ["targetAccountId"], where: { targetAccountId: { in: ids }, type: "TRANSFER" }, _sum: { targetAmount: true } }),
  ]);
  const add = (id: string, v: Decimal) => out.set(id, (out.get(id) ?? new Decimal(0)).plus(v));
  for (const a of accounts) add(a.id, D(a.openingBalance));
  for (const t of outgoing) {
    const v = D(t._sum.amount);
    add(t.accountId, t.type === "COLLECTION" || t.type === "DEPOSIT" ? v : v.negated());
  }
  for (const t of incoming) if (t.targetAccountId) add(t.targetAccountId, D(t._sum.targetAmount));
  return out;
}
