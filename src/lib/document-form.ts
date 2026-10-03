import { z } from "zod";
import { parseMoneyInput } from "./money";
import { CURRENCIES, isUnitCode, VAT_RATES } from "./units";
import { optText } from "./validation";

/** Fatura / teklif formu: başlık alanları + satır dizileri (line_*[]). Saf fonksiyon. */

const date = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const optDate = z
  .string()
  .optional()
  .transform((v) => v?.trim() || null)
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Tarih geçersiz.");

export const documentHeaderSchema = z
  .object({
    contactId: z.string().min(1, "Müşteri seçin."),
    name: optText(150),
    docNo: optText(40),
    issueDate: date("Düzenleme tarihini girin."),
    dueDate: optDate,
    currency: z.enum(CURRENCIES).default("TRY"),
    exchangeRate: z.string().optional(),
    categoryId: optText(50),
    notes: optText(2000),
    orderNo: optText(40),
    orderDate: optDate,
    stockMode: z.enum(["WITH_INVOICE", "NONE"]).default("WITH_INVOICE"),
    kind: z.enum(["INVOICE", "RETURN"]).default("INVOICE"),
    docDiscountType: z.enum(["PERCENT", "AMOUNT", ""]).optional(),
    docDiscountValue: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.dueDate && v.dueDate < v.issueDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Vade tarihi düzenleme tarihinden önce olamaz." });
  });

export interface ParsedLine {
  productId: string | null;
  name: string;
  description: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: string | null;
  vatRate: number;
  otvRate: string | null;
  withholdingRate: number | null;
  withholdingCode: string | null;
}

export type LineErrors = Record<number, string>;

/** Satırları okur; tamamen boş satırlar atlanır. Hatalı satırlar sıra numarasıyla döner. */
export function parseLines(fd: FormData): { lines: ParsedLine[]; errors: LineErrors } {
  const col = (k: string) => fd.getAll(`line_${k}`).map((v) => String(v));
  const names = col("name");
  const get = (k: string, i: number) => col(k)[i]?.trim() ?? "";
  const lines: ParsedLine[] = [];
  const errors: LineErrors = {};
  names.forEach((rawName, i) => {
    const name = rawName.trim();
    const qtyRaw = get("qty", i);
    const priceRaw = get("price", i);
    if (!name && !priceRaw && (!qtyRaw || qtyRaw === "1" || qtyRaw === "1,00")) return; // boş satır
    const row = lines.length + 1;
    const qty = parseMoneyInput(qtyRaw || "1");
    const price = parseMoneyInput(priceRaw || "0");
    const vat = Number(get("vat", i) || 20);
    const discType = get("discType", i);
    const disc = get("discValue", i) ? parseMoneyInput(get("discValue", i)) : null;
    const otv = get("otv", i) ? parseMoneyInput(get("otv", i)) : null;
    const wh = get("whRate", i) ? Number(get("whRate", i)) : null;
    const unit = get("unit", i) || "C62";
    if (!name) errors[row] = "Hizmet / ürün adını girin.";
    else if (!qty || qty.lessThanOrEqualTo(0)) errors[row] = "Miktar sıfırdan büyük olmalı.";
    else if (!price || price.isNegative()) errors[row] = "Birim fiyat geçersiz.";
    else if (!(VAT_RATES as readonly number[]).includes(vat)) errors[row] = "KDV oranı geçersiz.";
    else if (!isUnitCode(unit)) errors[row] = "Birim geçersiz.";
    else if (get("discValue", i) && (!disc || disc.isNegative())) errors[row] = "İndirim geçersiz.";
    else if (discType === "PERCENT" && disc && disc.greaterThan(100)) errors[row] = "İndirim %100'ü aşamaz.";
    else if (get("otv", i) && (!otv || otv.isNegative())) errors[row] = "ÖTV oranı geçersiz.";
    else if (wh !== null && (!Number.isInteger(wh) || wh <= 0 || wh > 100)) errors[row] = "Tevkifat oranı geçersiz.";
    lines.push({
      productId: get("productId", i) || null,
      name: name.slice(0, 250),
      description: get("desc", i).slice(0, 500) || null,
      quantity: qty?.toString() ?? "0",
      unit,
      unitPrice: price?.toString() ?? "0",
      discountType: disc && !disc.isZero() && (discType === "PERCENT" || discType === "AMOUNT") ? discType : null,
      discountValue: disc && !disc.isZero() ? disc.toString() : null,
      vatRate: vat,
      otvRate: otv && !otv.isZero() ? otv.toString() : null,
      withholdingRate: wh,
      withholdingCode: wh ? get("whCode", i).slice(0, 10) || null : null,
    });
  });
  return { lines: lines.slice(0, 200), errors };
}

export function parseDocDiscount(type: string | undefined, value: string | undefined) {
  if (!type || !value?.trim()) return { discountType: null, discountValue: null } as const;
  const v = parseMoneyInput(value);
  if (!v || v.isNegative()) return { error: "Genel indirim geçersiz." } as const;
  if (type === "PERCENT" && v.greaterThan(100)) return { error: "Genel indirim %100'ü aşamaz." } as const;
  if (v.isZero()) return { discountType: null, discountValue: null } as const;
  return { discountType: type as "PERCENT" | "AMOUNT", discountValue: v.toString() } as const;
}
