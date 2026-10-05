import { beforeEach, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { db } from "@/server/db";
import type { UserRole } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/server/auth/session";
import { documentHeaderSchema, type ParsedLine } from "@/lib/document-form";
import { accountSchema, contactSchema, productSchema } from "@/lib/validation";
import { createContact, updateContact } from "@/server/services/contacts";
import { createProduct, updateProduct } from "@/server/services/products";
import { createAccount, getAccount } from "@/server/services/accounts";
import { deleteInvoice, getInvoice, saveInvoice } from "@/server/services/invoices";
import { createSettlement, deleteTransaction, settlementSchema } from "@/server/services/transactions";
import { contactBalance, contactStatement } from "@/server/services/ledger";
import {
  adjustStock, adjustmentSchema, createStockTransfer, defaultWarehouseId, deleteAdjustment, deleteStockTransfer, listMovements, saveWarehouse, setDefaultWarehouse,
  setWarehouseArchived, stockByWarehouse, warehouseSchema,
} from "@/server/services/stock";
import { deleteWaybill, saveWaybill, waybillHeaderSchema } from "@/server/services/waybills";
import { priceListSchema, priceListsForForm, savePriceList, savePriceListItems } from "@/server/services/price-lists";
import { chequeAction, chequeSchema, createCheque, deleteCheque, getCheque, listCheques, revertCheque } from "@/server/services/cheques";
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
const stockOf = async (id: string) => (await db.product.findUniqueOrThrow({ where: { id } })).stockQuantity.toString();
const whStock = async (productId: string, warehouseId: string) => (await stockByWarehouse({ productIds: [productId], warehouseId }))[0]?.quantity.toString() ?? "0";
const header = (o: Record<string, string> = {}) => documentHeaderSchema.parse({ issueDate: "2026-10-01", ...o });

async function setup() {
  const u = await user();
  const customer = await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "Müşteri A.Ş." }), rep);
  const supplier = await createContact(u, contactSchema.parse({ kind: "SUPPLIER", title: "Tedarikçi Ltd" }), rep);
  const aku = await createProduct(u, productSchema.parse({ name: "Akü", unit: "C62", vatRate: "20", initialStock: "10", sellPrice: "100" }));
  const main = await defaultWarehouseId();
  return { u, customer, supplier, aku, main };
}

beforeEach(resetDb);

