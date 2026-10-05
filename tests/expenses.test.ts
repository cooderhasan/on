import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@/server/db";
import type { UserRole } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/server/auth/session";
import { documentHeaderSchema, type ParsedLine } from "@/lib/document-form";
import { accountSchema, contactSchema, productSchema } from "@/lib/validation";
import { buildInvoiceXml } from "@/lib/ubl";
import { calculateDocument } from "@/lib/invoice-calc";
import { createContact } from "@/server/services/contacts";
import { createProduct } from "@/server/services/products";
import { createAccount, getAccount } from "@/server/services/accounts";
import { deleteInvoice, getInvoice, saveInvoice } from "@/server/services/invoices";
import { createSettlement, settlementSchema } from "@/server/services/transactions";
import { contactBalance, contactStatement } from "@/server/services/ledger";
import { deleteExpense, expenseSchema, getExpense, listExpenseRows, saveExpense, splitVat } from "@/server/services/expenses";
import { employeeSchema, getEmployee, listEmployees, saveEmployee } from "@/server/services/employees";
import { answerIncoming, listIncoming, processIncoming, setIncomingIgnored, syncIncoming } from "@/server/services/incoming";
import { saveEInvoiceSettings, settingsSchema } from "@/server/services/einvoice";
import { resetDb } from "./helpers";

