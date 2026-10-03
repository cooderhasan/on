import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { XMLParser } from "fast-xml-parser";
import { db } from "@/server/db";
import type { UserRole } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/server/auth/session";
import { documentHeaderSchema, type ParsedLine } from "@/lib/document-form";
import { contactSchema, productSchema } from "@/lib/validation";
import { createContact } from "@/server/services/contacts";
import { createProduct } from "@/server/services/products";
import { saveCompany } from "@/server/services/company";
import { deleteInvoice, getInvoice, saveInvoice } from "@/server/services/invoices";
import { contactBalance } from "@/server/services/ledger";
import { cancelArchiveInvoice, getEInvoiceSettings, lookupTaxpayer, prepareSend, refreshStatus, saveEInvoiceSettings, sendInvoice, settingsSchema, testConnection } from "@/server/services/einvoice";
import { decryptSecret } from "@/server/crypto";
import { resetDb } from "./helpers";

// ── Sahte NES sunucusu (OpenAPI'deki uçlar) ────────────────
const KEY = "TEST-API-KEY-1234";
const nes = {
  users: new Map<string, { title: string; aliases: Array<{ alias: string; type: string }> }>(),
  uploads: [] as Array<{ service: string; xml: string; fields: Record<string, string> }>,
  docs: new Map<string, Record<string, unknown>>(),
  mode: "ok" as "ok" | "timeout" | "409" | "422",
  cancelled: [] as string[],
  seq: 0,
};
let server: Server;
let base = "";
const xml = new XMLParser({ removeNSPrefix: true, parseTagValue: false, ignoreAttributes: false });

beforeAll(async () => {
  process.env.NES_TIMEOUT_MS = "400";
  server = createServer(async (req, res) => {
    const send = (code: number, body?: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { message: "Unauthorized" });
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const url = new URL(req.url!, "http://x");
    let m: RegExpMatchArray | null;
    if ((m = url.pathname.match(/^\/einvoice\/v1\/users\/(\d+)\/(\w+)$/))) {
      const u = nes.users.get(m[1]!);
      if (!u) return send(404);
      return send(200, { identifier: m[1], title: u.title, aliases: u.aliases.filter((a) => m![2] === "All" || a.type === m![2]) });
    }
    if ((m = url.pathname.match(/^\/(einvoice|earchive)\/v1\/uploads\/document$/)) && req.method === "POST") {
      if (nes.mode === "timeout") return; // yanıt yok → istemci zaman aşımına düşer (belge yine de "alınmış" sayılır)
      const fd = await new Request("http://x", { method: "POST", headers: { "content-type": req.headers["content-type"]! }, body: Buffer.concat(chunks) }).formData();
      const file = fd.get("File") as File;
      const body = await file.text();
      const fields = Object.fromEntries([...fd.entries()].filter(([k]) => k !== "File").map(([k, v]) => [k, String(v)]));
      const inv = xml.parse(body).Invoice;
      if (nes.mode === "422") return send(422, { errors: [{ message: "Alıcı vergi dairesi zorunludur." }] });
      if (nes.docs.has(inv.UUID) || nes.mode === "409") return send(409, { message: "Belge zaten mevcut" });
      nes.uploads.push({ service: m[1]!, xml: body, fields });
      const no = `${inv.ID}2026${String(++nes.seq).padStart(9, "0")}`;
      nes.docs.set(inv.UUID, { id: inv.UUID, documentNumber: no, outgoingStatus: "WaitingToBeSend", recordStatus: "Succeed", archiveDocumentStatus: "Waiting", isCanceled: false });
      return send(200, { uuid: inv.UUID, documentNumber: no });
    }
    if (url.pathname === "/earchive/v1/invoices/cancel") {
      const { uuids } = JSON.parse(Buffer.concat(chunks).toString()) as { uuids: string[] };
      for (const u of uuids) Object.assign(nes.docs.get(u)!, { isCanceled: true });
      nes.cancelled.push(...uuids);
      return send(200);
    }
    if ((m = url.pathname.match(/^\/einvoice\/v1\/outgoing\/invoices\/([\w-]+)$/)) || (m = url.pathname.match(/^\/earchive\/v1\/invoices\/([\w-]+)$/))) {
      const d = nes.docs.get(m[1]!);
      return d ? send(200, d) : send(404);
    }
    send(404, { message: "yok" });
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
  nes.users.clear();
  nes.uploads = [];
  nes.docs.clear();
  nes.cancelled = [];
  nes.mode = "ok";
  nes.seq = 0;
  nes.users.set("1234567890", { title: "Biz Ltd", aliases: [{ alias: "urn:mail:defaultgb@test.local", type: "Gb" }, { alias: "urn:mail:defaultpk@test.local", type: "Pk" }] });
  nes.users.set("9876543217", { title: "Mükellef AŞ", aliases: [{ alias: "urn:mail:mukellefpk@test.local", type: "Pk" }] });
});

const rep = { ibans: [], people: [], invalidIban: null, invalidPersonEmail: null };
async function user(role: UserRole = "ADMIN"): Promise<CurrentUser> {
  const u = await db.user.create({ data: { email: `${role}-${Math.random()}@t.local`, name: role, passwordHash: "x:y", role } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, isActive: true };
}
const line = (o: Partial<ParsedLine> = {}): ParsedLine => ({
  productId: null, name: "Hizmet", description: null, quantity: "1", unit: "C62", unitPrice: "100", discountType: null, discountValue: null,
  vatRate: 20, vatExemptionCode: null, otvRate: null, otvCode: null, withholdingRate: null, withholdingCode: null, ...o,
});

async function setup() {
  const u = await user();
  await saveCompany(u, { title: "Biz Ltd. Şti.", taxNumber: "1234567890", taxOffice: "Selçuk", address: "Adres 1", district: "Selçuklu", city: "Konya", postalCode: null, phone: null, email: null, website: null, sector: null, mersisNo: null, tradeRegNo: null });
  await saveEInvoiceSettings(u, settingsSchema.parse({ apiUrl: "https://apitest.nes.com.tr/", apiKey: KEY, eInvoiceSeries: "EFT", eArchiveSeries: "EAR" }));
  await db.eInvoiceSettings.update({ where: { id: "nes" }, data: { apiUrl: base } }); // test: sahte sunucu
  const mukellef = await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "Mükellef A.Ş.", taxNumber: "9876543217", taxOffice: "Meram", district: "Meram", city: "Konya", address: "X" }), rep);
  const tuketici = await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "Ali Veli", personType: "NATURAL", taxNumber: "10000000146", district: "Meram", city: "Konya" }), rep);
  const inv = (contactId: string, lines = [line()]) =>
    saveInvoice(u, null, { direction: "SALE", header: documentHeaderSchema.parse({ contactId, issueDate: "2026-10-03", dueDate: "2026-10-03" }), lines, discount: { discountType: null, discountValue: null }, tagIds: [] });
  return { u, mukellef, tuketici, inv };
}