describe("depo ve açılış stoku", () => {
  it("başlangıç stoku varsayılan depoya açılış hareketi olur; kart düzenlenince hareket de güncellenir", async () => {
    const { u, aku, main } = await setup();
    expect(await whStock(aku.id, main)).toBe("10");
    await updateProduct(u, aku.id, productSchema.parse({ name: "Akü", unit: "C62", vatRate: "20", initialStock: "7" }));
    expect(await stockOf(aku.id)).toBe("7");
    expect(await db.stockMovement.count({ where: { productId: aku.id, source: "OPENING" } })).toBe(1);
    await updateProduct(u, aku.id, productSchema.parse({ name: "Akü", unit: "C62", vatRate: "20", initialStock: "0" }));
    expect(await db.stockMovement.count({ where: { productId: aku.id } })).toBe(0);
  });

  it("fatura seçilen depodan düşer; transfer depolar arasında taşır, toplam değişmez; yetersiz stok transfer edilemez; geri alınabilir", async () => {
    const { u, customer, aku, main } = await setup();
    const depo2 = await saveWarehouse(u, null, warehouseSchema.parse({ name: "Sanayi" }));
    const t = await createStockTransfer(u, { fromWarehouseId: main, toWarehouseId: depo2.id, date: "2026-10-01", description: null }, [{ productId: aku.id, quantity: new Decimal(4) }]);
    expect([await whStock(aku.id, main), await whStock(aku.id, depo2.id), await stockOf(aku.id)]).toEqual(["6", "4", "10"]);
    await expect(createStockTransfer(u, { fromWarehouseId: depo2.id, toWarehouseId: main, date: "2026-10-01", description: null }, [{ productId: aku.id, quantity: new Decimal(5) }])).rejects.toThrow(/çıkış deposunda 4 var/);
    await saveInvoice(u, null, { direction: "SALE", header: header({ contactId: customer.id, warehouseId: depo2.id }), lines: [line({ productId: aku.id, quantity: "3" })], discount: { discountType: null, discountValue: null }, tagIds: [] });
    expect([await whStock(aku.id, depo2.id), await stockOf(aku.id)]).toEqual(["1", "7"]);
    // Giriş deposunda transfer edilen 4 kalmadı → geri alınamaz
    await expect(deleteStockTransfer(u, t)).rejects.toThrow(/geri alınamaz/);
    await expect(setWarehouseArchived(u, depo2.id, true)).rejects.toThrow(/stoğu var/);
    await expect(setWarehouseArchived(u, main, true)).rejects.toThrow(/Varsayılan depo/);
    await setDefaultWarehouse(u, depo2.id);
    expect(await defaultWarehouseId()).toBe(depo2.id);
  });

  it("sayım: sayılan miktara tamamlar; giriş / çıkış farkı ekler; değişiklik yoksa hata; düzeltme silinebilir, belge hareketi silinemez", async () => {
    const { u, customer, aku, main } = await setup();
    const parse = (o: Record<string, string>) => adjustmentSchema.parse({ productId: aku.id, warehouseId: main, date: "2026-10-02", ...o });
    expect((await adjustStock(u, parse({ mode: "SET", quantity: "8" }))).toString()).toBe("-2");
    expect(await stockOf(aku.id)).toBe("8");
    await adjustStock(u, parse({ mode: "DELTA", quantity: "+3" }));
    expect(await stockOf(aku.id)).toBe("11");
    await expect(adjustStock(u, parse({ mode: "SET", quantity: "11" }))).rejects.toThrow(/zaten bu miktarda/);
    const adj = await db.stockMovement.findFirstOrThrow({ where: { source: "ADJUSTMENT", quantity: 3 } });
    await deleteAdjustment(u, adj.id);
    expect(await stockOf(aku.id)).toBe("8");
    await saveInvoice(u, null, { direction: "SALE", header: header({ contactId: customer.id }), lines: [line({ productId: aku.id, quantity: "1" })], discount: { discountType: null, discountValue: null }, tagIds: [] });
    const inv = await db.stockMovement.findFirstOrThrow({ where: { source: "INVOICE" } });
    await expect(deleteAdjustment(u, inv.id)).rejects.toThrow(/belgeye bağlı/);
    const hist = await listMovements(u, { productId: aku.id });
    expect(hist.rows.map((m) => m.source).sort()).toEqual(["ADJUSTMENT", "INVOICE", "OPENING"]);
  });

  it("görüntüleyici stok güncelleyemez", async () => {
    const { aku, main } = await setup();
    const v = await user("VIEWER");
    await expect(adjustStock(v, adjustmentSchema.parse({ productId: aku.id, warehouseId: main, date: "2026-10-02", mode: "DELTA", quantity: "1" }))).rejects.toThrow();
  });
});

describe("irsaliye", () => {
  const wh = (o: Record<string, string>) => waybillHeaderSchema.parse({ issueDate: "2026-10-01", dispatchDate: "2026-10-01", ...o });

  it("giden irsaliye stoğu düşer; irsaliyeden fatura stoğa dokunmaz ve irsaliyeyi bağlar; faturalı irsaliye değişmez; fatura silinince bağ kalkar", async () => {
    const { u, customer, supplier, aku } = await setup();
    const w = await saveWaybill(u, "SALE", null, wh({ contactId: customer.id }), [{ productId: aku.id, name: "Akü", quantity: "3", unit: "C62" }]);
    expect(await stockOf(aku.id)).toBe("7");
    // Yanlış cari / yön
    await expect(saveInvoice(u, null, { direction: "SALE", header: header({ contactId: (await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "Başka" }), rep)).id, waybillId: w }), lines: [line()], discount: { discountType: null, discountValue: null }, tagIds: [] })).rejects.toThrow(/irsaliyedeki cariye/);
    const invId = await saveInvoice(u, null, { direction: "SALE", header: header({ contactId: customer.id, waybillId: w, stockMode: "WITH_INVOICE" }), lines: [line({ productId: aku.id, quantity: "3" })], discount: { discountType: null, discountValue: null }, tagIds: [] });
    expect(await stockOf(aku.id)).toBe("7");
    const inv = await getInvoice(u, invId);
    expect(inv.stockMode).toBe("NONE");
    expect(inv.waybills.map((x) => x.id)).toEqual([w]);
    await expect(saveInvoice(u, null, { direction: "SALE", header: header({ contactId: customer.id, waybillId: w }), lines: [line()], discount: { discountType: null, discountValue: null }, tagIds: [] })).rejects.toThrow(/zaten faturalanmış/);
    await expect(saveWaybill(u, "SALE", w, wh({ contactId: customer.id }), [{ productId: aku.id, name: "Akü", quantity: "1", unit: "C62" }])).rejects.toThrow(/Faturalanmış/);
    await expect(deleteWaybill(u, w)).rejects.toThrow(/Faturalanmış/);
    await deleteInvoice(u, invId);
    await deleteWaybill(u, w);
    expect(await stockOf(aku.id)).toBe("10");
    // Gelen irsaliye stoğu artırır; tedarikçi yerine müşteri seçilemez
    await saveWaybill(u, "PURCHASE", null, wh({ contactId: supplier.id }), [{ productId: aku.id, name: "Akü", quantity: "5", unit: "C62" }]);
    expect(await stockOf(aku.id)).toBe("15");
    await expect(saveWaybill(u, "PURCHASE", null, wh({ contactId: customer.id }), [{ productId: null, name: "x", quantity: "1", unit: "C62" }])).rejects.toThrow(/Tedarikçi seçin/);
  });

  it("irsaliye düzenlenince eski stok geri alınır", async () => {
    const { u, customer, aku } = await setup();
    const w = await saveWaybill(u, "SALE", null, wh({ contactId: customer.id }), [{ productId: aku.id, name: "Akü", quantity: "3", unit: "C62" }]);
    await saveWaybill(u, "SALE", w, wh({ contactId: customer.id }), [{ productId: aku.id, name: "Akü", quantity: "1", unit: "C62" }, { productId: null, name: "Nakliye", quantity: "1", unit: "C62" }]);
    expect(await stockOf(aku.id)).toBe("9");
  });
});