const rep = { ibans: [], people: [], invalidIban: null, invalidPersonEmail: null };
async function user(role: UserRole = "ADMIN"): Promise<CurrentUser> {
  const u = await db.user.create({ data: { email: `${role}-${Math.random()}@t.local`, name: role, passwordHash: "x:y", role } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, isActive: true };
}
const line = (o: Partial<ParsedLine> = {}): ParsedLine => ({
  productId: null, name: "Malzeme", description: null, quantity: "1", unit: "C62", unitPrice: "100", discountType: null, discountValue: null,
  vatRate: 20, vatExemptionCode: null, otvRate: null, otvCode: null, withholdingRate: null, withholdingCode: null, ...o,
});

// ── Sahte NES: gelen faturalar ──
const KEY = "K-1234";
const incoming = new Map<string, { meta: Record<string, unknown>; xml: string; answer?: string }>();
let server: Server;
let base = "";
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const send = (c: number, b?: unknown, type = "application/json") => { res.writeHead(c, { "content-type": type }); res.end(b === undefined ? "" : typeof b === "string" ? b : JSON.stringify(b)); };
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const url = new URL(req.url!, "http://x");
    let m: RegExpMatchArray | null;
    if (url.pathname === "/einvoice/v1/incoming/invoices") {
      const data = [...incoming.values()].map((x) => ({ ...x.meta, documentAnswer: x.answer ?? "Waiting" }));
      return send(200, { page: 1, pageSize: 100, totalCount: data.length, data });
    }
    if ((m = url.pathname.match(/^\/einvoice\/v1\/incoming\/invoices\/([\w-]+)\/xml$/))) return incoming.has(m[1]!) ? send(200, incoming.get(m[1]!)!.xml, "application/xml") : send(404);
    if ((m = url.pathname.match(/^\/einvoice\/v1\/incoming\/invoices\/([\w-]+)\/documentAnswer$/))) {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { incomingInvoiceAnswerParameter: string };
      incoming.get(m[1]!)!.answer = body.incomingInvoiceAnswerParameter === "KABUL" ? "Accepted" : "Rejected";
      return send(201, { documentAnswer: incoming.get(m[1]!)!.answer });
    }
    send(404);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(async () => {
  server.close();
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  incoming.clear();
});

function addIncoming(uuid: string, opts: { vkn?: string; lines?: (Parameters<typeof calculateDocument>[0][number] & { withholdingCode?: string })[]; profile?: "TICARIFATURA" | "TEMELFATURA" } = {}) {
  const lines = opts.lines ?? [{ quantity: 2, unitPrice: 500, vatRate: 20, discountType: "PERCENT" as const, discountValue: 10 }];
  const calc = calculateDocument(lines);
  const xml = buildInvoiceXml({
    uuid, id: "TED2026000000001", profile: opts.profile ?? "TICARIFATURA", kind: "INVOICE", issueDate: "2026-10-01", issueTime: "09:00:00", currency: "TRY", notes: [],
    supplier: { taxNumber: opts.vkn ?? "1111111111", title: "Akü Toptan A.Ş.", taxOffice: "Kadıköy", address: "Depo Cad. 1", district: "Kadıköy", city: "İstanbul" },
    customer: { taxNumber: "1234567890", title: "Biz", taxOffice: "S", district: "S", city: "Konya" },
    lines: lines.map((l, i) => ({ name: `Akü ${i + 1}`, unitCode: "C62", ...l, ...calc.lines[i]! })),
    totals: calc.totals,
  });
  incoming.set(uuid, { xml, meta: { id: uuid, createdAt: "2026-10-01T10:00:00Z", issueDate: "2026-10-01T00:00:00", documentNumber: "TED2026000000001", profileId: opts.profile ?? "TICARIFATURA", invoiceTypeCode: "SATIS", payableAmount: Number(calc.totals.payableTotal), documentCurrencyCode: "TRY", accountingSupplierParty: { partyIdentification: opts.vkn ?? "1111111111", partyName: "Akü Toptan A.Ş." }, taxes: [{ taxTypeCode: "0015", taxableAmount: Number(calc.totals.netTotal), taxAmount: Number(calc.totals.vatTotal) }] } });
  return calc;
}

async function setup() {
  const u = await user();
  const kasa = await createAccount(u, accountSchema.parse({ type: "CASH", name: "Kasa", openingBalance: "10000" }));
  const supplier = await createContact(u, contactSchema.parse({ kind: "SUPPLIER", title: "Tedarikçi Ltd", taxNumber: "9876543217" }), rep);
  return { u, kasa, supplier };
}

describe("alış faturası", () => {
  it("stoğu artırır, tedarikçi bakiyesini borç yazar; ödeme kasadan düşer", async () => {
    const { u, kasa, supplier } = await setup();
    const p = await createProduct(u, productSchema.parse({ name: "Akü", unit: "C62", vatRate: "20", initialStock: "5" }));
    const id = await saveInvoice(u, null, { direction: "PURCHASE", header: documentHeaderSchema.parse({ contactId: supplier.id, issueDate: "2026-10-01" }), lines: [line({ productId: p.id, quantity: "10" })], discount: { discountType: null, discountValue: null }, tagIds: [] });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stockQuantity.toString()).toBe("15");
    expect((await contactBalance(supplier.id)).toString()).toBe("-1200");
    const tx = await createSettlement(u, settlementSchema.parse({ invoiceId: id, accountId: kasa.id, date: "2026-10-02", amount: "1200" }));
    expect(tx.type).toBe("PAYMENT");
    expect((await getAccount(u, kasa.id)).balance.toString()).toBe("8800");
    expect((await getInvoice(u, id)).remaining.toString()).toBe("0");
    expect((await contactBalance(supplier.id)).toString()).toBe("0");
  });

  it("müşteriye alış faturası girilemez; satış rolü alış faturası giremez", async () => {
    const { u } = await setup();
    const c = await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "M" }), rep);
    const input = { direction: "PURCHASE" as const, header: documentHeaderSchema.parse({ contactId: c.id, issueDate: "2026-10-01" }), lines: [line()], discount: { discountType: null, discountValue: null }, tagIds: [] };
    await expect(saveInvoice(u, null, input)).rejects.toThrow(/tedarikçiden/);
    await expect(saveInvoice(await user("SALES"), null, input)).rejects.toThrow(/yetkiniz yok/);
  });
});

