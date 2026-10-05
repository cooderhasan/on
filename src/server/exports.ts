import "server-only";
import type { CurrentUser } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import { db } from "@/server/db";
import type { XlsxSheet } from "@/server/xlsx";
import {
  aging, byParty, cashFlowReport, cashReport, expenseReport, incomeExpenseReport, openPayables, openReceivables, resolvePeriod, salesReport, settlementsReport, stockReport, vatDetail, vatReport,
  type ExpenseGroup, type OpenItem, type SalesGroup,
} from "@/server/services/reports";
import { listInvoices, type PaymentFilter } from "@/server/services/invoices";
import { listExpenseRows } from "@/server/services/expenses";
import { listContacts } from "@/server/services/contacts";
import { listProducts } from "@/server/services/products";
import { CHEQUE_STATUS_LABELS } from "@/lib/cheque";
import { unitLabel } from "@/lib/units";

/** Dışa aktarılabilen ekranlar: /api/disa-aktar/<ad>?… (ekrandaki filtrelerle aynı parametreler) */

type Params = URLSearchParams;
const fmtDay = (s: string) => s.split("-").reverse().join(".");
const EDOC_LABEL: Record<string, string> = { NONE: "Kağıt / taslak", QUEUED: "Gönderiliyor", SENT: "Gönderildi", ACCEPTED: "Resmileşti", REJECTED: "Reddedildi", FAILED: "Gönderilemedi", CANCELLED: "İptal" };
const SALES_GROUPS: Record<SalesGroup, string> = { month: "Ay", customer: "Müşteri", product: "Hizmet / ürün", category: "Kategori" };
const EXPENSE_GROUPS: Record<ExpenseGroup, string> = { month: "Ay", supplier: "Tedarikçi / çalışan", category: "Kategori", kind: "Gider türü" };

const openSheet = (name: string, items: OpenItem[]): XlsxSheet => ({
  name,
  columns: [{ header: "Tür", width: 16 }, { header: "Kayıt", width: 30 }, { header: "Cari", width: 30 }, { header: "Tarih", type: "date" }, { header: "Vade", type: "date" }, { header: "Döviz", width: 8 }, { header: "Kalan", type: "money" }, { header: "Kalan (TL)", type: "money" }],
  rows: items.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()).map((i) => [i.kind, i.title, i.party, i.date, i.dueDate, i.currency, i.remaining, i.remainingTl]),
});