describe("e-Fatura ayarları", () => {
  it("API anahtarı şifreli saklanır ve geri gösterilmez; bağlantı testi GB etiketini doldurur", async () => {
    const { u } = await setup();
    const row = await db.eInvoiceSettings.findUniqueOrThrow({ where: { id: "nes" } });
    expect(row.apiKeyEnc).not.toContain(KEY);
    expect(decryptSecret(row.apiKeyEnc!)).toBe(KEY);
    const s = await getEInvoiceSettings(u);
    expect(s).toMatchObject({ hasKey: true, apiKeyLast4: "1234" });
    expect(JSON.stringify(s)).not.toContain(KEY);
    const t = await testConnection(u);
    expect(t.senderAliases).toEqual(["urn:mail:defaultgb@test.local"]);
    expect((await getEInvoiceSettings(u)).senderAlias).toBe("urn:mail:defaultgb@test.local");
    // Anahtar boş bırakılırsa mevcut anahtar korunur
    await saveEInvoiceSettings(u, settingsSchema.parse({ apiUrl: "https://apitest.nes.com.tr/", eInvoiceSeries: "EFT" }));
    expect(decryptSecret((await db.eInvoiceSettings.findUniqueOrThrow({ where: { id: "nes" } })).apiKeyEnc!)).toBe(KEY);
  });

  it("muhasebe rolü ayarları göremez", async () => {
    await expect(getEInvoiceSettings(await user("ACCOUNTANT"))).rejects.toThrow(/yetkiniz yok/);
  });
});

