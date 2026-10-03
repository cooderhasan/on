import Decimal from "decimal.js";

/** Para hesabı: her zaman Decimal (float kuruş hatası yapar). Yuvarlama: yarım yukarı, 2 hane. */
export type MoneyInput = Decimal.Value;

export const money = (v: MoneyInput) => new Decimal(v);
export const round2 = (v: MoneyInput) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

const CURRENCY_SYMBOL: Record<string, string> = { TRY: "₺", USD: "$", EUR: "€", GBP: "£" };

/**
 * "3.800,00" — Türkçe binlik / ondalık ayırıcı. Parçalı döner (kuruş ayrı stillensin diye).
 * `maxDp` > 2 ise (birim fiyat) gerektiği kadar hane gösterilir: 3.166,6667 — en az 2 hane.
 */
export function formatMoneyParts(v: MoneyInput, currency = "TRY", maxDp = 2) {
  const d = new Decimal(v).toDecimalPlaces(maxDp, Decimal.ROUND_HALF_UP);
  const negative = d.isNegative() && !d.isZero();
  const fixed = d.abs().toFixed(maxDp).replace(/(\.\d{2}\d*?)0+$/, "$1");
  const [int, frac] = fixed.split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return { sign: negative ? "-" : "", int: grouped, frac: frac!, symbol: CURRENCY_SYMBOL[currency] ?? currency };
}

export function formatMoney(v: MoneyInput, currency = "TRY"): string {
  const p = formatMoneyParts(v, currency);
  return `${p.sign}${p.int},${p.frac}${p.symbol}`;
}

/** Kullanıcı girişi: "3.800,50" / "3800.50" / "3800,5" → Decimal. Geçersizse null. */
export function parseMoneyInput(raw: string): Decimal | null {
  const s = raw.trim().replace(/\s|₺|TL/gi, "");
  if (!s) return null;
  // Hem nokta hem virgül varsa sondaki ondalık ayırıcıdır
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    normalized = s.replace(",", ".");
  } else {
    // Yalnız nokta: "3.800" binlik mi ondalık mı? 3 haneli grup(lar) ise binlik say
    normalized = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return new Decimal(normalized);
}
