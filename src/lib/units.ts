/** Faturada kullanılan birimler: GİB UBL-TR birim kodu → görünen ad. Sık kullanılanlar başta. */
export const UNITS: Array<{ code: string; label: string }> = [
  { code: "C62", label: "Adet" },
  { code: "KGM", label: "Kg" },
  { code: "GRM", label: "Gram" },
  { code: "LTR", label: "Litre" },
  { code: "MTR", label: "Metre" },
  { code: "MTK", label: "m²" },
  { code: "MTQ", label: "m³" },
  { code: "PA", label: "Paket" },
  { code: "BX", label: "Kutu" },
  { code: "SET", label: "Set" },
  { code: "PR", label: "Çift" },
  { code: "TNE", label: "Ton" },
  { code: "HUR", label: "Saat" },
  { code: "DAY", label: "Gün" },
  { code: "MON", label: "Ay" },
  { code: "ANN", label: "Yıl" },
  { code: "KWH", label: "kWh" },
];

const BY_CODE = new Map(UNITS.map((u) => [u.code, u.label]));
export const unitLabel = (code: string) => BY_CODE.get(code) ?? code;
export const isUnitCode = (code: string) => BY_CODE.has(code);

export const VAT_RATES = [20, 10, 1, 0] as const;
export const CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];
