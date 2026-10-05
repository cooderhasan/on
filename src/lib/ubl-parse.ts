import { XMLParser } from "fast-xml-parser";
import Decimal from "decimal.js";
import { isUnitCode } from "./units";
import { VAT_RATES } from "./units";

/**
 * Gelen UBL-TR faturasını okur (saf). Satırlar uygulamanın satır biçimine çevrilir:
 * satır indirimi tutar olarak, tevkifat kodu / oranı, KDV istisna kodu, ÖTV kodu / oranı.
 * Bilinmeyen birim "Adet", listede olmayan KDV oranı hata olarak döner (sessizce değiştirilmez).
 */

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true, isArray: (name) => ["InvoiceLine", "TaxSubtotal", "AllowanceCharge", "Note", "PartyIdentification"].includes(name) });

type Node = Record<string, unknown>;
const txt = (v: unknown): string => (v === undefined || v === null ? "" : typeof v === "object" ? String((v as Node)["#text"] ?? "") : String(v));
const arr = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const dec = (v: unknown) => {
  const s = txt(v);
  return s ? new Decimal(s) : new Decimal(0);
};

export interface ParsedParty {
  taxNumber: string | null;
  title: string;
  taxOffice: string | null;
  address: string | null;
  district: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
}

export interface ParsedUblLine {
  name: string;
  code: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountAmount: string | null;
  vatRate: number;
  vatExemptionCode: string | null;
  otvCode: string | null;
  otvRate: string | null;
  withholdingCode: string | null;
  withholdingRate: number | null;
  lineTotalNet: string;
}

export interface ParsedUbl {
  uuid: string;
  id: string;
  profile: string;
  typeCode: string;
  issueDate: string;
  currency: string;
  exchangeRate: string | null;
  notes: string[];
  supplier: ParsedParty;
  lines: ParsedUblLine[];
  payableAmount: string;
  warnings: string[];
}

function party(p: Node | undefined): ParsedParty {
  const party = (p?.Party ?? {}) as Node;
  const ids = arr(party.PartyIdentification as Node[]);
  const idNode = ids.map((i) => i.ID as Node).find((id) => ["VKN", "TCKN"].includes(String((id as Node)?.["@_schemeID"] ?? "")));
  const person = party.Person as Node | undefined;
  const title = txt((party.PartyName as Node | undefined)?.Name) || [txt(person?.FirstName), txt(person?.FamilyName)].filter(Boolean).join(" ");
  const addr = (party.PostalAddress ?? {}) as Node;
  const contact = (party.Contact ?? {}) as Node;
  return {
    taxNumber: idNode ? txt(idNode) : null,
    title,
    taxOffice: txt(((party.PartyTaxScheme as Node | undefined)?.TaxScheme as Node | undefined)?.Name) || null,
    address: [txt(addr.StreetName), txt(addr.BuildingName), txt(addr.BuildingNumber)].filter(Boolean).join(" ") || null,
    district: txt(addr.CitySubdivisionName) || null,
    city: txt(addr.CityName) || null,
    email: txt(contact.ElectronicMail) || null,
    phone: txt(contact.Telephone) || null,
  };
}

