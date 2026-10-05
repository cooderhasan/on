import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { UserRole } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/server/auth/session";
import { documentHeaderSchema, parseDocDiscount, parseLines, type ParsedLine } from "@/lib/document-form";
import { contactSchema, productSchema, accountSchema } from "@/lib/validation";
import { createContact } from "@/server/services/contacts";
import { createProduct } from "@/server/services/products";
import { createAccount, getAccount } from "@/server/services/accounts";
import { deleteInvoice, getInvoice, listInvoices, saveInvoice, type SaveInvoiceInput } from "@/server/services/invoices";
import { accountMovements, cashMoveSchema, createCashMove, createSettlement, createTransfer, deleteTransaction, settlementSchema, transferSchema } from "@/server/services/transactions";
import { contactBalance, contactStatement } from "@/server/services/ledger";
import { convertQuoteToInvoice, getQuote, saveQuote } from "@/server/services/quotes";
import { resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

const rep = { ibans: [], people: [], invalidIban: null, invalidPersonEmail: null };
async function user(role: UserRole = "ADMIN"): Promise<CurrentUser> {
  const u = await db.user.create({ data: { email: `${role}-${Math.random()}@t.local`, name: role, passwordHash: "x:y", role } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, isActive: true };
}
const form = (o: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};
const line = (o: Partial<ParsedLine> = {}): ParsedLine => ({
  productId: null, name: "Hizmet", description: null, quantity: "1", unit: "C62", unitPrice: "100", discountType: null, discountValue: null,
  vatRate: 20, vatExemptionCode: null, otvRate: null, otvCode: null, withholdingRate: null, withholdingCode: null, ...o,
});

async function setup() {
  const u = await user();
  const customer = await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "Müşteri A" }), rep);
  const kasa = await createAccount(u, accountSchema.parse({ type: "CASH", name: "Kasa", openingBalance: "1000" }));
  const aku = await createProduct(u, productSchema.parse({ name: "Akü", unit: "C62", vatRate: "20", initialStock: "10" }));
  const inv = (o: Partial<SaveInvoiceInput["header"]> = {}, lines: ParsedLine[] = [line()]): SaveInvoiceInput => ({
    direction: "SALE",
    header: documentHeaderSchema.parse({ contactId: customer.id, issueDate: "2026-09-01", dueDate: "2026-09-15", ...o }),
    lines,
    discount: { discountType: null, discountValue: null },
    tagIds: [],
  });
  return { u, customer, kasa, aku, inv };
}

describe("form ayrıştırma", () => {
  it("satır dizileri okunur, boş satır atlanır, hatalı satır numarasıyla döner", () => {
    const { lines, errors } = parseLines(
      form({
        line_name: ["Akü", "", "Montaj"], line_qty: ["2", "1", "0"], line_unit: ["C62", "C62", "C62"], line_price: ["1.500,50", "", "100"],
        line_vat: ["20", "20", "20"], line_discType: ["PERCENT", "", ""], line_discValue: ["10", "", ""], line_otv: ["", "", ""], line_whRate: ["", "", ""], line_productId: ["", "", ""],
      }),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ name: "Akü", quantity: "2", unitPrice: "1500.5", discountType: "PERCENT", discountValue: "10" });
    expect(errors).toEqual({ 2: "Miktar sıfırdan büyük olmalı." });
  });

  it("genel indirim ve vade kontrolü", () => {
    expect(parseDocDiscount("PERCENT", "120")).toEqual({ error: "Genel indirim %100'ü aşamaz." });
    expect(parseDocDiscount("AMOUNT", "50")).toEqual({ discountType: "AMOUNT", discountValue: "50" });
    expect(documentHeaderSchema.safeParse({ contactId: "x", issueDate: "2026-09-10", dueDate: "2026-09-01" }).success).toBe(false);
  });
});

