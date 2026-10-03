import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { allocate, calculateDocument } from "@/lib/invoice-calc";

const s = (d: Decimal) => d.toFixed(2);

describe("fatura hesap motoru", () => {
  it("tek satır: Paraşüt örneği (KDV dahil 3.800 → birim 3.166,6667)", () => {
    const { lines, totals } = calculateDocument([{ quantity: 1, unitPrice: "3166.6667", vatRate: 20 }]);
    expect(s(lines[0]!.netAmount)).toBe("3166.67");
    expect(s(totals.vatTotal)).toBe("633.33");
    expect(s(totals.grandTotal)).toBe("3800.00");
    expect(s(totals.payableTotal)).toBe("3800.00");
  });

  it("miktar × fiyat 2 haneye yarım-yukarı yuvarlanır (float hatası yok)", () => {
    const { lines } = calculateDocument([{ quantity: "3", unitPrice: "0.335", vatRate: 0 }]);
    expect(s(lines[0]!.grossAmount)).toBe("1.01"); // 1.005 → 1.01 (float'ta 1.00)
  });

  it("satır indirimi: yüzde ve tutar; tutar brütü aşamaz", () => {
    const a = calculateDocument([{ quantity: 2, unitPrice: 100, vatRate: 20, discountType: "PERCENT", discountValue: 10 }]);
    expect(s(a.lines[0]!.netAmount)).toBe("180.00");
    expect(s(a.totals.vatTotal)).toBe("36.00");
    const b = calculateDocument([{ quantity: 1, unitPrice: 50, vatRate: 20, discountType: "AMOUNT", discountValue: 80 }]);
    expect(s(b.lines[0]!.netAmount)).toBe("0.00");
    expect(s(b.totals.grandTotal)).toBe("0.00");
  });

  it("genel indirim farklı KDV oranlı satırlara orantılı dağılır, toplam kuruşu kuruşuna tutar", () => {
    const { lines, totals } = calculateDocument(
      [
        { quantity: 1, unitPrice: 100, vatRate: 20 },
        { quantity: 1, unitPrice: 200, vatRate: 10 },
        { quantity: 1, unitPrice: "33.33", vatRate: 1 },
      ],
      { discountType: "AMOUNT", discountValue: 10 },
    );
    expect(s(totals.discountTotal)).toBe("10.00");
    expect(s(totals.netTotal)).toBe("323.33");
    // Dağıtım: 100/333.33, 200/333.33, 33.33/333.33 oranında
    expect(lines.map((l) => s(l.discountAmount))).toEqual(["3.00", "6.00", "1.00"]);
    expect(s(totals.vatTotal)).toBe(s(lines.reduce((a, l) => a.plus(l.vatAmount), new Decimal(0))));
    expect(totals.vatBreakdown.map((v) => v.rate)).toEqual([20, 10, 1]);
  });

  it("dağıtımda yuvarlama farkı en büyük satıra yazılır", () => {
    const shares = allocate(new Decimal("0.10"), [new Decimal(1), new Decimal(1), new Decimal(1)]);
    expect(shares.map(s)).toEqual(["0.04", "0.03", "0.03"]);
    expect(s(shares.reduce((a, b) => a.plus(b)))).toBe("0.10");
  });

  it("ÖTV KDV matrahına eklenir", () => {
    const { lines } = calculateDocument([{ quantity: 1, unitPrice: 1000, vatRate: 20, otvRate: 10 }]);
    expect(s(lines[0]!.otvAmount)).toBe("100.00");
    expect(s(lines[0]!.vatAmount)).toBe("220.00"); // (1000 + 100) × %20
    expect(s(lines[0]!.totalAmount)).toBe("1320.00");
  });

  it("tevkifat: KDV'nin bir kısmı alıcıda kalır, ödenecek tutar düşer", () => {
    const { totals } = calculateDocument([{ quantity: 1, unitPrice: 10000, vatRate: 20, withholdingRate: 50 }]);
    expect(s(totals.vatTotal)).toBe("2000.00");
    expect(s(totals.withholdingTotal)).toBe("1000.00");
    expect(s(totals.grandTotal)).toBe("12000.00");
    expect(s(totals.payableTotal)).toBe("11000.00");
  });

  it("%100 üstü indirim ve negatif değer yok sayılır / sınırlanır", () => {
    expect(s(calculateDocument([{ quantity: 1, unitPrice: 100, vatRate: 20, discountType: "PERCENT", discountValue: 150 }]).totals.netTotal)).toBe("0.00");
    expect(s(calculateDocument([{ quantity: 1, unitPrice: 100, vatRate: 20, discountType: "AMOUNT", discountValue: -5 }]).totals.netTotal)).toBe("100.00");
  });

  it("boş belge sıfır toplam", () => {
    const { totals } = calculateDocument([]);
    expect(s(totals.grandTotal)).toBe("0.00");
    expect(totals.vatBreakdown).toEqual([]);
  });
});
