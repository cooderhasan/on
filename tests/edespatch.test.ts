import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { db } from "@/server/db";
import type { UserRole } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/server/auth/session";
import { contactSchema, productSchema } from "@/lib/validation";
import { buildDespatchXml, normalizePlate, validateDespatch, type UblDespatch } from "@/lib/ubl-despatch";
import { parseDespatchUbl } from "@/lib/ubl-parse";
import { createContact } from "@/server/services/contacts";
import { createProduct } from "@/server/services/products";
import { saveCompany } from "@/server/services/company";
import { saveEInvoiceSettings, settingsSchema, testConnection } from "@/server/services/einvoice";
import { deleteWaybill, saveWaybill, waybillHeaderSchema } from "@/server/services/waybills";
import {
  listIncomingDespatches, prepareDespatch, processIncomingDespatch, refreshDespatch, sendDespatch, setIncomingDespatchIgnored, syncIncomingDespatches,
} from "@/server/services/edespatch";
import { resetDb } from "./helpers";

// ── Saf: XML üretimi / doğrulama ───────────────────────────

const base: UblDespatch = {
  uuid: "11111111-2222-3333-4444-555555555555", id: "IRS", issueDate: "2026-10-05", issueTime: "10:00:00", notes: ["Not"],
  supplier: { taxNumber: "1234567890", title: "Biz & Ortak Ltd", taxOffice: "Selçuk", address: "Adres", district: "Selçuklu", city: "Konya" },
  despatchContact: "Ayşe Yılmaz",
  customer: { taxNumber: "9876543217", title: "Alıcı A.Ş.", taxOffice: "Meram", address: "Sanayi", district: "Meram", city: "Konya" },
  deliveryAddress: "Depo kapısı 3", despatchDate: "2026-10-05", despatchTime: "14:30",
  driver: { name: "Mehmet Ali Usta", tckn: "10000000146" }, vehiclePlate: "42 abc 123", trailerPlate: null, carrier: null,
  lines: [{ name: "Akü <60Ah>", code: "AKU-60", quantity: "3", unitCode: "C62" }],
};

describe("e-İrsaliye XML", () => {
  it("geçerli irsaliye: hata yok; metinler kaçışlı; şoför / plaka / sevk tarihi yazılır", () => {
    expect(validateDespatch(base)).toEqual([]);
    const x = buildDespatchXml(base);
    expect(x).toContain("Biz &amp; Ortak Ltd");
    expect(x).toContain("Akü &lt;60Ah&gt;");
    const d = new XMLParser({ removeNSPrefix: true, parseTagValue: false, ignoreAttributes: false }).parse(x).DespatchAdvice;
    expect([d.ProfileID, d.DespatchAdviceTypeCode, d.CustomizationID, d.LineCountNumeric]).toEqual(["TEMELIRSALIYE", "SEVK", "TR1.2.1", "1"]);
    expect(d.Shipment.ShipmentStage.DriverPerson).toMatchObject({ FirstName: "Mehmet Ali", FamilyName: "Usta", NationalityID: "10000000146" });
    expect(d.Shipment.ShipmentStage.TransportMeans.RoadTransport.LicensePlateID["#text"]).toBe("42ABC123");
    expect(d.Shipment.Delivery.Despatch).toEqual({ ActualDespatchDate: "2026-10-05", ActualDespatchTime: "14:30:00" });
    expect(d.DespatchLine.OrderLineReference.LineID).toBe("1");
    expect(d.DespatchSupplierParty.DespatchContact.Name).toBe("Ayşe Yılmaz");
  });

  it("taşıma bilgisi yoksa, TCKN / plaka hatalıysa, taşıyıcının ili yoksa hata", () => {
    expect(validateDespatch({ ...base, driver: null, vehiclePlate: null })).toContain("Taşıma bilgisi gerekli: şoför (ad soyad, TCKN) ve araç plakası ya da taşıyıcı firma.");
    const e = validateDespatch({ ...base, driver: { name: "Mehmet", tckn: "12345678901" }, vehiclePlate: "XYZ" });
    expect(e).toEqual(expect.arrayContaining(["Şoförün adı ve soyadı birlikte yazılmalı.", "Şoför TCKN geçersiz.", "Araç plakası geçersiz (ör. 42 ABC 123)."]));
    expect(validateDespatch({ ...base, driver: null, vehiclePlate: null, carrier: { taxNumber: "9876543217", title: "Kargo AŞ" } })).toContain("Taşıyıcı firmanın il ve ilçesi gerekli.");
    expect(validateDespatch({ ...base, driver: null, vehiclePlate: null, carrier: { taxNumber: "9876543217", title: "Kargo AŞ", district: "Kadıköy", city: "İstanbul" } })).toEqual([]);
    expect(validateDespatch({ ...base, despatchDate: "2026-10-04" })).toContain("Sevk tarihi düzenleme tarihinden önce olamaz.");
    expect(normalizePlate("06 a 1234")).toBe("06A1234");
  });

  it("NES'in resmi örnek irsaliyesi ve kendi ürettiğimiz XML okunur", () => {
    const sample = parseDespatchUbl(readFileSync("tests/fixtures/nes-irsaliye.xml", "utf8"));
    expect(sample.supplier).toMatchObject({ taxNumber: "1234567801", city: "İstanbul" });
    expect(sample.lines.map((l) => [l.name, l.quantity, l.unit])).toEqual([["Masa Üstü Bilgisayar", "20", "C62"], ["Notebook Bilgisayar", "12", "C62"], ["Notebook Çantası", "12", "C62"], ["Yazıcı", "2", "C62"]]);
    expect(sample.despatchDate).toBe("2021-04-14");
    const own = parseDespatchUbl(buildDespatchXml(base));
    expect(own.lines).toEqual([{ name: "Akü <60Ah>", code: "AKU-60", quantity: "3", unit: "C62" }]);
    expect(() => parseDespatchUbl("<Invoice/>")).toThrow(/e-İrsaliyesi değil/);
  });
});

