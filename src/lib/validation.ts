import { z } from "zod";
import { checkTaxId } from "./tax-id";
import { isValidIban, normalizeIban } from "./iban";
import { parseMoneyInput } from "./money";
import { CURRENCIES, isUnitCode, VAT_RATES } from "./units";

/** Formdan gelen boş metin → null; doluysa kırpılmış ve uzunluk sınırlı */
export const optText = (max = 300) =>
  z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim().slice(0, max) : null));

const reqText = (msg: string, max = 300) => z.string().trim().min(1, msg).max(max, `En fazla ${max} karakter.`);

const optEmail = z
  .string()
  .optional()
  .transform((v) => v?.trim().toLowerCase() || null)
  .refine((v) => v === null || z.email().safeParse(v).success, "Geçerli bir e-posta girin.");

const optPhone = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim().slice(0, 30) : null))
  .refine((v) => v === null || (v.replace(/\D/g, "").length >= 7 && /^[\d\s()+\-.]+$/.test(v)), "Geçerli bir telefon girin.");

const optTaxId = z
  .string()
  .optional()
  .transform((v) => v?.replace(/\s/g, "") || null)
  .superRefine((v, ctx) => {
    if (v === null) return;
    const r = checkTaxId(v);
    if (!r.ok) ctx.addIssue({ code: "custom", message: r.message });
  });

/** Para / miktar alanı: "3.800,50" kabul edilir; boş → null. Sonuç decimal metni ("3800.5"). */
export const optDecimal = (opts: { min?: number; label?: string } = {}) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v?.trim()) return null;
      const d = parseMoneyInput(v);
      if (!d) {
        ctx.addIssue({ code: "custom", message: "Geçerli bir sayı girin." });
        return z.NEVER;
      }
      if (opts.min !== undefined && d.lessThan(opts.min)) {
        ctx.addIssue({ code: "custom", message: `${opts.label ?? "Değer"} ${opts.min}'dan küçük olamaz.` });
        return z.NEVER;
      }
      return d.toString();
    });

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

const currency = z.enum(CURRENCIES, { message: "Para birimi seçin." }).default("TRY");
const optDate = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Tarih YYYY-AA-GG olmalı.");

// ── Firma ──────────────────────────────────────────────────
export const companySchema = z.object({
  title: reqText("Ticari unvanı girin.", 250),
  taxNumber: optTaxId,
  taxOffice: optText(100),
  address: optText(500),
  district: optText(100),
  city: optText(100),
  postalCode: optText(10),
  phone: optPhone,
  email: optEmail,
  website: optText(200),
  sector: optText(100),
  mersisNo: optText(30),
  tradeRegNo: optText(30),
});

// ── Cari ───────────────────────────────────────────────────
export const contactSchema = z
  .object({
    kind: z.enum(["CUSTOMER", "SUPPLIER"]),
    personType: z.enum(["LEGAL", "NATURAL"]).default("LEGAL"),
    title: reqText("Unvan / ad soyad girin.", 250),
    shortName: optText(100),
    taxNumber: optTaxId,
    taxOffice: optText(100),
    categoryId: optText(50),
    email: optEmail,
    phone: optPhone,
    fax: optPhone,
    address: optText(500),
    isAbroad: checkbox,
    postalCode: optText(10),
    district: optText(100),
    city: optText(100),
    country: optText(100),
    currency,
    rateType: z.enum(["BUYING", "SELLING"]).default("BUYING"),
    hasOpeningBalance: checkbox,
    openingBalance: optDecimal({ min: 0, label: "Açılış bakiyesi" }),
    openingBalanceSide: z.enum(["DEBIT", "CREDIT"]).optional(),
    openingBalanceDate: optDate,
    notes: optText(2000),
  })
  .superRefine((v, ctx) => {
    // Gerçek kişi için TCKN, tüzel kişi için VKN beklenir (yurt dışı hariç)
    if (v.taxNumber && !v.isAbroad && !["11111111111", "2222222222"].includes(v.taxNumber)) {
      if (v.personType === "NATURAL" && v.taxNumber.length !== 11) ctx.addIssue({ code: "custom", path: ["taxNumber"], message: "Gerçek kişi için 11 haneli TCKN girin." });
    }
    if (v.hasOpeningBalance && !v.openingBalance) ctx.addIssue({ code: "custom", path: ["openingBalance"], message: "Açılış bakiyesi tutarını girin." });
  });

