import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { can } from "@/server/auth/permissions";
import { checkLoginRate, resetLoginRate } from "@/server/auth/rate-limit";
import { formatMoney, formatMoneyParts, parseMoneyInput, round2 } from "@/lib/money";
import { activeGroupKey, ALL_LINKS } from "@/lib/nav";
import { nesErrorMessage } from "@/server/nes/client";

/** Birim fiyat biçimi (4 haneye kadar) */
const formatMoneyPartsStr = (v: string) => { const p = formatMoneyParts(v, "TRY", 4); return `${p.sign}${p.int},${p.frac}${p.symbol}`; };

describe("şifre", () => {
  it("doğru şifreyi kabul eder, yanlışı reddeder; aynı şifre farklı özet üretir", async () => {
    const a = await hashPassword("cok-gizli-sifre");
    const b = await hashPassword("cok-gizli-sifre");
    expect(a).not.toBe(b);
    expect(await verifyPassword("cok-gizli-sifre", a)).toBe(true);
    expect(await verifyPassword("yanlis-sifre", a)).toBe(false);
    expect(await verifyPassword("x", "bozuk")).toBe(false);
  });
});

describe("yetkiler", () => {
  it("e-fatura resmileştirme yalnızca yönetici ve muhasebede", () => {
    expect(can("ADMIN", "einvoice.send")).toBe(true);
    expect(can("ACCOUNTANT", "einvoice.send")).toBe(true);
    expect(can("SALES", "einvoice.send")).toBe(false);
    expect(can("VIEWER", "sales.write")).toBe(false);
    expect(can("SALES", "expenses.read")).toBe(false);
  });
});

describe("giriş deneme sınırı", () => {
  it("15 dakikada 10 denemeden sonra durdurur, süre geçince açar", () => {
    resetLoginRate();
    const t = Date.now();
    for (let i = 0; i < 10; i++) checkLoginRate("a@b.com", t);
    expect(() => checkLoginRate("a@b.com", t)).toThrow(/Çok fazla deneme/);
    expect(() => checkLoginRate("baska@b.com", t)).not.toThrow();
    expect(() => checkLoginRate("a@b.com", t + 16 * 60_000)).not.toThrow();
  });
});

describe("para", () => {
  it("Türkçe biçim ve yarım-yukarı yuvarlama", () => {
    expect(formatMoney("3800")).toBe("3.800,00₺");
    expect(formatMoney("1234567.891")).toBe("1.234.567,89₺");
    expect(formatMoney("-0.005")).toBe("-0,01₺");
    expect(formatMoney("10", "USD")).toBe("10,00$");
    expect(round2("2.675").toString()).toBe("2.68"); // float'ta 2.67 çıkar
    // Birim fiyat: 4 haneye kadar, en az 2
    expect(formatMoneyPartsStr("3166.666666")).toBe("3.166,6667₺");
    expect(formatMoneyPartsStr("3800")).toBe("3.800,00₺");
    expect(formatMoneyPartsStr("12.5")).toBe("12,50₺");
    expect(formatMoneyPartsStr("1.2340")).toBe("1,234₺");
  });

  it("kullanıcı girişini çözer", () => {
    expect(parseMoneyInput("3.800,50")?.toString()).toBe("3800.5");
    expect(parseMoneyInput("3,800.50")?.toString()).toBe("3800.5");
    expect(parseMoneyInput("3800,5")?.toString()).toBe("3800.5");
    expect(parseMoneyInput("3.800")?.toString()).toBe("3800");
    expect(parseMoneyInput("12.5")?.toString()).toBe("12.5");
    expect(parseMoneyInput("1.250 ₺")?.toString()).toBe("1250");
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("")).toBeNull();
  });
});

describe("menü", () => {
  it("bağlantılar benzersiz ve alt sayfada doğru grup etkin", () => {
    const hrefs = ALL_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(activeGroupKey("/musteriler/abc")).toBe("sales");
    expect(activeGroupKey("/raporlar/kdv")).toBe("expenses");
    expect(activeGroupKey("/firma-bilgileri")).toBe("settings");
    expect(activeGroupKey("/")).toBeNull();
  });
});

describe("NES hata mesajı", () => {
  it("422 şematron ayrıntısı ve 400 alan hataları gösterilir", () => {
    const m = nesErrorMessage(422, JSON.stringify({ message: "HATALI ISTEK", errors: [{ code: "1150", description: "SCHEMATRON_CHECK_RESULT_HAS_FAILED", detail: "Satıcı vergi dairesi boş olamaz" }] }));
    expect(m).toBe("NES hatası (422): HATALI ISTEK · SCHEMATRON_CHECK_RESULT_HAS_FAILED — Satıcı vergi dairesi boş olamaz");
    expect(nesErrorMessage(400, JSON.stringify({ message: "GECERSIZ ISTEK", invalidFields: [{ field: "SenderAlias", description: "Gönderici Etiketi boş geçilemez!", detail: "" }] }))).toBe("NES hatası (400): GECERSIZ ISTEK · SenderAlias: Gönderici Etiketi boş geçilemez!");
  });
});

describe("NES seri hatası", () => {
  it("e-Fatura / e-Arşiv seri çakışmasında yol gösterilir", () => {
    const m = nesErrorMessage(422, JSON.stringify({ message: "HATALI ISTEK", errors: [{ description: "SCHEMATRON_CHECK_RESULT_HAS_FAILED", detail: "E-FATURA'DA KULLANILAN SERI TESPIT EDILDI. E-FATURA/E-ARSIV SERILERI BIRBIRINDEN FARKLI OLMALIDIR : MFB" }] }));
    expect(m).toMatch(/NES portalında bu belge türü için tanımlı başka bir seri/);
  });
});
