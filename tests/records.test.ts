import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { UserRole } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/server/auth/session";
import { checkTaxId, isValidTckn, isValidVkn } from "@/lib/tax-id";
import { formatIban, isValidIban } from "@/lib/iban";
import { accountSchema, contactSchema, parseRepeated, productSchema } from "@/lib/validation";
import { contactTotals, createContact, getContact, listContacts, setContactArchived, updateContact } from "@/server/services/contacts";
import { createProduct, listProducts, updateProduct } from "@/server/services/products";
import { createAccount, listAccounts, updateAccount } from "@/server/services/accounts";
import { createCategory } from "@/server/services/categories";
import { saveCompany } from "@/server/services/company";
import { resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

async function user(role: UserRole = "ADMIN"): Promise<CurrentUser> {
  const u = await db.user.create({ data: { email: `${role.toLowerCase()}-${Math.random()}@test.local`, name: role, passwordHash: "x:y", role } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, isActive: true };
}

/** Formdan geliyormuş gibi */
const form = (o: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};
const contactInput = (o: Record<string, string> = {}) => contactSchema.parse({ kind: "CUSTOMER", title: "Deneme Ltd", ...o });

describe("kimlik numarası ve IBAN", () => {
  it("VKN / TCKN kontrol hanesi", () => {
    expect(isValidVkn("1234567890")).toBe(true);
    expect(isValidVkn("1234567891")).toBe(false);
    expect(isValidTckn("10000000146")).toBe(true);
    expect(isValidTckn("10000000147")).toBe(false);
    expect(isValidTckn("01234567890")).toBe(false); // 0 ile başlayamaz
    expect(checkTaxId("11111111111")).toEqual({ ok: true, kind: "TCKN" }); // nihai tüketici
    expect(checkTaxId("123")).toMatchObject({ ok: false });
  });

  it("IBAN mod-97 ve biçim", () => {
    expect(isValidIban("TR33 0006 1005 1978 6457 8413 26")).toBe(true);
    expect(isValidIban("TR330006100519786457841327")).toBe(false);
    expect(isValidIban("TR3300061005197864578413")).toBe(false); // TR 26 karakter olmalı
    expect(formatIban("tr330006100519786457841326")).toBe("TR33 0006 1005 1978 6457 8413 26");
  });
});

describe("form şemaları", () => {
  it("boş alanlar null, geçersiz VKN alan hatası", () => {
    const ok = contactSchema.parse({ kind: "CUSTOMER", title: " ABC ", email: "", taxNumber: "" });
    expect(ok.title).toBe("ABC");
    expect(ok.email).toBeNull();
    expect(ok.taxNumber).toBeNull();
    const bad = contactSchema.safeParse({ kind: "CUSTOMER", title: "ABC", taxNumber: "1234567891" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(["taxNumber"]);
  });

  it("gerçek kişiye VKN girilemez; açılış bakiyesi işaretliyse tutar zorunlu", () => {
    expect(contactSchema.safeParse({ kind: "CUSTOMER", title: "Ali Veli", personType: "NATURAL", taxNumber: "1234567890" }).success).toBe(false);
    expect(contactSchema.safeParse({ kind: "CUSTOMER", title: "X", hasOpeningBalance: "on" }).success).toBe(false);
  });

  it("Türkçe tutar girişi decimal metne çevrilir", () => {
    const p = productSchema.parse({ name: "Akü", unit: "C62", vatRate: "20", sellPrice: "3.166,6667", initialStock: "12" });
    expect(p.sellPrice).toBe("3166.6667");
    expect(productSchema.safeParse({ name: "X", unit: "C62", vatRate: "18" }).success).toBe(false); // %18 artık yok
    expect(productSchema.safeParse({ name: "X", unit: "C62", vatRate: "20", buyPrice: "-5" }).success).toBe(false);
  });

  it("tekrarlanan satırlar: IBAN normalleşir, boş yetkili atılır, geçersiz yakalanır", () => {
    const r = parseRepeated(form({ iban: ["tr33 0006 1005 1978 6457 8413 26", ""], person_name: ["Ayşe", ""], person_email: ["ayse@x.com", ""], person_phone: ["", ""], person_notes: ["", ""] }));
    expect(r.ibans).toEqual(["TR330006100519786457841326"]);
    expect(r.people).toEqual([{ name: "Ayşe", email: "ayse@x.com", phone: null, notes: null }]);
    expect(parseRepeated(form({ iban: "TR000" })).invalidIban).toBe("TR000");
  });

  it("banka hesabında banka adı zorunlu, kasada değil", () => {
    expect(accountSchema.safeParse({ type: "BANK", name: "Ziraat" }).success).toBe(false);
    expect(accountSchema.safeParse({ type: "CASH", name: "Kasa" }).success).toBe(true);
  });
});

describe("cariler (gerçek veritabanı)", () => {
  const rep = { ibans: [], people: [], invalidIban: null, invalidPersonEmail: null };

  it("aynı VKN ile ikinci müşteri açılamaz; nihai tüketici numarası serbest", async () => {
    const u = await user();
    await createContact(u, contactInput({ taxNumber: "1234567890" }), rep);
    await expect(createContact(u, contactInput({ title: "Başka", taxNumber: "1234567890" }), rep)).rejects.toThrow(/zaten|kayıtlı/);
    // Aynı numara tedarikçi olarak açılabilir (ayrı liste)
    await expect(createContact(u, contactSchema.parse({ kind: "SUPPLIER", title: "Deneme Ltd", taxNumber: "1234567890" }), rep)).resolves.toBeTruthy();
    await createContact(u, contactInput({ title: "Perakende 1", taxNumber: "11111111111" }), rep);
    await expect(createContact(u, contactInput({ title: "Perakende 2", taxNumber: "11111111111" }), rep)).resolves.toBeTruthy();
  });

  it("satış rolü müşteri açar ama tedarikçi açamaz; görüntüleyici hiçbirini", async () => {
    const sales = await user("SALES");
    await expect(createContact(sales, contactInput(), rep)).resolves.toBeTruthy();
    await expect(createContact(sales, contactSchema.parse({ kind: "SUPPLIER", title: "T" }), rep)).rejects.toThrow(/yetkiniz yok/);
    await expect(createContact(await user("VIEWER"), contactInput({ title: "V" }), rep)).rejects.toThrow(/yetkiniz yok/);
    await expect(listContacts(sales, "SUPPLIER")).rejects.toThrow(/yetkiniz yok/);
  });

  it("güncelleme IBAN ve yetkili listesini değiştirir; tür değiştirilemez", async () => {
    const u = await user();
    const c = await createContact(u, contactInput(), { ...rep, ibans: ["TR330006100519786457841326"], people: [{ name: "Eski", email: null, phone: null, notes: null }] });
    await updateContact(u, c.id, contactInput({ title: "Yeni Ad" }), { ...rep, people: [{ name: "Yeni", email: null, phone: null, notes: null }] });
    const after = await getContact(u, c.id);
    expect(after.title).toBe("Yeni Ad");
    expect(after.ibans).toHaveLength(0);
    expect(after.people.map((p) => p.name)).toEqual(["Yeni"]);
    await expect(updateContact(u, c.id, contactSchema.parse({ kind: "SUPPLIER", title: "X" }), rep)).rejects.toThrow(/değiştirilemez/);
  });

  it("açılış bakiyesi yönü bakiyeye ve liste toplamlarına yansır", async () => {
    const u = await user();
    await createContact(u, contactInput({ title: "Borçlu", hasOpeningBalance: "on", openingBalance: "1.500,50", openingBalanceSide: "DEBIT" }), rep);
    await createContact(u, contactInput({ title: "Alacaklı", hasOpeningBalance: "on", openingBalance: "200", openingBalanceSide: "CREDIT" }), rep);
    await createContact(u, contactInput({ title: "Sıfır" }), rep);
    const { rows } = await listContacts(u, "CUSTOMER");
    expect(Object.fromEntries(rows.map((r) => [r.title, r.balance.toString()]))).toEqual({ Borçlu: "1500.5", Alacaklı: "-200", Sıfır: "0" });
    const t = await contactTotals("CUSTOMER");
    expect(t.receivable.toString()).toBe("1500.5");
    expect(t.payable.toString()).toBe("200");
  });

  it("arşivlenen cari aktif listeden kalkar, arşivde görünür; arama VKN ile de bulur", async () => {
    const u = await user();
    const c = await createContact(u, contactInput({ title: "Arşivlik", taxNumber: "1234567890" }), rep);
    expect((await listContacts(u, "CUSTOMER", { q: "4567" })).total).toBe(1);
    await setContactArchived(u, c.id, true);
    expect((await listContacts(u, "CUSTOMER")).total).toBe(0);
    expect((await listContacts(u, "CUSTOMER", { archived: true })).total).toBe(1);
  });

  it("başka türde kategori seçilemez", async () => {
    const u = await user();
    const productCat = await createCategory(u, { type: "PRODUCT", name: "Akü", color: "#9e9e9e" });
    await expect(createContact(u, contactInput({ categoryId: productCat.id }), rep)).rejects.toThrow(/Kategori geçersiz/);
  });
});

describe("ürünler ve hesaplar (gerçek veritabanı)", () => {
  const product = (o: Record<string, string> = {}) => productSchema.parse({ name: "Akü 60Ah", unit: "C62", vatRate: "20", ...o });

  it("başlangıç stoku güncel stoğa yazılır, değişince fark yansır; stok kodu benzersiz", async () => {
    const u = await user();
    const p = await createProduct(u, product({ code: "AK-60", initialStock: "10" }));
    expect(p.stockQuantity.toString()).toBe("10");
    // Satışla 3 düşmüş gibi
    await db.product.update({ where: { id: p.id }, data: { stockQuantity: "7" } });
    const u2 = await updateProduct(u, p.id, product({ code: "AK-60", initialStock: "12" }));
    expect(u2.stockQuantity.toString()).toBe("9");
    await expect(createProduct(u, product({ name: "Başka", code: "AK-60" }))).rejects.toThrow(/kullanılıyor/);
  });

  it("stok takibi kapalıysa stok ve kritik seviye tutulmaz; kritik stok filtresi", async () => {
    const u = await user();
    const s = await createProduct(u, product({ name: "Montaj hizmeti", trackStock: "no", initialStock: "5" }));
    expect(s.stockQuantity.toString()).toBe("0");
    await createProduct(u, product({ name: "Az kalan", initialStock: "2", criticalEnabled: "on", criticalStock: "3" }));
    await createProduct(u, product({ name: "Bol", initialStock: "50", criticalEnabled: "on", criticalStock: "3" }));
    expect((await listProducts(u, { critical: true })).rows.map((r) => r.name)).toEqual(["Az kalan"]);
  });

  it("satış rolü ürün ekleyemez", async () => {
    await expect(createProduct(await user("SALES"), product())).rejects.toThrow(/yetkiniz yok/);
  });

  it("hesap türü değiştirilemez; kasada banka alanları tutulmaz; döviz bazında toplam", async () => {
    const u = await user();
    const kasa = await createAccount(u, accountSchema.parse({ type: "CASH", name: "Kasa", bankName: "X", openingBalance: "1.000" }));
    expect(kasa.bankName).toBeNull();
    await createAccount(u, accountSchema.parse({ type: "BANK", name: "Ziraat", bankName: "Ziraat", openingBalance: "-250,25" }));
    await createAccount(u, accountSchema.parse({ type: "BANK", name: "USD", bankName: "Ziraat", currency: "USD", openingBalance: "100" }));
    await expect(updateAccount(u, kasa.id, accountSchema.parse({ type: "BANK", name: "Kasa", bankName: "Y" }))).rejects.toThrow(/değiştirilemez/);
    const { totals } = await listAccounts(u);
    expect(Object.fromEntries(totals.map((t) => [t.currency, t.total.toString()]))).toEqual({ TRY: "749.75", USD: "100" });
  });
});

describe("firma bilgileri", () => {
  it("yalnızca yönetici değiştirir; tek kayıt", async () => {
    const admin = await user("ADMIN");
    await saveCompany(admin, { title: "Firma A", taxNumber: "1234567890", taxOffice: null, address: null, district: null, city: "Konya", postalCode: null, phone: null, email: null, website: null, sector: null, mersisNo: null, tradeRegNo: null });
    await saveCompany(admin, { title: "Firma B", taxNumber: null, taxOffice: null, address: null, district: null, city: null, postalCode: null, phone: null, email: null, website: null, sector: null, mersisNo: null, tradeRegNo: null });
    expect(await db.company.count()).toBe(1);
    expect((await db.company.findFirstOrThrow()).title).toBe("Firma B");
    await expect(saveCompany(await user("ACCOUNTANT"), { title: "X", taxNumber: null, taxOffice: null, address: null, district: null, city: null, postalCode: null, phone: null, email: null, website: null, sector: null, mersisNo: null, tradeRegNo: null })).rejects.toThrow(/yetkiniz yok/);
  });
});
