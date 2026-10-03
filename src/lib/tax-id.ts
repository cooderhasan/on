/** VKN (10 hane) ve TCKN (11 hane) kontrol hanesi doğrulaması. Saf fonksiyonlar. */

const digits = (s: string) => s.split("").map(Number);

/** GİB vergi kimlik numarası algoritması */
export function isValidVkn(vkn: string): boolean {
  if (!/^\d{10}$/.test(vkn)) return false;
  const d = digits(vkn);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const tmp = (d[i]! + (9 - i)) % 10;
    let p = (tmp * 2 ** (9 - i)) % 9;
    if (tmp !== 0 && p === 0) p = 9;
    sum += p;
  }
  return (10 - (sum % 10)) % 10 === d[9];
}

/** T.C. kimlik numarası algoritması */
export function isValidTckn(tckn: string): boolean {
  if (!/^[1-9]\d{10}$/.test(tckn)) return false;
  const d = digits(tckn);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  if (d10 !== d[9]) return false;
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}

/** e-Arşiv'de nihai tüketici için GİB'in kabul ettiği genel numaralar */
export const GENERIC_TAX_IDS = ["11111111111", "2222222222"] as const;

export type TaxIdCheck = { ok: true; kind: "VKN" | "TCKN" } | { ok: false; message: string };

export function checkTaxId(raw: string): TaxIdCheck {
  const v = raw.replace(/\s/g, "");
  if ((GENERIC_TAX_IDS as readonly string[]).includes(v)) return { ok: true, kind: v.length === 11 ? "TCKN" : "VKN" };
  if (/^\d{10}$/.test(v)) return isValidVkn(v) ? { ok: true, kind: "VKN" } : { ok: false, message: "Vergi kimlik numarası geçersiz (kontrol hanesi tutmuyor)." };
  if (/^\d{11}$/.test(v)) return isValidTckn(v) ? { ok: true, kind: "TCKN" } : { ok: false, message: "T.C. kimlik numarası geçersiz (kontrol hanesi tutmuyor)." };
  return { ok: false, message: "VKN 10, TCKN 11 haneli olmalı." };
}