/** Formdaki tekrar eden satırlar: iban[], person_name[] … */
export function parseRepeated(fd: FormData) {
  const ibans = fd
    .getAll("iban")
    .map((v) => normalizeIban(String(v)))
    .filter(Boolean);
  const bad = ibans.find((i) => !isValidIban(i));
  const names = fd.getAll("person_name").map((v) => String(v).trim());
  const emails = fd.getAll("person_email").map((v) => String(v).trim());
  const phones = fd.getAll("person_phone").map((v) => String(v).trim());
  const notes = fd.getAll("person_notes").map((v) => String(v).trim());
  const people = names
    .map((name, i) => ({ name: name.slice(0, 150), email: emails[i] || null, phone: phones[i] || null, notes: notes[i]?.slice(0, 500) || null }))
    .filter((p) => p.name);
  const badEmail = people.find((p) => p.email && !z.email().safeParse(p.email).success);
  return { ibans: [...new Set(ibans)].slice(0, 10), invalidIban: bad ?? null, people: people.slice(0, 20), invalidPersonEmail: badEmail?.email ?? null };
}

// ── Ürün ───────────────────────────────────────────────────
export const productSchema = z
  .object({
    name: reqText("Ürün / hizmet adını girin.", 250),
    code: optText(60),
    barcode: optText(60),
    categoryId: optText(50),
    unit: z.string().refine(isUnitCode, "Birim seçin."),
    gtipCode: optText(20),
    trackStock: z.enum(["yes", "no"]).default("yes"),
    initialStock: optDecimal({ min: 0, label: "Başlangıç stoku" }),
    criticalEnabled: checkbox,
    criticalStock: optDecimal({ min: 0, label: "Kritik stok" }),
    buyPrice: optDecimal({ min: 0, label: "Alış fiyatı" }),
    buyCurrency: currency,
    sellPrice: optDecimal({ min: 0, label: "Satış fiyatı" }),
    sellCurrency: currency,
    vatRate: z.coerce.number().refine((n) => (VAT_RATES as readonly number[]).includes(n), "KDV oranı seçin."),
  })
  .superRefine((v, ctx) => {
    if (v.criticalEnabled && !v.criticalStock) ctx.addIssue({ code: "custom", path: ["criticalStock"], message: "Kritik stok miktarını girin." });
  });

// ── Kasa / banka ───────────────────────────────────────────
export const accountSchema = z
  .object({
    type: z.enum(["CASH", "BANK"]),
    name: reqText("Hesap adını girin.", 120),
    currency,
    bankName: optText(100),
    branch: optText(100),
    accountNo: optText(40),
    iban: z
      .string()
      .optional()
      .transform((v) => (v?.trim() ? normalizeIban(v) : null))
      .refine((v) => v === null || isValidIban(v), "IBAN geçersiz."),
    openingBalance: optDecimal({ label: "Açılış bakiyesi" }),
    openingDate: optDate,
  })
  .superRefine((v, ctx) => {
    if (v.type === "BANK" && !v.bankName) ctx.addIssue({ code: "custom", path: ["bankName"], message: "Banka adını girin." });
  });

// ── Kategori / etiket ──────────────────────────────────────
export const categorySchema = z.object({
  type: z.enum(["SALES", "EXPENSE", "CONTACT", "PRODUCT", "EMPLOYEE"]),
  name: reqText("Kategori adını girin.", 60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Renk seçin.")
    .default("#9e9e9e"),
});
export const tagSchema = z.object({ name: reqText("Etiket adını girin.", 40) });
