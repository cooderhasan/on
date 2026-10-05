import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseIncomingUbl } from "@/lib/ubl-parse";
import { buildInvoiceXml, type UblInvoice } from "@/lib/ubl";
import { calculateDocument } from "@/lib/invoice-calc";

describe("gelen UBL ayrıştırma", () => {
  it("NES örnek ticari faturasını okur", () => {
    const p = parseIncomingUbl(readFileSync("tests/fixtures/nes-ticarifatura.xml", "utf8"));
    expect(p.profile).toBe("TICARIFATURA");
    expect(p.supplier).toMatchObject({ taxNumber: "1234567801", title: "Test Firma - 01", city: "İSTANBUL", district: "KADIKÖY", taxOffice: "KADIKÖY" });
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]).toMatchObject({ name: "Örnek Kalem", quantity: "1", unit: "C62", unitPrice: "100", lineTotalNet: "100" });
    // Örnek %18 KDV (eski oran) → uyarı, sessizce değiştirilmez
    expect(p.lines[0]!.vatRate).toBe(18);
    expect(p.warnings.some((w) => w.includes("%18"))).toBe(true);
    expect(p.payableAmount).toBe("118");
    expect(p.notes).toEqual([]);
  });

  it("kendi ürettiğimiz XML'i geri okur: indirim, tevkifat, ÖTV, istisna (gidiş-dönüş)", () => {
    const lines = [
      { quantity: 2, unitPrice: 250, vatRate: 20, discountType: "PERCENT" as const, discountValue: 10, withholdingCode: "603", withholdingRate: 50 },
      { quantity: 1, unitPrice: 1000, vatRate: 20, otvCode: "0074", otvRate: 10 },
      { quantity: 3, unitPrice: "33.3333", vatRate: 0, vatExemptionCode: "351" },
    ];
    const calc = calculateDocument(lines);
    const ubl: UblInvoice = {
      uuid: "u-1", id: "ABC", profile: "TICARIFATURA", kind: "INVOICE", issueDate: "2026-10-05", issueTime: "10:00:00", currency: "TRY", notes: ["Not 1"],
      supplier: { taxNumber: "1234567890", title: "A & B Ltd", taxOffice: "Meram", district: "Meram", city: "Konya", address: "X" },
      customer: { taxNumber: "9876543217", title: "C", taxOffice: "S", district: "D", city: "Konya" },
      lines: lines.map((l, i) => ({ name: `Ürün ${i + 1}`, unitCode: "C62", ...l, ...calc.lines[i]! })),
      totals: calc.totals,
    };
    const p = parseIncomingUbl(buildInvoiceXml(ubl));
    expect(p.supplier.title).toBe("A & B Ltd");
    expect(p.notes).toEqual(["Not 1"]);
    expect(p.lines[0]).toMatchObject({ discountAmount: "50", withholdingCode: "603", withholdingRate: 50, vatRate: 20 });
    expect(p.lines[1]).toMatchObject({ otvCode: "0074", otvRate: "10" });
    expect(p.lines[2]).toMatchObject({ vatRate: 0, vatExemptionCode: "351", unitPrice: "33.3333", quantity: "3" });
    expect(calc.totals.payableTotal.equals(p.payableAmount)).toBe(true);
    expect(p.warnings).toEqual([]);
  });

  it("fatura olmayan XML reddedilir", () => {
    expect(() => parseIncomingUbl("<Foo/>")).toThrow(/UBL faturası değil/);
  });
});
