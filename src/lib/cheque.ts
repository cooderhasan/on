import type { ChequeDirection, ChequeStatus } from "@/generated/prisma/enums";

export const CHEQUE_STATUS_LABELS: Record<ChequeStatus, string> = {
  PORTFOLIO: "Portföyde",
  COLLECTED: "Tahsil edildi",
  ENDORSED: "Ciro edildi",
  BOUNCED: "Karşılıksız",
  PENDING: "Ödenecek",
  PAID: "Ödendi",
};

/** Çek hareketinin ekstre / hesap hareketlerindeki açıklaması */
export function chequeTxLabel(t: { type: string; contactId: string | null }, ch: { direction: ChequeDirection; contactId: string; chequeNo: string }): string {
  if (t.type === "DEPOSIT") return `Çek tahsili · ${ch.chequeNo}`;
  if (t.type === "WITHDRAWAL") return `Çek ödemesi · ${ch.chequeNo}`;
  if (ch.direction === "ISSUED") return `Çek verildi · ${ch.chequeNo}`;
  if (t.type === "COLLECTION") return `Çek alındı · ${ch.chequeNo}`;
  return t.contactId === ch.contactId ? `Karşılıksız çek · ${ch.chequeNo}` : `Çek ciro edildi · ${ch.chequeNo}`;
}
