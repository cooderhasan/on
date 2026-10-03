/** IBAN: boşluklar atılır, büyük harf; ISO 13616 mod-97 kontrolü. TR IBAN 26 karakterdir. */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s/g, "").toUpperCase();
}

export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith("TR") && iban.length !== 26) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

/** "TR12 0006 1000 …" — 4'lü gruplar */
export function formatIban(raw: string): string {
  return normalizeIban(raw).replace(/(.{4})/g, "$1 ").trim();
}
