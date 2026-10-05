import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { UserRole } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/server/auth/session";
import { documentHeaderSchema, type ParsedLine } from "@/lib/document-form";
import { accountSchema, contactSchema, productSchema } from "@/lib/validation";
import { createContact } from "@/server/services/contacts";
import { createProduct } from "@/server/services/products";
import { createAccount } from "@/server/services/accounts";
import { saveInvoice } from "@/server/services/invoices";
import { createSettlement, settlementSchema } from "@/server/services/transactions";
import { expenseSchema, saveExpense } from "@/server/services/expenses";
import { employeeSchema, saveEmployee } from "@/server/services/employees";
import {
  aging, cashReport, expenseReport, incomeExpenseReport, monthsBetween, openPayables, openReceivables, resolvePeriod, salesReport, stockReport, vatDetail, vatReport,
} from "@/server/services/reports";
import { EXPORTS } from "@/server/exports";
import { buildXlsx } from "@/server/xlsx";
import { resetDb } from "./helpers";

const rep = { ibans: [], people: [], invalidIban: null, invalidPersonEmail: null };
async function user(role: UserRole = "ADMIN"): Promise<CurrentUser> {
  const u = await db.user.create({ data: { email: `${role}-${Math.random()}@t.local`, name: role, passwordHash: "x:y", role } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, isActive: true };
}
const line = (o: Partial<ParsedLine> = {}): ParsedLine => ({
  productId: null, name: "Kalem", description: null, quantity: "1", unit: "C62", unitPrice: "100", discountType: null, discountValue: null,
  vatRate: 20, vatExemptionCode: null, otvRate: null, otvCode: null, withholdingRate: null, withholdingCode: null, ...o,
});
const P = { from: "2026-01-01", to: "2026-03-31" };

async function setup() {
  const u = await user();
  const customer = await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "Müşteri" }), rep);
  const usdCustomer = await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "Yabancı", currency: "USD" }), rep);
  const supplier = await createContact(u, contactSchema.parse({ kind: "SUPPLIER", title: "Tedarikçi" }), rep);
  const inv = (direction: "SALE" | "PURCHASE", contactId: string, issueDate: string, lines: ParsedLine[], o: Record<string, string> = {}) =>
    saveInvoice(u, null, { direction, header: documentHeaderSchema.parse({ contactId, issueDate, ...o }), lines, discount: { discountType: null, discountValue: null }, tagIds: [] });
  const jan = await inv("SALE", customer.id, "2026-01-10", [line({ unitPrice: "1000" })]); // 1000 + 200
  await inv("SALE", customer.id, "2026-02-05", [line({ unitPrice: "100" })], { kind: "RETURN" }); // −100 / −20
  await inv("SALE", usdCustomer.id, "2026-02-20", [line({ unitPrice: "100" })], { currency: "USD", exchangeRate: "30" }); // 3000 + 600 TL
  const rejected = await inv("SALE", customer.id, "2026-03-01", [line({ unitPrice: "5000" })]);
  await db.invoice.update({ where: { id: rejected }, data: { eDocStatus: "REJECTED" } });
  await inv("PURCHASE", supplier.id, "2026-01-15", [line({ unitPrice: "500" })]); // 500 + 100
  await saveExpense(u, null, expenseSchema.parse({ kind: "RECEIPT", description: "Yakıt", date: "2026-03-02", totalAmount: "120", vatRate: "20" })); // 100 + 20
  const emp = await saveEmployee(u, null, employeeSchema.parse({ name: "Usta" }));
  await saveExpense(u, null, expenseSchema.parse({ kind: "SALARY", description: "Maaş", date: "2026-03-31", employeeId: emp.id, totalAmount: "1000" }));
  return { u, customer, supplier, jan };
}

beforeEach(resetDb);