describe("satış faturası", () => {
  it("toplamlar kaydedilir, stok düşer, cari bakiyesi artar", async () => {
    const { u, customer, aku, inv } = await setup();
    const id = await saveInvoice(u, null, inv({}, [line({ productId: aku.id, name: "Akü", quantity: "3", unitPrice: "3166.6667" })]));
    const i = await getInvoice(u, id);
    expect(i.payableTotal.toString()).toBe("11400");
    expect(i.remaining.toString()).toBe("11400");
    expect((await db.product.findUniqueOrThrow({ where: { id: aku.id } })).stockQuantity.toString()).toBe("7");
    expect((await contactBalance(customer.id)).toString()).toBe("11400");
  });

  it("düzenlemede eski stok geri alınır, yenisi düşülür; 'stok çıkışı yapılmasın' stoğa dokunmaz", async () => {
    const { u, aku, inv } = await setup();
    const id = await saveInvoice(u, null, inv({}, [line({ productId: aku.id, quantity: "4" })]));
    await saveInvoice(u, id, inv({}, [line({ productId: aku.id, quantity: "1" })]));
    expect((await db.product.findUniqueOrThrow({ where: { id: aku.id } })).stockQuantity.toString()).toBe("9");
    await saveInvoice(u, id, inv({ stockMode: "NONE" }, [line({ productId: aku.id, quantity: "5" })]));
    expect((await db.product.findUniqueOrThrow({ where: { id: aku.id } })).stockQuantity.toString()).toBe("10");
    // Yalnızca ürün kartındaki başlangıç stoku (açılış hareketi) kalır
    expect(await db.stockMovement.count({ where: { source: { not: "OPENING" } } })).toBe(0);
  });

  it("iade faturası stoğu geri koyar ve bakiyeyi düşürür", async () => {
    const { u, customer, aku, inv } = await setup();
    await saveInvoice(u, null, inv({}, [line({ productId: aku.id, quantity: "2" })]));
    await saveInvoice(u, null, inv({ kind: "RETURN" }, [line({ productId: aku.id, quantity: "1" })]));
    expect((await db.product.findUniqueOrThrow({ where: { id: aku.id } })).stockQuantity.toString()).toBe("9");
    expect((await contactBalance(customer.id)).toString()).toBe("120"); // 240 − 120
  });

  it("tedarikçiye satış faturası kesilemez; cari dövizinden farklı fatura reddedilir; satış rolü kesebilir, görüntüleyici kesemez", async () => {
    const { u, inv } = await setup();
    const sup = await createContact(u, contactSchema.parse({ kind: "SUPPLIER", title: "T" }), rep);
    await expect(saveInvoice(u, null, inv({ contactId: sup.id }))).rejects.toThrow(/yalnızca müşteriye/);
    await expect(saveInvoice(u, null, inv({ currency: "USD", exchangeRate: "34" }))).rejects.toThrow(/TRY olmalı/);
    await expect(saveInvoice(await user("SALES"), null, inv())).resolves.toBeTruthy();
    await expect(saveInvoice(await user("VIEWER"), null, inv())).rejects.toThrow(/yetkiniz yok/);
  });

  it("vadesi geçmiş ve ödenmiş filtreleri", async () => {
    const { u, kasa, inv } = await setup();
    const a = await saveInvoice(u, null, inv({ issueDate: "2020-01-01", dueDate: "2020-01-31" }));
    await saveInvoice(u, null, inv({ issueDate: "2099-01-01", dueDate: "2099-01-31" }));
    expect((await listInvoices(u, "SALE", { payment: "overdue" })).rows.map((r) => r.id)).toEqual([a]);
    await createSettlement(u, settlementSchema.parse({ invoiceId: a, accountId: kasa.id, date: "2020-02-01", amount: "120" }));
    expect((await listInvoices(u, "SALE", { payment: "paid" })).rows.map((r) => r.id)).toEqual([a]);
    expect((await listInvoices(u, "SALE", { payment: "overdue" })).total).toBe(0);
  });
});