describe("gönderim", () => {
  it("mükellefe e-Fatura: alias'lar, seri, numara ve UUID kaydedilir", async () => {
    const { u, mukellef, inv } = await setup();
    await testConnection(u);
    const id = await inv(mukellef.id);
    const pre = await prepareSend(u, id);
    expect(pre).toMatchObject({ isEInvoiceUser: true, profile: "TICARIFATURA", errors: [] });
    const r = await sendInvoice(u, id, { profile: "TICARIFATURA", sendType: "ELEKTRONIK" });
    expect(r.documentNumber).toBe("EFT2026000000001");
    const up = nes.uploads[0]!;
    expect(up.service).toBe("einvoice");
    expect(up.fields).toMatchObject({ SenderAlias: "urn:mail:defaultgb@test.local", ReceiverAlias: "urn:mail:mukellefpk@test.local", IsDirectSend: "true", SourceApp: "OnMuhasebe", SourceAppRecordId: id });
    const saved = await getInvoice(u, id);
    expect(saved).toMatchObject({ eDocStatus: "SENT", invoiceNo: "EFT2026000000001", eDocProfile: "TICARIFATURA", locked: true });
    expect(xml.parse(up.xml).Invoice.UUID).toBe(saved.eDocUuid);
    await expect(sendInvoice(u, id, { profile: "TICARIFATURA", sendType: "ELEKTRONIK" })).rejects.toThrow(/zaten/);
    await expect(saveInvoice(u, id, { direction: "SALE", header: documentHeaderSchema.parse({ contactId: mukellef.id, issueDate: "2026-10-03" }), lines: [line()], discount: { discountType: null, discountValue: null }, tagIds: [] })).rejects.toThrow(/değiştirilemez/);
    await expect(deleteInvoice(u, id)).rejects.toThrow(/silinemez/);
  });

  it("mükellef olmayana e-Arşiv; e-Fatura seçilirse reddedilir", async () => {
    const { u, tuketici, inv } = await setup();
    const id = await inv(tuketici.id);
    expect((await prepareSend(u, id)).profile).toBe("EARSIVFATURA");
    await expect(sendInvoice(u, id, { profile: "TICARIFATURA", sendType: "ELEKTRONIK" })).rejects.toThrow(/e-Arşiv olarak gönderin/);
    expect((await getInvoice(u, id)).eDocStatus).toBe("FAILED");
    await sendInvoice(u, id, { profile: "EARSIVFATURA", sendType: "ELEKTRONIK" });
    const up = nes.uploads[0]!;
    expect(up.service).toBe("earchive");
    expect(up.fields.SenderAlias).toBeUndefined();
    expect((await getInvoice(u, id)).invoiceNo).toBe("EAR2026000000001");
  });

  it("zaman aşımı: fatura 'gönderiliyor'da kalır, ikinci gönderim engellenir, durum sorgusu netleştirir (çift fatura yok)", async () => {
    const { u, tuketici, inv } = await setup();
    const id = await inv(tuketici.id);
    nes.mode = "timeout";
    await expect(sendInvoice(u, id, { profile: "EARSIVFATURA", sendType: "ELEKTRONIK" })).rejects.toThrow(/gönderilmiş olabilir/);
    expect((await getInvoice(u, id)).eDocStatus).toBe("QUEUED");
    await expect(sendInvoice(u, id, { profile: "EARSIVFATURA", sendType: "ELEKTRONIK" })).rejects.toThrow(/şu an gönderiliyor/);
    // NES'e hiç ulaşmamış → sorgu FAILED yapar, aynı UUID ile güvenle tekrar gönderilir
    expect((await refreshStatus(u, id)).status).toBe("FAILED");
    const uuid = (await getInvoice(u, id)).eDocUuid;
    nes.mode = "ok";
    await sendInvoice(u, id, { profile: "EARSIVFATURA", sendType: "ELEKTRONIK" });
    expect(nes.uploads).toHaveLength(1);
    expect((await getInvoice(u, id)).eDocUuid).toBe(uuid);
  });

  it("409 (NES'te zaten var) durum sorgusuyla eşitlenir; 422 hata mesajı kullanıcıya iletilir", async () => {
    const { u, tuketici, inv } = await setup();
    const a = await inv(tuketici.id);
    const { eDocUuid } = await db.invoice.update({ where: { id: a }, data: { eDocUuid: "11111111-2222-3333-4444-555555555555" } });
    nes.docs.set(eDocUuid!, { id: eDocUuid, documentNumber: "EAR2026000000077", archiveDocumentStatus: "Signed", isCanceled: false });
    const r = await sendInvoice(u, a, { profile: "EARSIVFATURA", sendType: "ELEKTRONIK" });
    expect(r).toMatchObject({ status: "ACCEPTED", documentNumber: "EAR2026000000077" });
    const b = await inv(tuketici.id);
    nes.mode = "422";
    await expect(sendInvoice(u, b, { profile: "EARSIVFATURA", sendType: "ELEKTRONIK" })).rejects.toThrow("NES hatası (422): Alıcı vergi dairesi zorunludur.");
    const failed = await getInvoice(u, b);
    expect(failed.eDocStatus).toBe("FAILED");
    expect(failed.eDocError).toContain("vergi dairesi");
  });

  it("hatalı fatura düzeltilince yeni UUID ile gönderilir", async () => {
    const { u, tuketici, inv } = await setup();
    const id = await inv(tuketici.id);
    nes.mode = "422";
    await sendInvoice(u, id, { profile: "EARSIVFATURA", sendType: "ELEKTRONIK" }).catch(() => undefined);
    const firstUuid = (await getInvoice(u, id)).eDocUuid;
    await saveInvoice(u, id, { direction: "SALE", header: documentHeaderSchema.parse({ contactId: tuketici.id, issueDate: "2026-10-03" }), lines: [line({ unitPrice: "150" })], discount: { discountType: null, discountValue: null }, tagIds: [] });
    const edited = await getInvoice(u, id);
    expect(edited).toMatchObject({ eDocStatus: "NONE", eDocUuid: null });
    nes.mode = "ok";
    await sendInvoice(u, id, { profile: "EARSIVFATURA", sendType: "ELEKTRONIK" });
    expect((await getInvoice(u, id)).eDocUuid).not.toBe(firstUuid);
  });

  it("eksik bilgide NES'e gidilmez (ön kontrol)", async () => {
    const { u, inv } = await setup();
    const eksik = await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "Adressiz" }), rep);
    const id = await inv(eksik.id);
    await expect(sendInvoice(u, id, { profile: "EARSIVFATURA", sendType: "ELEKTRONIK" })).rejects.toThrow(/Müşteri VKN/);
    expect(nes.uploads).toHaveLength(0);
  });

  it("satış rolü e-belge gönderemez", async () => {
    const { tuketici, inv } = await setup();
    const id = await inv(tuketici.id);
    await expect(sendInvoice(await user("SALES"), id, { profile: "EARSIVFATURA", sendType: "ELEKTRONIK" })).rejects.toThrow(/yetkiniz yok/);
  });
});