describe("fatura dışı giderler", () => {
  it("KDV dahil tutar matrah / KDV olarak ayrılır", () => {
    const s = splitVat("1200", 20);
    expect([s.net.toString(), s.vat.toString()]).toEqual(["1000", "200"]);
    const t = splitVat("100", 20);
    expect(t.net.plus(t.vat).toString()).toBe("100");
    expect(t.net.toString()).toBe("83.33");
  });

  it("tedarikçili hızlı fiş bakiyeye ve ekstreye girer; kısmi ödeme, fazla ödeme engeli, ödemeli silme engeli", async () => {
    const { u, kasa, supplier } = await setup();
    const e = await saveExpense(u, null, expenseSchema.parse({ kind: "RECEIPT", description: "Kırtasiye", date: "2026-10-01", totalAmount: "600", vatRate: "20", contactId: supplier.id, receiptNo: "F-12" }));
    expect([e.netAmount.toString(), e.vatAmount.toString()]).toEqual(["500", "100"]);
    expect((await contactBalance(supplier.id)).toString()).toBe("-600");
    expect((await contactStatement(supplier.id)).map((r) => r.kind)).toEqual(["EXPENSE"]);
    await createSettlement(u, settlementSchema.parse({ expenseId: e.id, accountId: kasa.id, date: "2026-10-02", amount: "200" }));
    expect((await getExpense(u, e.id)).remaining.toString()).toBe("400");
    expect((await contactBalance(supplier.id)).toString()).toBe("-400");
    await expect(createSettlement(u, settlementSchema.parse({ expenseId: e.id, accountId: kasa.id, date: "2026-10-02", amount: "401" }))).rejects.toThrow(/Kalan tutar/);
    await expect(deleteExpense(u, e.id)).rejects.toThrow(/ödeme var/);
    await expect(saveExpense(u, e.id, expenseSchema.parse({ kind: "RECEIPT", description: "K", date: "2026-10-01", totalAmount: "100", vatRate: "20" }))).rejects.toThrow(/altına düşemez/);
  });

  it("vergi / banka giderinde KDV ve tedarikçi tutulmaz", async () => {
    const { u, supplier } = await setup();
    const e = await saveExpense(u, null, expenseSchema.parse({ kind: "TAX", description: "Eylül SGK", date: "2026-10-01", totalAmount: "4500", vatRate: "20", contactId: supplier.id }));
    expect([e.vatRate, e.vatAmount.toString(), e.contactId]).toEqual([0, "0", null]);
  });

  it("maaş çalışan ister; çalışan bakiyesi tahakkuk ve ödemelerle; avans", async () => {
    const { u, kasa } = await setup();
    expect(expenseSchema.safeParse({ kind: "SALARY", description: "Maaş", date: "2026-10-01", totalAmount: "30000" }).error?.issues[0]?.message).toBe("Çalışan seçin.");
    const emp = await saveEmployee(u, null, employeeSchema.parse({ name: "Ayşe Yılmaz", tckn: "10000000146", iban: "TR33 0006 1005 1978 6457 8413 26" }));
    await createSettlement(u, settlementSchema.parse({ employeeId: emp.id, accountId: kasa.id, date: "2026-09-20", amount: "5000", description: "Avans" }));
    expect((await listEmployees(u))[0]!.balance.toString()).toBe("5000");
    const sal = await saveExpense(u, null, expenseSchema.parse({ kind: "SALARY", description: "Eylül maaşı", date: "2026-09-30", totalAmount: "30000", employeeId: emp.id }));
    await createSettlement(u, settlementSchema.parse({ expenseId: sal.id, accountId: kasa.id, date: "2026-10-01", amount: "25000" }));
    const d = await getEmployee(u, emp.id);
    expect(d.balance.toString()).toBe("0");
    expect(d.movements.map((m) => m.kind)).toEqual(["Ödeme", "Tahakkuk", "Avans / ödeme"]);
    expect((await getAccount(u, kasa.id)).balance.toString()).toBe("-20000");
  });

  it("gider listesi alış faturalarını ve giderleri birlikte, filtreli gösterir", async () => {
    const { u, supplier } = await setup();
    await saveInvoice(u, null, { direction: "PURCHASE", header: documentHeaderSchema.parse({ contactId: supplier.id, issueDate: "2026-09-01", dueDate: "2026-09-10" }), lines: [line()], discount: { discountType: null, discountValue: null }, tagIds: [] });
    await saveExpense(u, null, expenseSchema.parse({ kind: "BANK_FEE", description: "EFT ücreti", date: "2099-01-01", totalAmount: "15" }));
    const all = await listExpenseRows(u);
    expect(all.rows.map((r) => r.kindLabel)).toEqual(["Banka gideri", "Alış faturası"]);
    expect(all.totals.total.toString()).toBe("135");
    expect((await listExpenseRows(u, { payment: "overdue" })).rows.map((r) => r.kindLabel)).toEqual(["Alış faturası"]);
    expect((await listExpenseRows(u, { kind: "BANK_FEE" })).total).toBe(1);
    expect((await listExpenseRows(u, { q: "eft" })).total).toBe(1);
  });

  it("görüntüleyici gider giremez; satış rolü giderleri göremez", async () => {
    await expect(saveExpense(await user("VIEWER"), null, expenseSchema.parse({ kind: "BANK_FEE", description: "X", date: "2026-10-01", totalAmount: "1" }))).rejects.toThrow(/yetkiniz yok/);
    await expect(listExpenseRows(await user("SALES"))).rejects.toThrow(/yetkiniz yok/);
  });
});

