import { describe, expect, it } from "vitest";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { calculateDocument, type LineInput } from "@/lib/invoice-calc";
import { amountInWords, buildInvoiceXml, invoiceTypeCode, numberToWordsTr, validateForUbl, xmlEscape, type UblInvoice, type UblLine } from "@/lib/ubl";
import Decimal from "decimal.js";

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });

const supplier = { taxNumber: "1234567890", title: "Önizleme Ticaret Ltd. Şti.", taxOffice: "Selçuk", address: "Örnek Mah. No:1", district: "Selçuklu", city: "Konya" };
const company = { taxNumber: "1234567890", title: "A & B <Oto> Ltd. Şti.", taxOffice: "Meram", address: "Sanayi \"5\"", district: "Karatay", city: "Konya" };

function build(lines: Array<LineInput & Partial<UblLine>>, o: Partial<UblInvoice> = {}, doc: { discountType?: "PERCENT" | "AMOUNT"; discountValue?: string } = {}): UblInvoice {
  const calc = calculateDocument(lines, doc);
  return {
    uuid: "44379f4a-5d5c-4348-929c-d7f531462107", id: "ABC", profile: "TICARIFATURA", kind: "INVOICE", issueDate: "2026-10-03", issueTime: "10:00:00", currency: "TRY", notes: [],
    supplier, customer: company,
    lines: lines.map((l, i) => ({ name: l.name ?? "Ürün", quantity: l.quantity, unitCode: "C62", unitPrice: l.unitPrice, vatRate: l.vatRate, vatExemptionCode: l.vatExemptionCode, otvCode: l.otvCode, otvRate: l.otvRate, withholdingCode: l.withholdingCode, withholdingRate: l.withholdingRate, ...calc.lines[i]! })),
    totals: calc.totals,
    ...o,
  };
}
const parse = (xml: string) => {
  expect(XMLValidator.validate(xml)).toBe(true);
  return parser.parse(xml).Invoice;
};
const arr = <T,>(v: T | T[]) => (Array.isArray(v) ? v : [v]);

describe("UBL-TR fatura XML", () => {
  it("geçerli XML; özel karakterler kaçışlı, unvan bozulmaz", () => {
    const inv = parse(buildInvoiceXml(build([{ quantity: 1, unitPrice: 100, vatRate: 20 }])));
    expect(inv.AccountingCustomerParty.Party.PartyName.Name).toBe("A & B <Oto> Ltd. Şti.");
    expect(inv.AccountingCustomerParty.Party.PostalAddress.StreetName).toBe('Sanayi "5"');
    expect(xmlEscape("a&b<c>'\"")).toBe("a&amp;b&lt;c&gt;&apos;&quot;");
  });

  it("toplamlar hesap motoruyla birebir; NES örneğindeki alanlar", () => {
    const inv = parse(buildInvoiceXml(build([{ quantity: 2, unitPrice: "3166.6667", vatRate: 20 }, { quantity: 1, unitPrice: 250, vatRate: 20, discountType: "PERCENT", discountValue: 10 }])));
    expect(inv.ProfileID).toBe("TICARIFATURA");
    expect(inv.InvoiceTypeCode).toBe("SATIS");
    expect(inv.LineCountNumeric).toBe("2");
    const m = inv.LegalMonetaryTotal;
    expect([m.LineExtensionAmount["#text"], m.AllowanceTotalAmount["#text"], m.TaxExclusiveAmount["#text"], m.TaxInclusiveAmount["#text"], m.PayableAmount["#text"]]).toEqual(["6583.33", "25.00", "6558.33", "7870.00", "7870.00"]);
    expect(inv.TaxTotal.TaxAmount["#text"]).toBe("1311.67");
    const l2 = arr(inv.InvoiceLine)[1];
    expect(l2.LineExtensionAmount["#text"]).toBe("225.00");
    expect(l2.AllowanceCharge.Amount["#text"]).toBe("25.00");
    expect(l2.AllowanceCharge.MultiplierFactorNumeric).toBe("0.1");
    expect(arr(inv.InvoiceLine)[0].Price.PriceAmount["#text"]).toBe("3166.6667");
    expect(arr(inv.Note).at(-1)).toBe("YALNIZ : YEDİBİNSEKİZYÜZYETMİŞ TL SIFIR Kr.");
  });

  it("e-Arşiv: SEND_TYPE eklenir, e-Faturada eklenmez; TCKN alıcıda ad / soyad ayrılır", () => {
    const ea = parse(buildInvoiceXml(build([{ quantity: 1, unitPrice: 100, vatRate: 20 }], { profile: "EARSIVFATURA", customer: { taxNumber: "10000000146", title: "Ali Veli Yılmaz", district: "Meram", city: "Konya" } })));
    expect(ea.AdditionalDocumentReference.DocumentTypeCode).toBe("SEND_TYPE");
    expect(ea.AdditionalDocumentReference.ID).toBe("ELEKTRONIK");
    const p = ea.AccountingCustomerParty.Party;
    expect(p.PartyIdentification.ID).toMatchObject({ "#text": "10000000146", "@_schemeID": "TCKN" });
    expect(p.Person).toEqual({ FirstName: "Ali Veli", FamilyName: "Yılmaz" });
    expect(p.PartyName).toBeUndefined();
    const ef = parse(buildInvoiceXml(build([{ quantity: 1, unitPrice: 100, vatRate: 20 }])));
    expect(ef.AdditionalDocumentReference).toBeUndefined();
  });

  it("tevkifat: tip TEVKIFAT, WithholdingTaxTotal kodu ve ödenecek tutar düşer", () => {
    const inv = parse(buildInvoiceXml(build([{ quantity: 1, unitPrice: 10000, vatRate: 20, withholdingRate: 50, withholdingCode: "603" }])));
    expect(inv.InvoiceTypeCode).toBe("TEVKIFAT");
    expect(inv.WithholdingTaxTotal.TaxAmount["#text"]).toBe("1000.00");
    expect(inv.WithholdingTaxTotal.TaxSubtotal.TaxCategory.TaxScheme.TaxTypeCode).toBe("603");
    expect(inv.WithholdingTaxTotal.TaxSubtotal.Percent).toBe("50");
    expect(inv.LegalMonetaryTotal.TaxInclusiveAmount["#text"]).toBe("12000.00");
    expect(inv.LegalMonetaryTotal.PayableAmount["#text"]).toBe("11000.00");
  });

  it("KDV %0: istisna sebebi yazılır; 351 dışı kod faturayı ISTISNA yapar", () => {
    const inv = parse(buildInvoiceXml(build([{ quantity: 1, unitPrice: 100, vatRate: 0, vatExemptionCode: "301" }])));
    expect(inv.InvoiceTypeCode).toBe("ISTISNA");
    expect(inv.TaxTotal.TaxSubtotal.TaxCategory.TaxExemptionReasonCode).toBe("301");
    expect(invoiceTypeCode("INVOICE", [{ vatRate: 0, vatExemptionCode: "351", withholdingCode: null }])).toBe("SATIS");
    expect(invoiceTypeCode("RETURN", [{ vatRate: 20, vatExemptionCode: null, withholdingCode: "603" }])).toBe("TEVKIFATIADE");
  });

  it("ÖTV ayrı vergi alt toplamı, KDV matrahına eklenir", () => {
    const inv = parse(buildInvoiceXml(build([{ quantity: 1, unitPrice: 1000, vatRate: 20, otvRate: 10, otvCode: "0074" }])));
    const subs = arr(inv.TaxTotal.TaxSubtotal);
    expect(subs.map((s: { TaxCategory: { TaxScheme: { TaxTypeCode: string } } }) => s.TaxCategory.TaxScheme.TaxTypeCode)).toEqual(["0074", "0015"]);
    expect(subs[1].TaxableAmount["#text"]).toBe("1100.00");
    expect(inv.TaxTotal.TaxAmount["#text"]).toBe("320.00");
  });

  it("iade: IADE tipi ve iade edilen fatura referansı; dövizde kur", () => {
    const inv = parse(buildInvoiceXml(build([{ quantity: 1, unitPrice: 100, vatRate: 20 }], { kind: "RETURN", returnRef: { no: "ABC2026000000012", date: "2026-09-01" }, currency: "USD", exchangeRate: "34.25" })));
    expect(inv.InvoiceTypeCode).toBe("IADE");
    expect(inv.BillingReference.InvoiceDocumentReference.ID).toBe("ABC2026000000012");
    expect(inv.PricingExchangeRate.CalculationRate).toBe("34.25");
    expect(inv.LegalMonetaryTotal.PayableAmount["@_currencyID"]).toBe("USD");
  });
});