describe("durum, ret ve iptal", () => {
  it("e-Fatura alıcı reddederse fatura bakiyeden ve stoktan düşer, silinebilir hale gelir", async () => {
    const { u, mukellef, inv } = await setup();
    await testConnection(u);
    const p = await createProduct(u, productSchema.parse({ name: "Akü", unit: "C62", vatRate: "20", initialStock: "10" }));
    const id = await inv(mukellef.id, [line({ productId: p.id, quantity: "2" })]);
    await sendInvoice(u, id, { profile: "TICARIFATURA", sendType: "ELEKTRONIK" });
    expect((await contactBalance(mukellef.id)).toString()).toBe("240");
    const uuid = (await getInvoice(u, id)).eDocUuid!;
    Object.assign(nes.docs.get(uuid)!, { outgoingStatus: "EnvelopeHasBeenTransferredToReceiverSuccessfully" });
    expect((await refreshStatus(u, id)).status).toBe("ACCEPTED");
    Object.assign(nes.docs.get(uuid)!, { incomingAnswer: { documentAnswer: "Rejected", answerNote: "Fiyat hatalı" } });
    expect((await refreshStatus(u, id)).status).toBe("REJECTED");
    const inv2 = await getInvoice(u, id);
    expect(inv2).toMatchObject({ eDocError: "Fiyat hatalı", deletable: true });
    expect(inv2.remaining.toString()).toBe("0");
    expect((await contactBalance(mukellef.id)).toString()).toBe("0");
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stockQuantity.toString()).toBe("10");
  });

  it("e-Arşiv iptali NES'e iletilir; tahsilatlı fatura iptal edilemez", async () => {
    const { u, tuketici, inv } = await setup();
    const id = await inv(tuketici.id);
    await sendInvoice(u, id, { profile: "EARSIVFATURA", sendType: "ELEKTRONIK" });
    await cancelArchiveInvoice(u, id);
    expect(nes.cancelled).toHaveLength(1);
    expect((await getInvoice(u, id)).eDocStatus).toBe("CANCELLED");
    expect((await contactBalance(tuketici.id)).toString()).toBe("0");
  });

  it("mükellef sorgusu aynı VKN'li cariyi işaretler", async () => {
    const { u, mukellef } = await setup();
    const r = await lookupTaxpayer(u, "9876543217");
    expect(r).toMatchObject({ isEInvoiceUser: true, title: "Mükellef AŞ" });
    expect((await db.contact.findUniqueOrThrow({ where: { id: mukellef.id } })).eInvoiceAlias).toBe("urn:mail:mukellefpk@test.local");
    expect((await lookupTaxpayer(u, "1234567890")).isEInvoiceUser).toBe(true);
    await expect(lookupTaxpayer(u, "123")).rejects.toThrow(/VKN 10/);
  });

  it("yanlış API anahtarında anlaşılır hata", async () => {
    const { u } = await setup();
    await saveEInvoiceSettings(u, settingsSchema.parse({ apiUrl: "https://apitest.nes.com.tr/", apiKey: "YANLIS" }));
    await db.eInvoiceSettings.update({ where: { id: "nes" }, data: { apiUrl: base } });
    await expect(testConnection(u)).rejects.toThrow("NES API anahtarı geçersiz veya süresi dolmuş.");
  });
});