describe("fiyat listesi", () => {
  it("fiyatlar kaydedilir, boş bırakılan çıkar; müşteriye bağlanır; fiyat girilmiş listenin dövizi değişmez", async () => {
    const { u, customer, aku } = await setup();
    const l = await savePriceList(u, null, priceListSchema.parse({ name: "Bayi", currency: "TRY" }));
    const fd = new FormData();
    fd.set(`price_${aku.id}`, "85,50");
    expect(await savePriceListItems(u, l.id, fd)).toBe(1);
    expect((await priceListsForForm())[0]!.prices[aku.id]).toBe("85.5");
    await expect(savePriceList(u, l.id, priceListSchema.parse({ name: "Bayi", currency: "USD" }))).rejects.toThrow(/dövizi değiştirilemez/);
    await updateContact(u, customer.id, contactSchema.parse({ kind: "CUSTOMER", title: "Müşteri A.Ş.", priceListId: l.id }), rep);
    expect((await db.contact.findUniqueOrThrow({ where: { id: customer.id } })).priceListId).toBe(l.id);
    const clear = new FormData();
    clear.set(`price_${aku.id}`, "");
    await savePriceListItems(u, l.id, clear);
    expect(await db.priceListItem.count()).toBe(0);
    const bad = new FormData();
    bad.set(`price_${aku.id}`, "abc");
    await expect(savePriceListItems(u, l.id, bad)).rejects.toThrow(/Geçersiz/);
  });
});

