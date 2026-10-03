import Decimal from "decimal.js";

/**
 * Fatura / teklif hesap motoru — saf fonksiyonlar, tüm tutarlar Decimal.
 *
 * Satır başına sıra (GİB / Paraşüt):
 *   brüt        = miktar × birim fiyat                         (2 haneye yuvarlanır)
 *   satır indir.= brüt × % veya tutar (brütü aşamaz)
 *   genel indir.= satırlara, indirim sonrası tutarlarıyla orantılı dağıtılır (kuruş farkı en büyük satıra)
 *   matrah      = brüt − satır indirimi − genel indirim payı
 *   ÖTV         = matrah × ÖTV%
 *   KDV         = (matrah + ÖTV) × KDV%
 *   tevkifat    = KDV × tevkifat oranı (10'da kaç → %)
 *   satır toplam= matrah + ÖTV + KDV
 * Ödenecek = genel toplam − tevkifat (tevkif edilen KDV'yi alıcı öder).
 */

export type DiscountKind = "PERCENT" | "AMOUNT";

export interface LineInput {
  quantity: Decimal.Value;
  unitPrice: Decimal.Value;
  discountType?: DiscountKind | null;
  discountValue?: Decimal.Value | null;
  vatRate: number;
  otvRate?: Decimal.Value | null;
  /** Tevkifat yüzdesi: 5/10 → 50 */
  withholdingRate?: number | null;
}

export interface LineResult {
  grossAmount: Decimal;
  discountAmount: Decimal;
  netAmount: Decimal;
  otvAmount: Decimal;
  vatAmount: Decimal;
  withholdingAmount: Decimal;
  totalAmount: Decimal;
}

export interface DocumentTotals {
  grossTotal: Decimal;
  /** Satır indirimleri + genel indirim */
  discountTotal: Decimal;
  netTotal: Decimal;
  otvTotal: Decimal;
  vatTotal: Decimal;
  withholdingTotal: Decimal;
  grandTotal: Decimal;
  payableTotal: Decimal;
  /** KDV oranına göre matrah ve KDV (faturada oran bazında gösterilir) */
  vatBreakdown: Array<{ rate: number; base: Decimal; vat: Decimal }>;
}

const ZERO = new Decimal(0);
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const pct = (base: Decimal, rate: Decimal.Value) => r2(base.times(rate).dividedBy(100));

function discountOf(base: Decimal, type: DiscountKind | null | undefined, value: Decimal.Value | null | undefined): Decimal {
  if (!type || value === null || value === undefined) return ZERO;
  const v = new Decimal(value);
  if (v.lessThanOrEqualTo(0)) return ZERO;
  const d = type === "PERCENT" ? pct(base, Decimal.min(v, 100)) : r2(v);
  return Decimal.min(d, base);
}

/**
 * Genel indirimi satırlara orantılı dağıtır. Toplamı tam olarak `total` eder:
 * yuvarlama farkı en büyük satıra yazılır. Saf fonksiyon.
 */
export function allocate(total: Decimal, bases: Decimal[]): Decimal[] {
  const sum = bases.reduce((a, b) => a.plus(b), ZERO);
  if (total.isZero() || sum.isZero()) return bases.map(() => ZERO);
  const shares = bases.map((b) => r2(total.times(b).dividedBy(sum)));
  const diff = total.minus(shares.reduce((a, b) => a.plus(b), ZERO));
  if (!diff.isZero()) {
    let maxIdx = 0;
    bases.forEach((b, i) => {
      if (b.greaterThan(bases[maxIdx]!)) maxIdx = i;
    });
    shares[maxIdx] = shares[maxIdx]!.plus(diff);
  }
  return shares;
}

export function calculateDocument(lines: LineInput[], doc: { discountType?: DiscountKind | null; discountValue?: Decimal.Value | null } = {}): { lines: LineResult[]; totals: DocumentTotals } {
  const pre = lines.map((l) => {
    const gross = r2(new Decimal(l.quantity).times(l.unitPrice));
    const lineDiscount = discountOf(gross, l.discountType, l.discountValue);
    return { l, gross, lineDiscount, afterLine: gross.minus(lineDiscount) };
  });
  const baseForDoc = pre.reduce((a, p) => a.plus(p.afterLine), ZERO);
  const docDiscount = discountOf(baseForDoc, doc.discountType, doc.discountValue);
  const shares = allocate(docDiscount, pre.map((p) => p.afterLine));

  const results: LineResult[] = pre.map((p, i) => {
    const net = p.afterLine.minus(shares[i]!);
    const otv = p.l.otvRate ? pct(net, p.l.otvRate) : ZERO;
    const vat = pct(net.plus(otv), p.l.vatRate);
    const withholding = p.l.withholdingRate ? pct(vat, p.l.withholdingRate) : ZERO;
    return {
      grossAmount: p.gross,
      discountAmount: p.lineDiscount.plus(shares[i]!),
      netAmount: net,
      otvAmount: otv,
      vatAmount: vat,
      withholdingAmount: withholding,
      totalAmount: net.plus(otv).plus(vat),
    };
  });

  const sum = (k: keyof LineResult) => results.reduce((a, r) => a.plus(r[k]), ZERO);
  const byRate = new Map<number, { base: Decimal; vat: Decimal }>();
  results.forEach((r, i) => {
    const rate = lines[i]!.vatRate;
    const cur = byRate.get(rate) ?? { base: ZERO, vat: ZERO };
    byRate.set(rate, { base: cur.base.plus(r.netAmount).plus(r.otvAmount), vat: cur.vat.plus(r.vatAmount) });
  });
  const grandTotal = sum("totalAmount");
  const withholdingTotal = sum("withholdingAmount");
  return {
    lines: results,
    totals: {
      grossTotal: sum("grossAmount"),
      discountTotal: sum("discountAmount"),
      netTotal: sum("netAmount"),
      otvTotal: sum("otvAmount"),
      vatTotal: sum("vatAmount"),
      withholdingTotal,
      grandTotal,
      payableTotal: grandTotal.minus(withholdingTotal),
      vatBreakdown: [...byRate].sort((a, b) => b[0] - a[0]).map(([rate, v]) => ({ rate, ...v })),
    },
  };
}