describe("tahsilat ve kasa", () => {
  it("kısmi tahsilat kalanı düşürür, kalandan fazlası girilemez; kasa bakiyesi artar", async () => {
    const { u, customer, kasa, inv } = await setup();
    const id = await saveInvoice(u, null, inv()); // 120
    await createSettlement(u, settlementSchema.parse({ invoiceId: id, accountId: kasa.id, date: "2026-09-05", amount: "50" }));
    expect((await getInvoice(u, id)).remaining.toString()).toBe("70");
    await expect(createSettlement(u, settlementSchema.parse({ invoiceId: id, accountId: kasa.id, date: "2026-09-06", amount: "70,01" }))).rejects.toThrow(/Kalan tutar/);
    expect((await getAccount(u, kasa.id)).balance.toString()).toBe("1050");
    expect((await contactBalance(customer.id)).toString()).toBe("70");
  });

  it("tahsilatı olan fatura silinemez ve tutarı tahsilatın altına indirilemez; tahsilat silinince silinebilir", async () => {
    const { u, kasa, inv } = await setup();
    const id = await saveInvoice(u, null, inv());
    const t = await createSettlement(u, settlementSchema.parse({ invoiceId: id, accountId: kasa.id, date: "2026-09-05", amount: "100" }));
    await expect(saveInvoice(u, id, inv({}, [line({ unitPrice: "50" })]))).rejects.toThrow(/altına düşemez/);
    await expect(deleteInvoice(u, id)).rejects.toThrow(/tahsilat/);
    await deleteTransaction(u, t.id);
    await expect(deleteInvoice(u, id)).resolves.toBe("SALE");
  });

  it("dövizli hesaptan tahsilatta cariye yansıyan tutar zorunlu", async () => {
    const { u, inv } = await setup();
    const usd = await createAccount(u, accountSchema.parse({ type: "BANK", name: "USD", bankName: "B", currency: "USD" }));
    const id = await saveInvoice(u, null, inv());
    await expect(createSettlement(u, settlementSchema.parse({ invoiceId: id, accountId: usd.id, date: "2026-09-05", amount: "3" }))).rejects.toThrow(/yansıyacak/);
    await createSettlement(u, settlementSchema.parse({ invoiceId: id, accountId: usd.id, date: "2026-09-05", amount: "3", appliedAmount: "102" }));
    expect((await getInvoice(u, id)).remaining.toString()).toBe("18");
    expect((await getAccount(u, usd.id)).balance.toString()).toBe("3");
  });

  it("virman ve para giriş/çıkışı bakiyelere doğru yansır; hareket listesi yürüyen bakiye verir", async () => {
    const { u, kasa } = await setup();
    const banka = await createAccount(u, accountSchema.parse({ type: "BANK", name: "Banka", bankName: "B" }));
    await createTransfer(u, transferSchema.parse({ accountId: kasa.id, targetAccountId: banka.id, date: "2026-09-02", amount: "400" }));
    await createCashMove(u, cashMoveSchema.parse({ type: "WITHDRAWAL", accountId: banka.id, date: "2026-09-03", amount: "15", description: "Havale masrafı" }));
    await createCashMove(u, cashMoveSchema.parse({ type: "DEPOSIT", accountId: kasa.id, date: "2026-09-04", amount: "200", description: "Ortak sermaye" }));
    expect((await getAccount(u, kasa.id)).balance.toString()).toBe("800");
    expect((await getAccount(u, banka.id)).balance.toString()).toBe("385");
    const moves = await accountMovements(u, banka.id);
    expect(moves.map((m) => [m.incoming, m.balance.toString()])).toEqual([[false, "385"], [true, "400"]]);
    await expect(createTransfer(u, transferSchema.parse({ accountId: kasa.id, targetAccountId: kasa.id, date: "2026-09-02", amount: "1" }))).rejects.toThrow(/aynı olamaz/);
  });

  it("cari ekstre: açılış, fatura, tahsilat sırayla ve yürüyen bakiye", async () => {
    const { u, kasa } = await setup();
    const c = await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "Ekstre", hasOpeningBalance: "on", openingBalance: "500", openingBalanceSide: "DEBIT" }), rep);
    const id = await saveInvoice(u, null, {
      direction: "SALE", header: documentHeaderSchema.parse({ contactId: c.id, issueDate: "2026-09-10" }), lines: [line()], discount: { discountType: null, discountValue: null }, tagIds: [],
    });
    await createSettlement(u, settlementSchema.parse({ invoiceId: id, accountId: kasa.id, date: "2026-09-12", amount: "120" }));
    await createSettlement(u, settlementSchema.parse({ contactId: c.id, accountId: kasa.id, date: "2026-09-20", amount: "200" }));
    const st = await contactStatement(c.id);
    expect(st.map((r) => [r.kind, r.balance.toString()])).toEqual([["OPENING", "500"], ["INVOICE", "620"], ["COLLECTION", "500"], ["COLLECTION", "300"]]);
  });
});

describe("teklif", () => {
  it("tekliften faturaya dönüştürülür; ikinci kez dönüştürülemez; faturalanmış teklif değiştirilemez", async () => {
    const { u, customer, aku } = await setup();
    const header = documentHeaderSchema.parse({ contactId: customer.id, issueDate: "2026-09-01" });
    const q = await saveQuote(u, null, { header, validUntil: "2026-09-30", lines: [line({ productId: aku.id, quantity: "2", discountType: "PERCENT", discountValue: "10" })], discount: { discountType: "AMOUNT", discountValue: "10" } });
    expect(q.payableTotal.toString()).toBe("204"); // (200 − 20 − 10) × 1.2
    const invoiceId = await convertQuoteToInvoice(u, q.id);
    const inv = await getInvoice(u, invoiceId);
    expect(inv.payableTotal.toString()).toBe("204");
    expect(inv.quote?.id).toBe(q.id);
    expect((await getQuote(u, q.id)).status).toBe("INVOICED");
    await expect(convertQuoteToInvoice(u, q.id)).rejects.toThrow(/zaten/);
    await expect(saveQuote(u, q.id, { header, validUntil: null, lines: [line()], discount: { discountType: null, discountValue: null } })).rejects.toThrow(/değiştirilemez/);
  });
});