// ── Sahte NES (edespatch uçları) ───────────────────────────

const KEY = "TEST-API-KEY-1234";
const nes = {
  users: new Map<string, Array<{ alias: string; type: string }>>(),
  uploads: [] as Array<{ xml: string; fields: Record<string, string> }>,
  docs: new Map<string, Record<string, unknown>>(),
  incoming: new Map<string, { meta: Record<string, unknown>; xml: string }>(),
  seq: 0,
};
let server: Server;
let baseUrl = "";
const xmlp = new XMLParser({ removeNSPrefix: true, parseTagValue: false, ignoreAttributes: false });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const send = (code: number, body?: unknown, type = "application/json") => {
      res.writeHead(code, { "content-type": type });
      res.end(body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const url = new URL(req.url!, "http://x");
    let m: RegExpMatchArray | null;
    if ((m = url.pathname.match(/^\/edespatch\/v1\/users\/(\d+)\/(\w+)$/))) {
      const a = nes.users.get(m[1]!);
      return a ? send(200, { identifier: m[1], title: "X", aliases: a.filter((x) => m![2] === "All" || x.type === m![2]) }) : send(404);
    }
    if (url.pathname === "/edespatch/v1/uploads/document" && req.method === "POST") {
      const fd = await new Request("http://x", { method: "POST", headers: { "content-type": req.headers["content-type"]! }, body: Buffer.concat(chunks) }).formData();
      const body = await (fd.get("File") as File).text();
      const d = xmlp.parse(body).DespatchAdvice;
      if (nes.docs.has(d.UUID)) return send(409, { message: "Belge zaten mevcut" });
      nes.uploads.push({ xml: body, fields: Object.fromEntries([...fd.entries()].filter(([k]) => k !== "File").map(([k, v]) => [k, String(v)])) });
      const no = `${d.ID}2026${String(++nes.seq).padStart(9, "0")}`;
      nes.docs.set(d.UUID, { id: d.UUID, documentNumber: no, outgoingStatus: "WaitingToBeSend", recordStatus: "Succeed", despatchAnswer: "None" });
      return send(200, { uuid: d.UUID, documentNumber: no });
    }
    if ((m = url.pathname.match(/^\/edespatch\/v1\/outgoing\/despatches\/([\w-]+)$/))) {
      const d = nes.docs.get(m[1]!);
      return d ? send(200, d) : send(404);
    }
    if (url.pathname === "/edespatch/v1/incoming/despatches") {
      const data = [...nes.incoming.values()].map((x) => x.meta);
      return send(200, { page: 1, pageSize: 100, totalCount: data.length, data });
    }
    if ((m = url.pathname.match(/^\/edespatch\/v1\/incoming\/despatches\/([\w-]+)\/xml$/))) return nes.incoming.has(m[1]!) ? send(200, nes.incoming.get(m[1]!)!.xml, "application/xml") : send(404);
    send(404, { message: "yok" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(async () => {
  server.close();
});
beforeEach(async () => {
  await resetDb();
  nes.users.clear();
  nes.uploads = [];
  nes.docs.clear();
  nes.incoming.clear();
  nes.seq = 0;
  nes.users.set("1234567890", [{ alias: "urn:mail:irsaliyegb@biz.test", type: "Gb" }]);
  nes.users.set("9876543217", [{ alias: "urn:mail:irsaliyepk@alici.test", type: "Pk" }]);
});

const rep = { ibans: [], people: [], invalidIban: null, invalidPersonEmail: null };
async function user(role: UserRole = "ADMIN"): Promise<CurrentUser> {
  const u = await db.user.create({ data: { email: `${role}-${Math.random()}@t.local`, name: "Ayşe Yılmaz", passwordHash: "x:y", role } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, isActive: true };
}
const wh = (o: Record<string, string>) => waybillHeaderSchema.parse({ issueDate: "2026-10-05", dispatchDate: "2026-10-05", ...o });

async function setup() {
  const u = await user();
  await saveCompany(u, { title: "Biz Ltd. Şti.", taxNumber: "1234567890", taxOffice: "Selçuk", address: "Adres 1", district: "Selçuklu", city: "Konya", postalCode: null, phone: null, email: null, website: null, sector: null, mersisNo: null, tradeRegNo: null });
  await saveEInvoiceSettings(u, settingsSchema.parse({ apiUrl: "https://apitest.nes.com.tr/", apiKey: KEY, despatchSeries: "IRS" }));
  await db.eInvoiceSettings.update({ where: { id: "nes" }, data: { apiUrl: baseUrl } });
  const alici = await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "Alıcı A.Ş.", taxNumber: "9876543217", taxOffice: "Meram", district: "Meram", city: "Konya", address: "Sanayi" }), rep);
  const kayitsiz = await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "Kayıtsız Ltd", taxNumber: "4444444444", taxOffice: "Meram", district: "Meram", city: "Konya" }), rep);
  const aku = await createProduct(u, productSchema.parse({ name: "Akü", code: "AKU-60", unit: "C62", vatRate: "20", initialStock: "10" }));
  const transport = { dispatchTime: "14:30", driverName: "Mehmet Usta", driverTckn: "10000000146", vehiclePlate: "42 ABC 123" };
  const waybill = (contactId: string, t: Record<string, string> = transport) => saveWaybill(u, "SALE", null, wh({ contactId, ...t }), [{ productId: aku.id, name: "Akü", quantity: "2", unit: "C62" }]);
  return { u, alici, kayitsiz, aku, waybill };
}