describe("gelen e-faturalar", () => {
  async function nesSetup() {
    const s = await setup();
    await saveEInvoiceSettings(s.u, settingsSchema.parse({ apiUrl: "https://apitest.nes.com.tr/", apiKey: KEY }));
    await db.eInvoiceSettings.update({ where: { id: "nes" }, data: { apiUrl: base } });
    return s;
  }

  it("içeri alma tekrarlanınca mükerrer kayıt oluşmaz", async () => {
    const { u } = await nesSetup();
    addIncoming("a1");
    addIncoming("a2");
    expect(await syncIncoming(u)).toEqual({ created: 2, updated: 0 });
    expect(await syncIncoming(u)).toEqual({ created: 0, updated: 2 });
    const l = await listIncoming(u);
    expect(l.total).toBe(2);
    expect(l.rows[0]).toMatchObject({ senderTitle: "Akü Toptan A.Ş.", status: "NEW", payableAmount: expect.anything() });
  });

  it("gidere işle: tedarikçi VKN'den açılır, satırlar ve tutar birebir; ikinci kez işlenemez; fatura silinince yeniden işlenebilir", async () => {
    const { u } = await nesSetup();
    const p = await createProduct(u, productSchema.parse({ name: "Akü 1", unit: "C62", vatRate: "20", initialStock: "0" }));
    const calc = addIncoming("b1", { lines: [{ quantity: 2, unitPrice: 500, vatRate: 20, discountType: "PERCENT", discountValue: 10 }, { quantity: 1, unitPrice: 100, vatRate: 20, withholdingCode: "603", withholdingRate: 50 }] });
    await syncIncoming(u);
    const inc = (await listIncoming(u)).rows[0]!;
    const r = await processIncoming(u, inc.id, { categoryId: null, stockMode: "WITH_INVOICE" });
    expect(r.warnings).toEqual([]);
    const inv = await getInvoice(u, r.invoiceId);
    expect(inv.direction).toBe("PURCHASE");
    expect(inv.invoiceNo).toBe("TED2026000000001");
    expect(inv.payableTotal.toString()).toBe(calc.totals.payableTotal.toString());
    expect(inv.contact).toMatchObject({ kind: "SUPPLIER", taxNumber: "1111111111", title: "Akü Toptan A.Ş.", city: "İstanbul" });
    expect(inv.lines.map((l) => l.withholdingCode)).toEqual([null, "603"]);
    // Ürün adı birebir eşleşen satır stoğa girdi
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stockQuantity.toString()).toBe("2");
    await expect(processIncoming(u, inc.id, { categoryId: null, stockMode: "NONE" })).rejects.toThrow(/zaten işlenmiş/);
    await deleteInvoice(u, r.invoiceId);
    expect((await db.incomingInvoice.findUniqueOrThrow({ where: { id: inc.id } })).status).toBe("NEW");
  });

  it("mevcut tedarikçi VKN ile bulunur (yeni cari açılmaz)", async () => {
    const { u, supplier } = await nesSetup();
    addIncoming("c1", { vkn: "9876543217" });
    await syncIncoming(u);
    const r = await processIncoming(u, (await listIncoming(u)).rows[0]!.id, { categoryId: null, stockMode: "NONE" });
    expect((await getInvoice(u, r.invoiceId)).contactId).toBe(supplier.id);
    expect(await db.contact.count({ where: { kind: "SUPPLIER" } })).toBe(1);
  });

  it("ticari faturaya ret gerekçe ister ve yok sayılır; temel faturaya yanıt verilmez", async () => {
    const { u } = await nesSetup();
    addIncoming("d1");
    addIncoming("d2", { profile: "TEMELFATURA" });
    await syncIncoming(u);
    const rows = (await listIncoming(u)).rows;
    const ticari = rows.find((x) => x.uuid === "d1")!;
    const temel = rows.find((x) => x.uuid === "d2")!;
    await expect(answerIncoming(u, ticari.id, { answer: "RED", note: null })).rejects.toThrow(/gerekçe/);
    await answerIncoming(u, ticari.id, { answer: "RED", note: "Fiyat hatalı" });
    expect(await db.incomingInvoice.findUniqueOrThrow({ where: { id: ticari.id } })).toMatchObject({ answer: "Rejected", status: "IGNORED" });
    await expect(answerIncoming(u, temel.id, { answer: "KABUL", note: null })).rejects.toThrow(/ticari/);
    await setIncomingIgnored(u, temel.id, true);
    await expect(processIncoming(u, temel.id, { categoryId: null, stockMode: "NONE" })).rejects.toThrow(/yok sayılmış/);
  });
});