describe("çekler", () => {
  async function chequeSetup() {
    const s = await setup();
    const bank = await createAccount(s.u, accountSchema.parse({ type: "BANK", name: "Banka", bankName: "Ziraat", openingBalance: "1000" }));
    const usd = await createAccount(s.u, accountSchema.parse({ type: "BANK", name: "USD", bankName: "Ziraat", currency: "USD" }));
    const invId = await saveInvoice(s.u, null, { direction: "SALE", header: header({ contactId: s.customer.id }), lines: [line({ unitPrice: "1000" })], discount: { discountType: null, discountValue: null }, tagIds: [] }); // 1200
    const cheque = (o: Record<string, string> = {}) => chequeSchema.parse({ direction: "RECEIVED", contactId: s.customer.id, chequeNo: "A-1", amount: "1200", issueDate: "2026-10-01", dueDate: "2026-11-01", ...o });
    return { ...s, bank, usd, invId, cheque };
  }

  it("alınan çek faturayı kapatır, para bankaya tahsilde girer; geri alınabilir", async () => {
    const { u, customer, bank, usd, invId, cheque } = await chequeSetup();
    await expect(createCheque(u, cheque({ invoiceId: invId, amount: "1300" }))).rejects.toThrow(/Fatura kalanı/);
    const id = await createCheque(u, cheque({ invoiceId: invId }));
    expect((await getInvoice(u, invId)).remaining.toString()).toBe("0");
    expect((await contactBalance(customer.id)).toString()).toBe("0");
    expect((await getAccount(u, bank.id)).balance.toString()).toBe("1000");
    // Çek hareketi kasa / banka ekranından silinemez
    const tx = await db.transaction.findFirstOrThrow({ where: { chequeId: id } });
    await expect(deleteTransaction(u, tx.id)).rejects.toThrow(/Çekler ekranından/);
    await expect(chequeAction(u, id, { action: "collect", date: "2026-11-01", accountId: usd.id, contactId: null, invoiceId: null })).rejects.toThrow(/aynı dövizde/);
    await chequeAction(u, id, { action: "collect", date: "2026-11-01", accountId: bank.id, contactId: null, invoiceId: null });
    expect((await getAccount(u, bank.id)).balance.toString()).toBe("2200");
    expect((await getCheque(u, id)).status).toBe("COLLECTED");
    await expect(deleteCheque(u, id)).rejects.toThrow(/geri alın/);
    await revertCheque(u, id);
    expect((await getAccount(u, bank.id)).balance.toString()).toBe("1000");
    expect((await listCheques(u, { status: "open" })).total).toBe(1);
    await deleteCheque(u, id);
    expect((await getInvoice(u, invId)).remaining.toString()).toBe("1200");
  });

  it("karşılıksız çek müşteriyi yeniden borçlandırır ve faturayı açar; geri alınınca fatura yeniden kapanır; ekstrede görünür", async () => {
    const { u, customer, invId, cheque } = await chequeSetup();
    const id = await createCheque(u, cheque({ invoiceId: invId }));
    await chequeAction(u, id, { action: "bounce", date: "2026-11-02", accountId: null, contactId: null, invoiceId: null });
    expect((await contactBalance(customer.id)).toString()).toBe("1200");
    expect((await getInvoice(u, invId)).remaining.toString()).toBe("1200");
    const st = await contactStatement(customer.id);
    expect(st.map((r) => r.label)).toEqual(["Satış faturası", "Çek alındı · A-1", "Karşılıksız çek · A-1"]);
    await revertCheque(u, id);
    expect((await getInvoice(u, invId)).remaining.toString()).toBe("0");
    expect((await contactBalance(customer.id)).toString()).toBe("0");
  });

  it("ciro: tedarikçi borcu düşer; verilen çek: tedarikçi borcu hemen, banka ödeme gününde düşer", async () => {
    const { u, customer, supplier, bank, cheque } = await chequeSetup();
    const purchase = await saveInvoice(u, null, { direction: "PURCHASE", header: header({ contactId: supplier.id }), lines: [line({ unitPrice: "2000" })], discount: { discountType: null, discountValue: null }, tagIds: [] }); // 2400
    const id = await createCheque(u, cheque());
    await expect(chequeAction(u, id, { action: "endorse", date: "2026-10-05", accountId: null, contactId: customer.id, invoiceId: null })).rejects.toThrow(/tedarikçiye ciro/);
    await chequeAction(u, id, { action: "endorse", date: "2026-10-05", accountId: null, contactId: supplier.id, invoiceId: purchase });
    expect((await contactBalance(supplier.id)).toString()).toBe("-1200");
    expect((await getInvoice(u, purchase)).remaining.toString()).toBe("1200");
    await expect(chequeAction(u, id, { action: "collect", date: "2026-10-06", accountId: bank.id, contactId: null, invoiceId: null })).rejects.toThrow(/ciro edildi/);

    const issued = await createCheque(u, chequeSchema.parse({ direction: "ISSUED", contactId: supplier.id, invoiceId: purchase, chequeNo: "B-9", amount: "1200", issueDate: "2026-10-05", dueDate: "2026-12-01" }));
    expect((await contactBalance(supplier.id)).toString()).toBe("0");
    expect((await getAccount(u, bank.id)).balance.toString()).toBe("1000");
    await chequeAction(u, issued, { action: "pay", date: "2026-12-01", accountId: bank.id, contactId: null, invoiceId: null });
    expect((await getAccount(u, bank.id)).balance.toString()).toBe("-200");
    // Tahsilat gibi davranan cari ödemesi de kalanı aşamaz
    await expect(createSettlement(u, settlementSchema.parse({ invoiceId: purchase, accountId: bank.id, date: "2026-12-01", amount: "1" }))).rejects.toThrow(/Kalan tutar/);
  });

  it("çek müşteriden alınır, tedarikçiye verilir; satış rolü verilen çek giremez", async () => {
    const { u, supplier, cheque } = await chequeSetup();
    await expect(createCheque(u, cheque({ contactId: supplier.id }))).rejects.toThrow(/müşteriden/);
    const sales = await user("SALES");
    await expect(createCheque(sales, chequeSchema.parse({ direction: "ISSUED", contactId: supplier.id, chequeNo: "C", amount: "1", issueDate: "2026-10-01", dueDate: "2026-10-01" }))).rejects.toThrow();
  });
});