describe("e-İrsaliye gönderimi", () => {
  it("bağlantı testi e-İrsaliye GB etiketini doldurur; alıcı kayıtlı değilse gönderilmez", async () => {
    const { u, kayitsiz, waybill } = await setup();
    const r = await testConnection(u);
    expect(r.despatchAliases).toEqual(["urn:mail:irsaliyegb@biz.test"]);
    expect((await db.eInvoiceSettings.findUniqueOrThrow({ where: { id: "nes" } })).despatchSenderAlias).toBe("urn:mail:irsaliyegb@biz.test");
    const w = await waybill(kayitsiz.id);
    expect((await prepareDespatch(u, w)).errors).toContain("Alıcı e-İrsaliye kullanıcısı değil. Bu irsaliyeyi kağıt olarak yazdırın.");
    await expect(sendDespatch(u, w)).rejects.toThrow(/e-İrsaliye kullanıcısı değil/);
    expect((await db.waybill.findUniqueOrThrow({ where: { id: w } })).eDocStatus).toBe("FAILED");
    expect(nes.uploads).toHaveLength(0);
  });

  it("gönderilir: UUID sabit, etiketler doğru, numara NES'ten; gönderilen irsaliye değiştirilemez / silinemez; durum sorgusu", async () => {
    const { u, alici, aku, waybill } = await setup();
    await testConnection(u);
    const w = await waybill(alici.id);
    expect((await prepareDespatch(u, w)).errors).toEqual([]);
    const r = await sendDespatch(u, w);
    expect(r.documentNumber).toBe("IRS2026000000001");
    expect(nes.uploads[0]!.fields).toMatchObject({ SenderAlias: "urn:mail:irsaliyegb@biz.test", ReceiverAlias: "urn:mail:irsaliyepk@alici.test", AutoSaveCompany: "false" });
    const saved = await db.waybill.findUniqueOrThrow({ where: { id: w } });
    expect([saved.eDocStatus, saved.waybillNo]).toEqual(["SENT", "IRS2026000000001"]);
    expect(nes.uploads[0]!.xml).toContain(saved.eDocUuid!);
    await expect(sendDespatch(u, w)).rejects.toThrow(/zaten e-İrsaliye/);
    await expect(saveWaybill(u, "SALE", w, wh({ contactId: alici.id }), [{ productId: aku.id, name: "Akü", quantity: "1", unit: "C62" }])).rejects.toThrow(/değiştirilemez/);
    await expect(deleteWaybill(u, w)).rejects.toThrow(/silinemez/);
    // Alıcıya ulaştı
    Object.assign(nes.docs.get(saved.eDocUuid!)!, { outgoingStatus: "EnvelopeHasBeenTransferredToReceiverSuccessfully", despatchAnswer: "Waiting" });
    expect((await refreshDespatch(u, w)).status).toBe("ACCEPTED");
    expect((await db.waybill.findUniqueOrThrow({ where: { id: w } })).eDocAnswer).toBe("Waiting");
  });

  it("taşıma bilgisi eksikse NES'e gitmez ve düzeltilip tekrar gönderilebilir", async () => {
    const { u, alici, aku, waybill } = await setup();
    await testConnection(u);
    const w = await waybill(alici.id, { dispatchTime: "09:00" });
    await expect(sendDespatch(u, w)).rejects.toThrow(/Taşıma bilgisi gerekli/);
    expect(nes.uploads).toHaveLength(0);
    await saveWaybill(u, "SALE", w, wh({ contactId: alici.id, dispatchTime: "09:00", carrierTaxNumber: "9876543217", carrierTitle: "Kargo AŞ", carrierDistrict: "Kadıköy", carrierCity: "İstanbul" }), [{ productId: aku.id, name: "Akü", quantity: "2", unit: "C62" }]);
    expect((await db.waybill.findUniqueOrThrow({ where: { id: w } })).eDocStatus).toBe("NONE");
    await sendDespatch(u, w);
    expect(nes.uploads[0]!.xml).toContain("<cac:CarrierParty>");
    // Satış rolü gönderemez
    await expect(sendDespatch(await user("SALES"), w)).rejects.toThrow();
  });
});