describe("gönderim öncesi kontrol", () => {
  it("eksikleri Türkçe listeler", () => {
    const errs = validateForUbl(build([{ quantity: 1, unitPrice: 100, vatRate: 0 }], { id: "AB", customer: { taxNumber: "", title: "X", city: null }, kind: "RETURN" }));
    expect(errs).toEqual(expect.arrayContaining([
      "Müşteri VKN / TCKN eksik veya hatalı.",
      "Müşteri il bilgisi eksik.",
      "Fatura serisi 3 karakter olmalı (e-Fatura Ayarları).",
      "1. satır: KDV %0 ise istisna sebebi seçilmeli.",
      "İade faturasında iade edilen faturanın numarası ve tarihi girilmeli.",
      "e-Fatura alıcısının vergi dairesi eksik.",
    ]));
    expect(validateForUbl(build([{ quantity: 1, unitPrice: 100, vatRate: 20 }]))).toEqual([]);
  });

  it("tevkifat ve istisna aynı faturada olamaz", () => {
    expect(validateForUbl(build([{ quantity: 1, unitPrice: 100, vatRate: 20, withholdingRate: 50, withholdingCode: "603" }, { quantity: 1, unitPrice: 100, vatRate: 0, vatExemptionCode: "301" }]))).toContain(
      "Aynı faturada hem tevkifat hem KDV istisnası olamaz; ayrı faturalar kesin.",
    );
  });
});

describe("tutarı yazıyla", () => {
  it("NES örneğiyle birebir ve özel durumlar", () => {
    expect(amountInWords(new Decimal(118), "TRY")).toBe("YÜZONSEKİZ TL SIFIR Kr.");
    expect(numberToWordsTr(1000)).toBe("BİN");
    expect(numberToWordsTr(1001)).toBe("BİNBİR");
    expect(numberToWordsTr(2_000_000)).toBe("İKİMİLYON");
    expect(numberToWordsTr(101_101)).toBe("YÜZBİRBİNYÜZBİR");
    expect(amountInWords(new Decimal("3800.05"), "TRY")).toBe("ÜÇBİNSEKİZYÜZ TL BEŞ Kr.");
  });
});