describe("raporlar", () => {
  it("satış / gider / gelir-gider: iade düşülür, döviz kurla TL, reddedilen e-belge hariç", async () => {
    const { u } = await setup();
    const s = await salesReport(u, P, "month");
    expect(s.totals.net.toString()).toBe("3900");
    expect(s.rows.map((r) => [r.key, r.net.toString()])).toEqual([["2026-01", "1000"], ["2026-02", "2900"]]);
    expect((await salesReport(u, P, "customer")).rows.map((r) => r.label)).toEqual(["Yabancı", "Müşteri"]);
    const e = await expenseReport(u, P, "kind");
    expect(e.totals.net.toString()).toBe("1600");
    expect(e.rows.map((r) => [r.label, r.net.toString()])).toEqual([["Maaş / prim", "1000"], ["Alış faturası", "500"], ["Fiş / fatura", "100"]]);
    const ie = await incomeExpenseReport(u, P);
    expect(ie.totals.profit.toString()).toBe("2300");
    expect(ie.rows.map((r) => r.profit.toString())).toEqual(["500", "2900", "-1100"]);
  });

  it("KDV: hesaplanan − indirilecek, aylık; döküm belgeleri listeler", async () => {
    const { u } = await setup();
    const v = await vatReport(u, P);
    expect([v.totals.output.toString(), v.totals.input.toString(), v.totals.net.toString()]).toEqual(["780", "120", "660"]);
    expect(v.rows.map((r) => r.net.toString())).toEqual(["100", "580", "-20"]);
    const d = await vatDetail(u, "2026-02");
    expect(d.map((x) => [x.kind, x.vat.toString()])).toEqual([["Satış iadesi", "-20"], ["Satış faturası", "600"]]);
  });

  it("açık alacak / borç ve vade analizi; tahsilat kalanı düşürür", async () => {
    const { u, jan } = await setup();
    const bank = await createAccount(u, accountSchema.parse({ type: "CASH", name: "Kasa" }));
    await createSettlement(u, settlementSchema.parse({ invoiceId: jan, accountId: bank.id, date: "2026-01-20", amount: "200" }));
    const rec = await openReceivables();
    // Ocak faturası (kalan 1000) + USD fatura (3600 TL); iade ve reddedilen hariç
    expect(rec.map((i) => i.remainingTl.toString()).sort()).toEqual(["1000", "3600"]);
    const a = aging(rec);
    expect(a.total.toString()).toBe("4600");
    expect(a.overdue.toString()).toBe("4600"); // vadeler geçmişte
    const pay = await openPayables();
    expect(pay.map((i) => i.remainingTl.toString()).sort()).toEqual(["1000", "120", "600"]);
  });

  it("kasa raporu: dönem öncesi hareket açılışa girer; stok raporu alış fiyatıyla değerler", async () => {
    const { u, jan } = await setup();
    const kasa = await createAccount(u, accountSchema.parse({ type: "CASH", name: "Kasa", openingBalance: "1000" }));
    await createSettlement(u, settlementSchema.parse({ invoiceId: jan, accountId: kasa.id, date: "2025-12-31", amount: "100" }));
    await createSettlement(u, settlementSchema.parse({ invoiceId: jan, accountId: kasa.id, date: "2026-02-01", amount: "300" }));
    const [k] = await cashReport(u, P);
    expect([k!.opening.toString(), k!.inflow.toString(), k!.outflow.toString(), k!.closing.toString()]).toEqual(["1100", "300", "0", "1400"]);
    await createProduct(u, productSchema.parse({ name: "Akü", unit: "C62", vatRate: "20", initialStock: "4", buyPrice: "250" }));
    const st = await stockReport(u);
    expect(st.totals).toEqual([{ currency: "TRY", total: expect.anything() }]);
    expect(st.totals[0]!.total.toString()).toBe("1000");
  });

  it("dönem varsayılanı ve ay listesi; görüntüleyici rapor görür, satış rolü göremez", async () => {
    expect(monthsBetween({ from: "2025-11-15", to: "2026-02-01" })).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(resolvePeriod("2026-05-01", "2026-01-01")).toEqual({ from: "2026-01-01", to: "2026-05-01" });
    await setup();
    await expect(salesReport(await user("VIEWER"), P, "month")).resolves.toBeTruthy();
    await expect(salesReport(await user("SALES"), P, "month")).rejects.toThrow();
  });

  it("Excel çıktısı: rapor ve liste xlsx olarak üretilir", async () => {
    const { u } = await setup();
    const q = new URLSearchParams({ baslangic: P.from, bitis: P.to, ay: "2026-02" });
    const kdv = await EXPORTS["rapor-kdv"]!(u, q);
    expect(kdv.sheets.map((s) => s.name)).toEqual(["Aylara göre KDV", "KDV dökümü 2026-02"]);
    const buf = await buildXlsx(kdv.sheets);
    expect(buf.subarray(0, 2).toString()).toBe("PK"); // zip
    const list = await EXPORTS["satis-faturalari"]!(u, new URLSearchParams());
    expect(list.sheets[0]!.rows).toHaveLength(4);
  });
});