describe("gelen e-İrsaliye", () => {
  it("içeri alınır, gelen irsaliyeye işlenir (tedarikçi VKN'den açılır, eşleşen ürün stoğa girer); ikinci kez işlenemez; irsaliye silinince yeniden işlenebilir", async () => {
    const { u, aku } = await setup();
    const xml = buildDespatchXml({ ...base, uuid: "aaaaaaaa-0000-0000-0000-000000000001", id: "TED2026000000005", supplier: { taxNumber: "5555555555", title: "Akü Toptan A.Ş.", taxOffice: "Kadıköy", address: "Depo", district: "Kadıköy", city: "İstanbul" }, lines: [{ name: "Akü", quantity: "4", unitCode: "C62" }, { name: "Bilinmeyen parça", quantity: "1", unitCode: "C62" }] });
    nes.incoming.set("aaaaaaaa-0000-0000-0000-000000000001", { xml, meta: { id: "aaaaaaaa-0000-0000-0000-000000000001", createdAt: "2026-10-05T10:00:00Z", issueDate: "2026-10-05T00:00:00", documentNumber: "TED2026000000005", despatchAnswer: "Waiting", despatchSupplierParty: { partyIdentification: "5555555555", partyName: "Akü Toptan A.Ş." } } });
    expect(await syncIncomingDespatches(u)).toEqual({ created: 1, updated: 0 });
    expect(await syncIncomingDespatches(u)).toEqual({ created: 0, updated: 1 });
    const inc = (await listIncomingDespatches(u)).rows[0]!;
    const r = await processIncomingDespatch(u, inc.id, { warehouseId: null });
    const w = await db.waybill.findUniqueOrThrow({ where: { id: r.waybillId }, include: { contact: true, lines: true } });
    expect([w.direction, w.waybillNo, w.contact.taxNumber, w.contact.kind, w.lines.length]).toEqual(["PURCHASE", "TED2026000000005", "5555555555", "SUPPLIER", 2]);
    expect((await db.product.findUniqueOrThrow({ where: { id: aku.id } })).stockQuantity.toString()).toBe("14");
    await expect(processIncomingDespatch(u, inc.id, { warehouseId: null })).rejects.toThrow(/zaten işlenmiş/);
    await deleteWaybill(u, r.waybillId);
    expect((await db.incomingDespatch.findUniqueOrThrow({ where: { id: inc.id } })).status).toBe("NEW");
    await setIncomingDespatchIgnored(u, inc.id, true);
    expect((await listIncomingDespatches(u, "IGNORED")).rows).toHaveLength(1);
  });
});