export const EXPORTS: Record<string, (user: CurrentUser, q: Params) => Promise<{ file: string; sheets: XlsxSheet[] }>> = {
  async "rapor-satislar"(user, q) {
    const p = resolvePeriod(q.get("baslangic") ?? undefined, q.get("bitis") ?? undefined);
    const group = (q.get("grup") as SalesGroup) in SALES_GROUPS ? (q.get("grup") as SalesGroup) : "month";
    const r = await salesReport(user, p, group);
    return {
      file: "satislar-raporu",
      sheets: [{
        name: "Satışlar", title: `Satışlar raporu · ${fmtDay(p.from)} – ${fmtDay(p.to)} · ${SALES_GROUPS[group]} bazında (TL)`,
        columns: [{ header: SALES_GROUPS[group], width: 36 }, ...(group === "product" ? [{ header: "Miktar", type: "number" as const }] : [{ header: "Belge", type: "number" as const, width: 8 }]), { header: "KDV hariç", type: "money" }, { header: "KDV", type: "money" }, { header: "Toplam", type: "money" }],
        rows: r.rows.map((x) => [x.label, group === "product" ? x.quantity : x.count, x.net, x.vat, x.total]),
        totals: ["Toplam", null, r.totals.net, r.totals.vat, r.totals.total],
      }],
    };
  },
  async "rapor-giderler"(user, q) {
    const p = resolvePeriod(q.get("baslangic") ?? undefined, q.get("bitis") ?? undefined);
    const group = (q.get("grup") as ExpenseGroup) in EXPENSE_GROUPS ? (q.get("grup") as ExpenseGroup) : "month";
    const r = await expenseReport(user, p, group);
    return {
      file: "giderler-raporu",
      sheets: [{
        name: "Giderler", title: `Giderler raporu · ${fmtDay(p.from)} – ${fmtDay(p.to)} · ${EXPENSE_GROUPS[group]} bazında (TL)`,
        columns: [{ header: EXPENSE_GROUPS[group], width: 36 }, { header: "Kayıt", type: "number", width: 8 }, { header: "KDV hariç", type: "money" }, { header: "KDV", type: "money" }, { header: "Toplam", type: "money" }],
        rows: r.rows.map((x) => [x.label, x.count, x.net, x.vat, x.total]),
        totals: ["Toplam", null, r.totals.net, r.totals.vat, r.totals.total],
      }],
    };
  },
  async "rapor-gelir-gider"(user, q) {
    const p = resolvePeriod(q.get("baslangic") ?? undefined, q.get("bitis") ?? undefined);
    const r = await incomeExpenseReport(user, p);
    return {
      file: "gelir-gider-raporu",
      sheets: [{
        name: "Gelir gider", title: `Gelir gider raporu · ${fmtDay(p.from)} – ${fmtDay(p.to)} (KDV hariç, TL)`,
        columns: [{ header: "Ay", width: 18 }, { header: "Gelir", type: "money" }, { header: "Gider", type: "money" }, { header: "Fark", type: "money" }],
        rows: r.rows.map((x) => [x.label, x.income, x.expense, x.profit]),
        totals: ["Toplam", r.totals.income, r.totals.expense, r.totals.profit],
      }],
    };
  },
  async "rapor-kdv"(user, q) {
    const p = resolvePeriod(q.get("baslangic") ?? undefined, q.get("bitis") ?? undefined);
    const r = await vatReport(user, p);
    const sheets: XlsxSheet[] = [{
      name: "Aylara göre KDV", title: `KDV raporu · ${fmtDay(p.from)} – ${fmtDay(p.to)} (TL)`,
      columns: [{ header: "Ay", width: 18 }, { header: "Hesaplanan KDV", type: "money" }, { header: "İndirilecek KDV", type: "money" }, { header: "Net KDV", type: "money" }, { header: "Satış tevkifatı", type: "money" }, { header: "Alış tevkifatı", type: "money" }],
      rows: r.rows.map((x) => [x.label, x.output, x.input, x.net, x.outputWithholding, x.inputWithholding]),
      totals: ["Toplam", r.totals.output, r.totals.input, r.totals.net, r.totals.outputWithholding, r.totals.inputWithholding],
    }];
    const month = q.get("ay");
    if (month) {
      const d = await vatDetail(user, month);
      sheets.push({
        name: `KDV dökümü ${month}`,
        columns: [{ header: "İşlem türü", width: 16 }, { header: "Fatura / fiş no", width: 18 }, { header: "Kayıt ismi", width: 30 }, { header: "Cari", width: 30 }, { header: "Tarih", type: "date" }, { header: "KDV", type: "money" }],
        rows: d.map((x) => [x.kind, x.docNo, x.name, x.party, x.date, x.vat]),
      });
    }
    return { file: "kdv-raporu", sheets };
  },
  async "rapor-tahsilatlar"(user, q) {
    const p = resolvePeriod(q.get("baslangic") ?? undefined, q.get("bitis") ?? undefined);
    assertCan(user, "reports.read");
    const [open, done] = await Promise.all([openReceivables(), settlementsReport(user, p, "COLLECTION")]);
    const a = aging(open);
    return {
      file: "tahsilatlar-raporu",
      sheets: [
        { name: "Vade analizi", columns: [{ header: "Vade durumu", width: 24 }, { header: "Tutar (TL)", type: "money" }], rows: a.buckets.map((b) => [b.label, b.amount]), totals: ["Toplam", a.total] },
        { name: "Müşteri bazında", columns: [{ header: "Müşteri", width: 36 }, { header: "Açık", type: "money" }, { header: "Gecikmiş", type: "money" }], rows: byParty(open).map((x) => [x.party, x.amount, x.overdue]) },
        openSheet("Tahsil edilecekler", open),
        { name: "Tahsilatlar", title: `${fmtDay(p.from)} – ${fmtDay(p.to)}`, columns: [{ header: "Tarih", type: "date" }, { header: "Müşteri", width: 30 }, { header: "Hesap", width: 20 }, { header: "Açıklama", width: 30 }, { header: "Döviz", width: 8 }, { header: "Tutar", type: "money" }], rows: done.rows.map((t) => [t.date, t.contact?.title, t.account?.name ?? (t.cheque ? `Çek ${t.cheque.chequeNo}` : ""), t.description, t.currency, t.value]) },
      ],
    };
  },
  async "rapor-odemeler"(user, q) {
    const p = resolvePeriod(q.get("baslangic") ?? undefined, q.get("bitis") ?? undefined);
    assertCan(user, "reports.read");
    const [open, done] = await Promise.all([openPayables(), settlementsReport(user, p, "PAYMENT")]);
    const a = aging(open);
    return {
      file: "odemeler-raporu",
      sheets: [
        { name: "Vade analizi", columns: [{ header: "Vade durumu", width: 24 }, { header: "Tutar (TL)", type: "money" }], rows: a.buckets.map((b) => [b.label, b.amount]), totals: ["Toplam", a.total] },
        { name: "Cari bazında", columns: [{ header: "Tedarikçi / çalışan", width: 36 }, { header: "Açık", type: "money" }, { header: "Gecikmiş", type: "money" }], rows: byParty(open).map((x) => [x.party, x.amount, x.overdue]) },
        openSheet("Ödenecekler", open),
        { name: "Ödemeler", title: `${fmtDay(p.from)} – ${fmtDay(p.to)}`, columns: [{ header: "Tarih", type: "date" }, { header: "Cari / çalışan", width: 30 }, { header: "Hesap", width: 20 }, { header: "Açıklama", width: 30 }, { header: "Döviz", width: 8 }, { header: "Tutar", type: "money" }], rows: done.rows.map((t) => [t.date, t.contact?.title ?? t.employee?.name, t.account?.name ?? (t.cheque ? `Çek ${t.cheque.chequeNo}` : ""), t.description ?? t.expense?.description, t.currency, t.value]) },
      ],
    };
  },
  async "rapor-kasa-banka"(user, q) {
    const p = resolvePeriod(q.get("baslangic") ?? undefined, q.get("bitis") ?? undefined);
    const rows = await cashReport(user, p);
    return {
      file: "kasa-banka-raporu",
      sheets: [{
        name: "Kasa banka", title: `Kasa / banka raporu · ${fmtDay(p.from)} – ${fmtDay(p.to)}`,
        columns: [{ header: "Hesap", width: 28 }, { header: "Döviz", width: 8 }, { header: "Dönem başı", type: "money" }, { header: "Giriş", type: "money" }, { header: "Çıkış", type: "money" }, { header: "Dönem sonu", type: "money" }],
        rows: rows.map((a) => [a.name, a.currency, a.opening, a.inflow, a.outflow, a.closing]),
      }],
    };
  },
  async "rapor-nakit-akisi"(user) {
    const r = await cashFlowReport(user);
    const cols = [{ header: "Ay", width: 34 }, { header: "Giriş", type: "money" as const }, { header: "Çıkış", type: "money" as const }, { header: "Net", type: "money" as const }];
    return {
      file: "nakit-akisi-raporu",
      sheets: [
        { name: "Gerçekleşen", title: "Gerçekleşen (TL hesaplar, virman hariç)", columns: cols, rows: r.past.map((x) => [x.label, x.inflow, x.outflow, x.net]) },
        { name: "Beklenen", title: "Beklenen (açık faturalar, giderler ve çekler)", columns: cols, rows: r.future.map((x) => [x.label, x.inflow, x.outflow, x.net]) },
      ],
    };
  },
  async "rapor-stok"(user, q) {
    const r = await stockReport(user, q.get("depo") ?? undefined);
    return {
      file: "stoktaki-urunler",
      sheets: [{
        name: "Stoktaki ürünler",
        columns: [{ header: "Ürün", width: 36 }, { header: "Kod", width: 14 }, { header: "Miktar", type: "number" }, { header: "Birim", width: 8 }, { header: "Alış fiyatı", type: "money" }, { header: "Döviz", width: 8 }, { header: "Stok değeri", type: "money" }, { header: "Kritik", width: 8 }],
        rows: r.rows.map((x) => [x.name, x.code, x.quantity, unitLabel(x.unit), x.buyPrice, x.buyCurrency, x.value, x.critical ? "Evet" : ""]),
      }],
    };
  },
  async "satis-faturalari"(user, q) {
    const { rows } = await listInvoices(user, "SALE", { q: q.get("q") ?? undefined, payment: (q.get("durum") as PaymentFilter) ?? undefined, from: q.get("baslangic") ?? undefined, to: q.get("bitis") ?? undefined, all: true });
    return {
      file: "satis-faturalari",
      sheets: [{
        name: "Satış faturaları",
        columns: [{ header: "Fatura ismi", width: 28 }, { header: "Müşteri", width: 30 }, { header: "Fatura no", width: 18 }, { header: "Tür", width: 10 }, { header: "Tarih", type: "date" }, { header: "Vade", type: "date" }, { header: "e-Belge", width: 14 }, { header: "Döviz", width: 8 }, { header: "Toplam", type: "money" }, { header: "Kalan", type: "money" }],
        rows: rows.map((i) => [i.name, i.contact.title, i.invoiceNo, i.kind === "RETURN" ? "İade" : "Satış", i.issueDate, i.dueDate, EDOC_LABEL[i.eDocStatus] ?? i.eDocStatus, i.currency, i.payableTotal, i.remaining]),
      }],
    };
  },
  async "gider-listesi"(user, q) {
    const { rows } = await listExpenseRows(user, { q: q.get("q") ?? undefined, payment: (q.get("durum") as PaymentFilter) ?? undefined, all: true });
    return {
      file: "gider-listesi",
      sheets: [{
        name: "Giderler",
        columns: [{ header: "Kayıt ismi", width: 30 }, { header: "Tür", width: 18 }, { header: "Cari / çalışan", width: 30 }, { header: "Tarih", type: "date" }, { header: "Ödeme tarihi", type: "date" }, { header: "Döviz", width: 8 }, { header: "Toplam", type: "money" }, { header: "Kalan", type: "money" }],
        rows: rows.map((r) => [r.title, r.kindLabel, r.party, r.date, r.dueDate, r.currency, r.total, r.remaining]),
      }],
    };
  },
  async musteriler(user, q) { return contactsExport(user, "CUSTOMER", q); },
  async tedarikciler(user, q) { return contactsExport(user, "SUPPLIER", q); },
  async urunler(user, q) {
    const { rows } = await listProducts(user, { q: q.get("q") ?? undefined, all: true });
    return {
      file: "hizmet-ve-urunler",
      sheets: [{
        name: "Hizmet ve ürünler",
        columns: [{ header: "Adı", width: 36 }, { header: "Kod", width: 14 }, { header: "Barkod", width: 16 }, { header: "Birim", width: 8 }, { header: "Stok", type: "number" }, { header: "Alış (KDV hariç)", type: "money" }, { header: "Alış döviz", width: 8 }, { header: "Satış (KDV hariç)", type: "money" }, { header: "Satış döviz", width: 8 }, { header: "KDV %", type: "number", width: 8 }],
        rows: rows.map((p) => [p.name, p.code, p.barcode, unitLabel(p.unit), p.trackStock ? p.stockQuantity : null, p.buyPrice, p.buyCurrency, p.sellPrice, p.sellCurrency, p.vatRate]),
      }],
    };
  },
  async cekler(user) {
    assertCan(user, "cash.read");
    const rows = await db.cheque.findMany({ orderBy: { dueDate: "asc" }, include: { contact: { select: { title: true } }, endorsedTo: { select: { title: true } }, account: { select: { name: true } } } });
    return {
      file: "cekler",
      sheets: [{
        name: "Çekler",
        columns: [{ header: "Tür", width: 10 }, { header: "Cari", width: 30 }, { header: "Düzenleyen", width: 24 }, { header: "Çek no", width: 14 }, { header: "Banka", width: 18 }, { header: "Düzenleme", type: "date" }, { header: "Vade", type: "date" }, { header: "Durum", width: 14 }, { header: "Ciro / hesap", width: 24 }, { header: "Döviz", width: 8 }, { header: "Tutar", type: "money" }],
        rows: rows.map((c) => [c.direction === "RECEIVED" ? "Alınan" : "Verilen", c.contact.title, c.drawer, c.chequeNo, [c.bankName, c.branch].filter(Boolean).join(" / "), c.issueDate, c.dueDate, CHEQUE_STATUS_LABELS[c.status], c.endorsedTo?.title ?? c.account?.name, c.currency, c.amount]),
      }],
    };
  },
};