export function parseIncomingUbl(xml: string): ParsedUbl {
  const doc = parser.parse(xml) as Node;
  const inv = doc.Invoice as Node | undefined;
  if (!inv) throw new Error("Belge bir UBL faturası değil.");
  const warnings: string[] = [];
  const lines = arr(inv.InvoiceLine as Node[]).map((l, i): ParsedUblLine => {
    const item = (l.Item ?? {}) as Node;
    const qtyNode = l.InvoicedQuantity as Node;
    let unit = String(qtyNode?.["@_unitCode"] ?? "C62");
    if (!isUnitCode(unit)) {
      warnings.push(`${i + 1}. satır: "${unit}" birimi tanımlı değil, Adet olarak alındı.`);
      unit = "C62";
    }
    const subs = arr(((l.TaxTotal ?? {}) as Node).TaxSubtotal as Node[]);
    const kdv = subs.find((s) => txt(((s.TaxCategory as Node)?.TaxScheme as Node)?.TaxTypeCode) === "0015");
    const otv = subs.find((s) => /^(007\d|9077)$/.test(txt(((s.TaxCategory as Node)?.TaxScheme as Node)?.TaxTypeCode)));
    const vatRate = kdv ? Number(txt(kdv.Percent)) : 0;
    if (!(VAT_RATES as readonly number[]).includes(vatRate)) warnings.push(`${i + 1}. satır: KDV %${vatRate} uygulamada tanımlı değil; kontrol edin.`);
    const wh = arr(((l.WithholdingTaxTotal ?? {}) as Node).TaxSubtotal as Node[])[0];
    const discount = arr(l.AllowanceCharge as Node[]).filter((a) => txt(a.ChargeIndicator) === "false").reduce((s, a) => s.plus(dec(a.Amount)), new Decimal(0));
    return {
      name: txt(item.Name) || `Satır ${i + 1}`,
      code: txt(((item.SellersItemIdentification ?? {}) as Node).ID) || null,
      quantity: dec(qtyNode).toString(),
      unit,
      unitPrice: dec(((l.Price ?? {}) as Node).PriceAmount).toString(),
      discountAmount: discount.greaterThan(0) ? discount.toString() : null,
      vatRate,
      vatExemptionCode: kdv && vatRate === 0 ? txt((kdv.TaxCategory as Node)?.TaxExemptionReasonCode) || "351" : null,
      otvCode: otv ? txt(((otv.TaxCategory as Node)?.TaxScheme as Node)?.TaxTypeCode) : null,
      otvRate: otv ? txt(otv.Percent) || null : null,
      withholdingCode: wh ? txt(((wh.TaxCategory as Node)?.TaxScheme as Node)?.TaxTypeCode) || null : null,
      withholdingRate: wh ? Number(txt(wh.Percent)) || null : null,
      lineTotalNet: dec(l.LineExtensionAmount).toString(),
    };
  });
  const rate = ((inv.PricingExchangeRate ?? inv.TaxExchangeRate) as Node | undefined)?.CalculationRate;
  return {
    uuid: txt(inv.UUID),
    id: txt(inv.ID),
    profile: txt(inv.ProfileID),
    typeCode: txt(inv.InvoiceTypeCode),
    issueDate: txt(inv.IssueDate),
    currency: txt(inv.DocumentCurrencyCode) || "TRY",
    exchangeRate: rate ? txt(rate) : null,
    notes: arr(inv.Note as unknown[]).map(txt).filter((n) => n && !n.startsWith("YALNIZ")),
    supplier: party(inv.AccountingSupplierParty as Node),
    lines,
    payableAmount: dec(((inv.LegalMonetaryTotal ?? {}) as Node).PayableAmount).toString(),
    warnings,
  };
}

// ── Gelen e-İrsaliye (DespatchAdvice) ──────────────────────

const despatchParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true, isArray: (name) => ["DespatchLine", "Note", "PartyIdentification"].includes(name) });

export interface ParsedDespatch {
  uuid: string;
  id: string;
  issueDate: string;
  despatchDate: string | null;
  notes: string[];
  supplier: ParsedParty;
  lines: Array<{ name: string; code: string | null; quantity: string; unit: string }>;
  warnings: string[];
}

/** Gelen e-İrsaliye XML'i → gelen irsaliye satırları (bilinmeyen birim "Adet" + uyarı) */
export function parseDespatchUbl(xml: string): ParsedDespatch {
  const doc = despatchParser.parse(xml) as Node;
  const d = doc.DespatchAdvice as Node | undefined;
  if (!d) throw new Error("UBL e-İrsaliyesi değil.");
  const warnings: string[] = [];
  const lines = arr(d.DespatchLine as Node[]).map((l) => {
    const q = l.DeliveredQuantity as Node | string;
    const unitRaw = typeof q === "object" ? String(q["@_unitCode"] ?? "C62") : "C62";
    const item = (l.Item ?? {}) as Node;
    const name = txt(item.Name) || "Kalem";
    if (!isUnitCode(unitRaw)) warnings.push(`"${name}" satırındaki birim (${unitRaw}) tanımlı değil; Adet olarak alındı.`);
    return { name, code: txt((item.SellersItemIdentification as Node | undefined)?.ID) || null, quantity: dec(q).toString(), unit: isUnitCode(unitRaw) ? unitRaw : "C62" };
  });
  const despatch = (((d.Shipment as Node | undefined)?.Delivery as Node | undefined)?.Despatch ?? {}) as Node;
  return {
    uuid: txt(d.UUID),
    id: txt(d.ID),
    issueDate: txt(d.IssueDate),
    despatchDate: txt(despatch.ActualDespatchDate) || null,
    notes: arr(d.Note as unknown[]).map(txt).filter(Boolean),
    supplier: party(d.DespatchSupplierParty as Node | undefined),
    lines,
    warnings,
  };
}
