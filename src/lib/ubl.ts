import Decimal from "decimal.js";
import { withholdingByCode, OTV_NAMES } from "./gib-codes";

/**
 * UBL-TR 1.2 fatura XML'i — saf fonksiyon. Kaynak: NES dokümanı (UBL-TR Fatura, örnek XML'ler).
 * - Tüm metinler XML kaçışlıdır (unvandaki "&" faturayı bozmaz).
 * - Satır ve genel indirim satır AllowanceCharge'ına yazılır (genel indirim satırlara dağıtılmış gelir).
 * - Toplamlar: LineExtension = brüt, AllowanceTotal = indirim, TaxExclusive = matrah,
 *   TaxInclusive = matrah + vergiler, Payable = TaxInclusive − tevkifat.
 * - İmza (cac:Signature / mali mühür) NES tarafından eklenir.
 */

export type UblProfile = "TICARIFATURA" | "TEMELFATURA" | "EARSIVFATURA";
export type UblTypeCode = "SATIS" | "IADE" | "TEVKIFAT" | "TEVKIFATIADE" | "ISTISNA";

export interface UblParty {
  taxNumber: string;
  /** Unvan (VKN) veya ad soyad (TCKN) */
  title: string;
  taxOffice?: string | null;
  address?: string | null;
  district?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

export interface UblLine {
  name: string;
  description?: string | null;
  code?: string | null;
  quantity: Decimal.Value;
  unitCode: string;
  unitPrice: Decimal.Value;
  grossAmount: Decimal.Value;
  discountAmount: Decimal.Value;
  netAmount: Decimal.Value;
  vatRate: number;
  vatAmount: Decimal.Value;
  vatExemptionCode?: string | null;
  vatExemptionReason?: string | null;
  otvCode?: string | null;
  otvRate?: Decimal.Value | null;
  otvAmount: Decimal.Value;
  withholdingCode?: string | null;
  withholdingRate?: number | null;
  withholdingAmount: Decimal.Value;
}

export interface UblInvoice {
  uuid: string;
  /** 3 harfli seri (NES numara verir) veya 16 haneli tam numara */
  id: string;
  profile: UblProfile;
  kind: "INVOICE" | "RETURN";
  issueDate: string;
  issueTime: string;
  currency: string;
  exchangeRate?: Decimal.Value | null;
  notes: string[];
  orderNo?: string | null;
  orderDate?: string | null;
  dueDate?: string | null;
  returnRef?: { no: string; date: string } | null;
  /** e-Arşiv gönderim şekli */
  sendType?: "ELEKTRONIK" | "KAGIT";
  supplier: UblParty;
  customer: UblParty;
  lines: UblLine[];
  totals: { grossTotal: Decimal.Value; discountTotal: Decimal.Value; netTotal: Decimal.Value; otvTotal: Decimal.Value; vatTotal: Decimal.Value; withholdingTotal: Decimal.Value; grandTotal: Decimal.Value; payableTotal: Decimal.Value };
}

// ── Yardımcılar ────────────────────────────────────────────

export function xmlEscape(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
/** Tutar: 2 hane */
const amt = (v: Decimal.Value) => D(v).toFixed(2);
/** Miktar / fiyat / oran: gereksiz sıfırlar atılır */
const num = (v: Decimal.Value, dp = 8) => D(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toString();
const tag = (name: string, value: string | null | undefined, attrs = "") => (value === null || value === undefined || value === "" ? "" : `<${name}${attrs}>${xmlEscape(value)}</${name}>`);
const money = (name: string, v: Decimal.Value, cur: string) => `<${name} currencyID="${xmlEscape(cur)}">${amt(v)}</${name}>`;

/** Fatura tipi: iade / tevkifat / istisna satırlara göre otomatik */
export function invoiceTypeCode(kind: "INVOICE" | "RETURN", lines: Pick<UblLine, "withholdingCode" | "vatRate" | "vatExemptionCode">[]): UblTypeCode {
  const withholding = lines.some((l) => l.withholdingCode);
  if (kind === "RETURN") return withholding ? "TEVKIFATIADE" : "IADE";
  if (withholding) return "TEVKIFAT";
  if (lines.some((l) => l.vatRate === 0 && l.vatExemptionCode && l.vatExemptionCode !== "351")) return "ISTISNA";
  return "SATIS";
}

/** Gönderim öncesi kontroller — eksik / çelişkili bilgi Türkçe mesajla döner (boşsa gönderilebilir) */
export function validateForUbl(inv: UblInvoice): string[] {
  const errs: string[] = [];
  const party = (p: UblParty, who: string) => {
    if (!/^\d{10,11}$/.test(p.taxNumber)) errs.push(`${who} VKN / TCKN eksik veya hatalı.`);
    if (!p.title.trim()) errs.push(`${who} unvanı / adı eksik.`);
    if (!p.city?.trim()) errs.push(`${who} il bilgisi eksik.`);
    if (!p.district?.trim()) errs.push(`${who} ilçe bilgisi eksik.`);
    if (p.taxNumber.length === 11 && p.title.trim().split(/\s+/).length < 2 && p.taxNumber !== "11111111111") errs.push(`${who} TCKN'li; ad ve soyad birlikte yazılmalı.`);
  };
  party(inv.supplier, "Firma (satıcı)");
  if (!inv.supplier.taxOffice?.trim()) errs.push("Firma vergi dairesi eksik (Firma Bilgileri).");
  party(inv.customer, "Müşteri");
  if (inv.profile !== "EARSIVFATURA" && !inv.customer.taxOffice?.trim()) errs.push("e-Fatura alıcısının vergi dairesi eksik.");
  if (!/^[A-Z0-9]{3}$/.test(inv.id) && !/^[A-Z0-9]{3}\d{13}$/.test(inv.id)) errs.push("Fatura serisi 3 karakter olmalı (e-Fatura Ayarları).");
  if (inv.lines.length === 0) errs.push("Faturada satır yok.");
  inv.lines.forEach((l, i) => {
    if (l.vatRate === 0 && !l.vatExemptionCode) errs.push(`${i + 1}. satır: KDV %0 ise istisna sebebi seçilmeli.`);
    if (l.withholdingCode && !withholdingByCode(l.withholdingCode)) errs.push(`${i + 1}. satır: tevkifat kodu geçersiz.`);
    if (l.withholdingCode && l.vatRate === 0) errs.push(`${i + 1}. satır: KDV'siz satırda tevkifat olamaz.`);
  });
  const hasWh = inv.lines.some((l) => l.withholdingCode);
  const hasExempt = inv.lines.some((l) => l.vatRate === 0 && l.vatExemptionCode && l.vatExemptionCode !== "351");
  if (hasWh && hasExempt) errs.push("Aynı faturada hem tevkifat hem KDV istisnası olamaz; ayrı faturalar kesin.");
  if (inv.kind === "RETURN" && !inv.returnRef) errs.push("İade faturasında iade edilen faturanın numarası ve tarihi girilmeli.");
  if (inv.currency !== "TRY" && !(inv.exchangeRate && D(inv.exchangeRate).greaterThan(0))) errs.push("Dövizli faturada kur gerekli.");
  return errs;
}

function partyXml(p: UblParty) {
  const isPerson = p.taxNumber.length === 11;
  const words = p.title.trim().split(/\s+/);
  const family = isPerson ? words.length > 1 ? words.pop()! : "." : "";
  const first = isPerson ? words.join(" ") || p.title : "";
  return [
    "<cac:Party>",
    tag("cbc:WebsiteURI", p.website),
    `<cac:PartyIdentification><cbc:ID schemeID="${isPerson ? "TCKN" : "VKN"}">${xmlEscape(p.taxNumber)}</cbc:ID></cac:PartyIdentification>`,
    isPerson ? "" : `<cac:PartyName>${tag("cbc:Name", p.title)}</cac:PartyName>`,
    "<cac:PostalAddress>",
    tag("cbc:StreetName", p.address || "-"),
    tag("cbc:CitySubdivisionName", p.district),
    tag("cbc:CityName", p.city),
    tag("cbc:PostalZone", p.postalCode),
    `<cac:Country>${tag("cbc:Name", p.country || "Türkiye")}</cac:Country>`,
    "</cac:PostalAddress>",
    p.taxOffice ? `<cac:PartyTaxScheme><cac:TaxScheme>${tag("cbc:Name", p.taxOffice)}</cac:TaxScheme></cac:PartyTaxScheme>` : "",
    p.phone || p.email ? `<cac:Contact>${tag("cbc:Telephone", p.phone)}${tag("cbc:ElectronicMail", p.email)}</cac:Contact>` : "",
    isPerson ? `<cac:Person>${tag("cbc:FirstName", first)}${tag("cbc:FamilyName", family)}</cac:Person>` : "",
    "</cac:Party>",
  ].join("");
}

interface Sub { code: string; name: string; percent: Decimal; base: Decimal; amount: Decimal; exemption?: { code: string; reason: string } | null }

function subtotalXml(s: Sub, cur: string, seq: number) {
  return [
    "<cac:TaxSubtotal>",
    money("cbc:TaxableAmount", s.base, cur),
    money("cbc:TaxAmount", s.amount, cur),
    `<cbc:CalculationSequenceNumeric>${seq}</cbc:CalculationSequenceNumeric>`,
    `<cbc:Percent>${num(s.percent, 4)}</cbc:Percent>`,
    "<cac:TaxCategory>",
    s.exemption ? tag("cbc:TaxExemptionReasonCode", s.exemption.code) + tag("cbc:TaxExemptionReason", s.exemption.reason) : "",
    `<cac:TaxScheme>${tag("cbc:Name", s.name)}${tag("cbc:TaxTypeCode", s.code)}</cac:TaxScheme>`,
    "</cac:TaxCategory>",
    "</cac:TaxSubtotal>",
  ].join("");
}

function lineSubs(l: UblLine): { taxes: Sub[]; withholding: Sub | null } {
  const net = D(l.netAmount);
  const taxes: Sub[] = [];
  if (l.otvCode && D(l.otvRate).greaterThan(0)) taxes.push({ code: l.otvCode, name: OTV_NAMES[l.otvCode] ?? "ÖTV", percent: D(l.otvRate), base: net, amount: D(l.otvAmount) });
  taxes.push({
    code: "0015",
    name: "KDV",
    percent: new Decimal(l.vatRate),
    base: net.plus(D(l.otvAmount)),
    amount: D(l.vatAmount),
    exemption: l.vatRate === 0 && l.vatExemptionCode ? { code: l.vatExemptionCode, reason: l.vatExemptionReason ?? l.vatExemptionCode } : null,
  });
  const withholding = l.withholdingCode ? { code: l.withholdingCode, name: "KDV TEVKİFAT", percent: new Decimal(l.withholdingRate ?? 0), base: D(l.vatAmount), amount: D(l.withholdingAmount) } : null;
  return { taxes, withholding };
}

export function buildInvoiceXml(inv: UblInvoice): string {
  const cur = inv.currency;
  const typeCode = invoiceTypeCode(inv.kind, inv.lines);

  // Belge seviyesinde vergi alt toplamları: (kod, oran, istisna) bazında birleştirilir
  const docTaxes = new Map<string, Sub>();
  const docWh = new Map<string, Sub>();
  const linesXml = inv.lines.map((l, i) => {
    const { taxes, withholding } = lineSubs(l);
    for (const s of taxes) {
      const k = `${s.code}|${s.percent}|${s.exemption?.code ?? ""}`;
      const cur2 = docTaxes.get(k);
      docTaxes.set(k, cur2 ? { ...cur2, base: cur2.base.plus(s.base), amount: cur2.amount.plus(s.amount) } : { ...s });
    }
    if (withholding) {
      const k = `${withholding.code}|${withholding.percent}`;
      const w = docWh.get(k);
      docWh.set(k, w ? { ...w, base: w.base.plus(withholding.base), amount: w.amount.plus(withholding.amount) } : { ...withholding });
    }
    const gross = D(l.grossAmount);
    const disc = D(l.discountAmount);
    const lineTax = taxes.reduce((a, s) => a.plus(s.amount), new Decimal(0));
    return [
      "<cac:InvoiceLine>",
      `<cbc:ID>${i + 1}</cbc:ID>`,
      tag("cbc:Note", l.description),
      `<cbc:InvoicedQuantity unitCode="${xmlEscape(l.unitCode)}">${num(l.quantity, 4)}</cbc:InvoicedQuantity>`,
      money("cbc:LineExtensionAmount", l.netAmount, cur),
      disc.greaterThan(0)
        ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:MultiplierFactorNumeric>${num(gross.isZero() ? 0 : disc.dividedBy(gross), 6)}</cbc:MultiplierFactorNumeric>${money("cbc:Amount", disc, cur)}${money("cbc:BaseAmount", gross, cur)}</cac:AllowanceCharge>`
        : "",
      `<cac:TaxTotal>${money("cbc:TaxAmount", lineTax, cur)}${taxes.map((s, j) => subtotalXml(s, cur, j + 1)).join("")}</cac:TaxTotal>`,
      withholding ? `<cac:WithholdingTaxTotal>${money("cbc:TaxAmount", withholding.amount, cur)}${subtotalXml(withholding, cur, 1)}</cac:WithholdingTaxTotal>` : "",
      `<cac:Item>${tag("cbc:Name", l.name)}${l.code ? `<cac:SellersItemIdentification>${tag("cbc:ID", l.code)}</cac:SellersItemIdentification>` : ""}</cac:Item>`,
      `<cac:Price><cbc:PriceAmount currencyID="${xmlEscape(cur)}">${num(l.unitPrice, 8)}</cbc:PriceAmount></cac:Price>`,
      "</cac:InvoiceLine>",
    ].join("");
  });

  const t = inv.totals;
  const taxInclusive = D(t.netTotal).plus(D(t.otvTotal)).plus(D(t.vatTotal));
  const docTaxTotal = [...docTaxes.values()].reduce((a, s) => a.plus(s.amount), new Decimal(0));
  const whTotal = [...docWh.values()].reduce((a, s) => a.plus(s.amount), new Decimal(0));
  const notes = [...inv.notes.filter(Boolean), `YALNIZ : ${amountInWords(D(t.payableTotal), cur)}`];

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">`,
    "<cbc:UBLVersionID>2.1</cbc:UBLVersionID>",
    "<cbc:CustomizationID>TR1.2</cbc:CustomizationID>",
    tag("cbc:ProfileID", inv.profile),
    tag("cbc:ID", inv.id),
    "<cbc:CopyIndicator>false</cbc:CopyIndicator>",
    tag("cbc:UUID", inv.uuid),
    tag("cbc:IssueDate", inv.issueDate),
    tag("cbc:IssueTime", inv.issueTime),
    tag("cbc:InvoiceTypeCode", typeCode),
    ...notes.map((n) => tag("cbc:Note", n.slice(0, 1000))),
    tag("cbc:DocumentCurrencyCode", cur),
    cur !== "TRY" ? tag("cbc:PricingCurrencyCode", cur) : "",
    `<cbc:LineCountNumeric>${inv.lines.length}</cbc:LineCountNumeric>`,
    inv.orderNo ? `<cac:OrderReference>${tag("cbc:ID", inv.orderNo)}${tag("cbc:IssueDate", inv.orderDate ?? inv.issueDate)}</cac:OrderReference>` : "",
    inv.returnRef
      ? `<cac:BillingReference><cac:InvoiceDocumentReference>${tag("cbc:ID", inv.returnRef.no)}${tag("cbc:IssueDate", inv.returnRef.date)}${tag("cbc:DocumentTypeCode", "IADE")}</cac:InvoiceDocumentReference></cac:BillingReference>`
      : "",
    inv.profile === "EARSIVFATURA"
      ? `<cac:AdditionalDocumentReference>${tag("cbc:ID", inv.sendType ?? "ELEKTRONIK")}${tag("cbc:IssueDate", inv.issueDate)}${tag("cbc:DocumentTypeCode", "SEND_TYPE")}</cac:AdditionalDocumentReference>`
      : "",
    `<cac:AccountingSupplierParty>${partyXml(inv.supplier)}</cac:AccountingSupplierParty>`,
    `<cac:AccountingCustomerParty>${partyXml(inv.customer)}</cac:AccountingCustomerParty>`,
    inv.dueDate && inv.dueDate > inv.issueDate ? `<cac:PaymentMeans><cbc:PaymentMeansCode>1</cbc:PaymentMeansCode>${tag("cbc:PaymentDueDate", inv.dueDate)}</cac:PaymentMeans>` : "",
    cur !== "TRY"
      ? `<cac:PricingExchangeRate>${tag("cbc:SourceCurrencyCode", cur)}<cbc:TargetCurrencyCode>TRY</cbc:TargetCurrencyCode><cbc:CalculationRate>${num(inv.exchangeRate ?? 0, 6)}</cbc:CalculationRate>${tag("cbc:Date", inv.issueDate)}</cac:PricingExchangeRate>`
      : "",
    `<cac:TaxTotal>${money("cbc:TaxAmount", docTaxTotal, cur)}${[...docTaxes.values()].map((s, j) => subtotalXml(s, cur, j + 1)).join("")}</cac:TaxTotal>`,
    docWh.size ? `<cac:WithholdingTaxTotal>${money("cbc:TaxAmount", whTotal, cur)}${[...docWh.values()].map((s, j) => subtotalXml(s, cur, j + 1)).join("")}</cac:WithholdingTaxTotal>` : "",
    "<cac:LegalMonetaryTotal>",
    money("cbc:LineExtensionAmount", t.grossTotal, cur),
    money("cbc:TaxExclusiveAmount", t.netTotal, cur),
    money("cbc:TaxInclusiveAmount", taxInclusive, cur),
    money("cbc:AllowanceTotalAmount", t.discountTotal, cur),
    money("cbc:PayableAmount", taxInclusive.minus(whTotal), cur),
    "</cac:LegalMonetaryTotal>",
    ...linesXml,
    "</Invoice>",
  ].join("\n");
}

// ── Tutarı yazıyla (fatura notu: "YALNIZ : ...") ─────────

const ONES = ["", "BİR", "İKİ", "ÜÇ", "DÖRT", "BEŞ", "ALTI", "YEDİ", "SEKİZ", "DOKUZ"];
const TENS = ["", "ON", "YİRMİ", "OTUZ", "KIRK", "ELLİ", "ALTMIŞ", "YETMİŞ", "SEKSEN", "DOKSAN"];
const SCALES = ["", "BİN", "MİLYON", "MİLYAR", "TRİLYON"];

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  return `${h ? (h === 1 ? "YÜZ" : `${ONES[h]}YÜZ`) : ""}${TENS[t]}${ONES[o]}`;
}

export function numberToWordsTr(n: number): string {
  if (n === 0) return "SIFIR";
  const parts: string[] = [];
  let scale = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(scale === 1 && chunk === 1 ? "BİN" : `${threeDigits(chunk)}${SCALES[scale]}`);
    n = Math.floor(n / 1000);
    scale++;
  }
  return parts.join("");
}

const CUR_WORDS: Record<string, [string, string]> = { TRY: ["TL", "Kr."], USD: ["USD", "Cent"], EUR: ["EUR", "Cent"], GBP: ["GBP", "Pence"] };

export function amountInWords(v: Decimal, currency: string): string {
  const [main, sub] = CUR_WORDS[currency] ?? [currency, ""];
  const r = v.abs().toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const int = r.floor().toNumber();
  const kurus = r.minus(r.floor()).times(100).round().toNumber();
  return `${numberToWordsTr(int)} ${main} ${numberToWordsTr(kurus)} ${sub}`.trim();
}
