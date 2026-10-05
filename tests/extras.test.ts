import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/server/db";
import type { UserRole } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/server/auth/session";
import { documentHeaderSchema, type ParsedLine } from "@/lib/document-form";
import { contactSchema } from "@/lib/validation";
import { createContact } from "@/server/services/contacts";
import { saveInvoice } from "@/server/services/invoices";
import { expenseSchema, saveExpense } from "@/server/services/expenses";
import { parseTcmbXml, tcmbRate } from "@/server/services/rates";
import { addPeriod, recurSchema, runRecurring, setRecurring, stopRecurring } from "@/server/services/recurring";
import { detectImageMime, saveLogo } from "@/server/services/company";
import { recentActivity } from "@/server/services/reports";
import { resetDb } from "./helpers";

const rep = { ibans: [], people: [], invalidIban: null, invalidPersonEmail: null };
async function user(role: UserRole = "ADMIN"): Promise<CurrentUser> {
  const u = await db.user.create({ data: { email: `${role}-${Math.random()}@t.local`, name: role, passwordHash: "x:y", role } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, isActive: true };
}
const line = (o: Partial<ParsedLine> = {}): ParsedLine => ({
  productId: null, name: "Bakım hizmeti", description: null, quantity: "1", unit: "C62", unitPrice: "1000", discountType: null, discountValue: null,
  vatRate: 20, vatExemptionCode: null, otvRate: null, otvCode: null, withholdingRate: null, withholdingCode: null, ...o,
});
const FIXTURE = readFileSync("tests/fixtures/tcmb-kurlar.xml", "utf8");

beforeEach(resetDb);
afterEach(() => vi.unstubAllGlobals());

describe("TCMB kuru", () => {
  it("XML ayrıştırılır; 100 birimlik kur birime bölünür", () => {
    const b = parseTcmbXml(FIXTURE);
    expect(b.bulletinDate).toBe("2026-10-02");
    expect(b.rates.get("USD")!.buying.toString()).toBe("48.9699");
    const jpy = b.rates.get("JPY")!;
    expect(jpy.buying.lessThan(1)).toBe(true); // 100 JPY kuru / 100
  });

  it("belge tarihinden önceki iş günü bülteni: hafta sonu atlanır, sonuç önbelleğe yazılır", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      // 04.10 (Pazar) ve 03.10 (Cumartesi) yok, 02.10 (Cuma) var
      return url.endsWith("02102026.xml") ? new Response(FIXTURE, { status: 200 }) : new Response("yok", { status: 404 });
    });
    const r = await tcmbRate("USD", "2026-10-05");
    expect([r.buying.toString(), r.bulletinDate]).toEqual(["48.9699", "2026-10-02"]);
    expect(calls.map((u) => u.split("/").pop())).toEqual(["04102026.xml", "03102026.xml", "02102026.xml"]);
    // İkinci istek önbellekten (fetch çağrılmaz)
    vi.stubGlobal("fetch", async () => { throw new Error("çağrılmamalı"); });
    expect((await tcmbRate("USD", "2026-10-05")).buying.toString()).toBe("48.9699");
  });

  it("TCMB'ye ulaşılamazsa anlaşılır hata", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("ağ yok"); });
    await expect(tcmbRate("EUR", "2026-09-15")).rejects.toThrow(/TCMB'ye ulaşılamadı/);
  });
});