/** Tüm veriler (mali müşavir / arşiv): ana listeler + fatura satırları + kasa / banka hareketleri */
EXPORTS["tum-veriler"] = async (user) => {
  assertCan(user, "users.manage");
  const none = new URLSearchParams();
  const parts = await Promise.all([
    EXPORTS.musteriler!(user, none), EXPORTS.tedarikciler!(user, none), EXPORTS.urunler!(user, none),
    EXPORTS["satis-faturalari"]!(user, none), EXPORTS["gider-listesi"]!(user, none), EXPORTS.cekler!(user, none),
  ]);
  const [lines, txs] = await Promise.all([
    db.documentLine.findMany({
      where: { invoiceId: { not: null } },
      orderBy: [{ invoice: { issueDate: "asc" } }, { position: "asc" }],
      select: { name: true, quantity: true, unit: true, unitPrice: true, vatRate: true, netAmount: true, vatAmount: true, totalAmount: true, invoice: { select: { direction: true, kind: true, invoiceNo: true, issueDate: true, currency: true, contact: { select: { title: true } } } } },
    }),
    db.transaction.findMany({
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: { type: true, date: true, amount: true, appliedAmount: true, description: true, account: { select: { name: true, currency: true } }, targetAccount: { select: { name: true } }, contact: { select: { title: true } }, employee: { select: { name: true } }, invoice: { select: { invoiceNo: true } }, cheque: { select: { chequeNo: true } } },
    }),
  ]);
  const TX: Record<string, string> = { COLLECTION: "Tahsilat", PAYMENT: "Ödeme", TRANSFER: "Virman", DEPOSIT: "Para girişi", WITHDRAWAL: "Para çıkışı" };
  await audit({ userId: user.id, action: "backup.exported" });
  return {
    file: "tum-veriler",
    sheets: [
      ...parts.flatMap((p) => p.sheets),
      {
        name: "Fatura satırları",
        columns: [{ header: "Tür", width: 14 }, { header: "Fatura no", width: 18 }, { header: "Tarih", type: "date" }, { header: "Cari", width: 30 }, { header: "Hizmet / ürün", width: 30 }, { header: "Miktar", type: "number" }, { header: "Birim", width: 8 }, { header: "Birim fiyat", type: "money" }, { header: "KDV %", type: "number", width: 7 }, { header: "KDV hariç", type: "money" }, { header: "KDV", type: "money" }, { header: "Toplam", type: "money" }, { header: "Döviz", width: 7 }],
        rows: lines.map((l) => [l.invoice!.direction === "SALE" ? (l.invoice!.kind === "RETURN" ? "Satış iadesi" : "Satış") : l.invoice!.kind === "RETURN" ? "Alış iadesi" : "Alış", l.invoice!.invoiceNo, l.invoice!.issueDate, l.invoice!.contact.title, l.name, l.quantity, unitLabel(l.unit), l.unitPrice, l.vatRate, l.netAmount, l.vatAmount, l.totalAmount, l.invoice!.currency]),
      },
      {
        name: "Kasa banka hareketleri",
        columns: [{ header: "Tarih", type: "date" }, { header: "Tür", width: 12 }, { header: "Hesap", width: 22 }, { header: "Karşı hesap / cari", width: 30 }, { header: "Açıklama", width: 30 }, { header: "Döviz", width: 7 }, { header: "Tutar", type: "money" }],
        rows: txs.map((t) => [t.date, TX[t.type], t.account?.name ?? (t.cheque ? `Çek ${t.cheque.chequeNo}` : ""), t.targetAccount?.name ?? t.contact?.title ?? t.employee?.name, [t.description, t.invoice?.invoiceNo].filter(Boolean).join(" · "), t.account?.currency ?? "", t.account ? t.amount : t.appliedAmount]),
      },
    ],
  };
};

async function contactsExport(user: CurrentUser, kind: "CUSTOMER" | "SUPPLIER", q: Params) {
  const { rows } = await listContacts(user, kind, { q: q.get("q") ?? undefined, all: true });
  return {
    file: kind === "CUSTOMER" ? "musteriler" : "tedarikciler",
    sheets: [{
      name: kind === "CUSTOMER" ? "Müşteriler" : "Tedarikçiler",
      columns: [{ header: "Unvan", width: 36 }, { header: "VKN / TCKN", width: 14 }, { header: "Vergi dairesi", width: 18 }, { header: "Telefon", width: 16 }, { header: "E-posta", width: 26 }, { header: "İl", width: 12 }, { header: "Döviz", width: 8 }, { header: "Bakiye", type: "money" as const }],
      rows: rows.map((c) => [c.title, c.taxNumber, c.taxOffice, c.phone, c.email, c.city, c.currency, c.balance]),
    }],
  };
}