describe("tekrarlayan fatura", () => {
  it("ay sonu korunur: 31 Ocak → 28 Şubat → 31 Mart", () => {
    const feb = addPeriod(new Date("2026-01-31"), "MONTHLY", 1, 31);
    expect(feb.toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addPeriod(feb, "MONTHLY", 1, 31).toISOString().slice(0, 10)).toBe("2026-03-31");
    expect(addPeriod(new Date("2024-02-29"), "YEARLY", 1, 29).toISOString().slice(0, 10)).toBe("2025-02-28");
  });

  it("geciken dönemler telafi edilir, her dönem bir kez; kopya taslak ve vade farkı korunur; bitişte durur", async () => {
    const u = await user();
    const c = await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "Abone Müşteri" }), rep);
    const tpl = await saveInvoice(u, null, { direction: "SALE", header: documentHeaderSchema.parse({ contactId: c.id, issueDate: "2026-07-15", dueDate: "2026-07-25", name: "Aylık bakım" }), lines: [line()], discount: { discountType: null, discountValue: null }, tagIds: [] });
    await setRecurring(u, tpl, recurSchema.parse({ period: "MONTHLY", interval: "1", nextDate: "2026-08-15", endDate: "2026-12-31" }));
    const today = new Date("2026-10-05T00:00:00Z");
    expect(await runRecurring(today)).toEqual({ created: 2, errors: 0 }); // 15 Ağustos, 15 Eylül
    expect(await runRecurring(today)).toEqual({ created: 0, errors: 0 });
    const copies = await db.invoice.findMany({ where: { recurringId: { not: null } }, orderBy: { issueDate: "asc" } });
    expect(copies.map((i) => [i.issueDate.toISOString().slice(0, 10), i.dueDate.toISOString().slice(0, 10), i.eDocStatus, i.name])).toEqual([
      ["2026-08-15", "2026-08-25", "NONE", "Aylık bakım"],
      ["2026-09-15", "2026-09-25", "NONE", "Aylık bakım"],
    ]);
    expect(copies.every((i) => i.payableTotal.toString() === "1200")).toBe(true);
    const r = await db.recurringInvoice.findUniqueOrThrow({ where: { templateId: tpl } });
    expect([r.nextDate.toISOString().slice(0, 10), r.createdCount]).toEqual(["2026-10-15", 2]);
    // Bitiş tarihinden sonrası oluşmaz
    expect((await runRecurring(new Date("2027-03-01T00:00:00Z"))).created).toBe(3); // Ekim, Kasım, Aralık
    expect((await db.recurringInvoice.findUniqueOrThrow({ where: { templateId: tpl } })).isActive).toBe(false);
    await stopRecurring(u, tpl);
    await expect(setRecurring(await user("VIEWER"), tpl, recurSchema.parse({ period: "YEARLY", interval: "1", nextDate: "2027-01-01" }))).rejects.toThrow();
  });

  it("alış faturası tekrarlanamaz", async () => {
    const u = await user();
    const s = await createContact(u, contactSchema.parse({ kind: "SUPPLIER", title: "Tedarikçi" }), rep);
    const p = await saveInvoice(u, null, { direction: "PURCHASE", header: documentHeaderSchema.parse({ contactId: s.id, issueDate: "2026-10-01" }), lines: [line()], discount: { discountType: null, discountValue: null }, tagIds: [] });
    await expect(setRecurring(u, p, recurSchema.parse({ period: "MONTHLY", interval: "1", nextDate: "2026-11-01" }))).rejects.toThrow(/Yalnızca satış/);
  });
});

describe("logo ve son işlemler", () => {
  it("logo türü içerikten belirlenir: SVG / metin reddedilir, PNG kabul", async () => {
    const u = await user();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(detectImageMime(png)).toBe("image/png");
    await expect(saveLogo(u, new File(['<svg onload="alert(1)"/>'], "logo.png", { type: "image/png" }))).rejects.toThrow(/Yalnızca PNG/);
    await saveLogo(u, new File([png], "logo.png", { type: "image/png" }));
    expect((await db.companyLogo.findUniqueOrThrow({ where: { id: "firma" } })).mime).toBe("image/png");
    await expect(saveLogo(u, new File([new Uint8Array(400 * 1024)], "buyuk.png"))).rejects.toThrow(/300 KB/);
  });

  it("son işlemler yetkiye göre: satış rolü gideri görmez", async () => {
    const u = await user();
    const c = await createContact(u, contactSchema.parse({ kind: "CUSTOMER", title: "Müşteri" }), rep);
    await saveInvoice(u, null, { direction: "SALE", header: documentHeaderSchema.parse({ contactId: c.id, issueDate: "2026-10-01" }), lines: [line()], discount: { discountType: null, discountValue: null }, tagIds: [] });
    await saveExpense(u, null, expenseSchema.parse({ kind: "RECEIPT", description: "Kırtasiye", date: "2026-10-02", totalAmount: "60", vatRate: "20" }));
    expect((await recentActivity(u)).map((r) => r.label)).toEqual(["Fiş / fatura", "Satış faturası"]);
    expect((await recentActivity(await user("SALES"))).map((r) => r.label)).toEqual(["Satış faturası"]);
  });
});
