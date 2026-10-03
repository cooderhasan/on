/** NES durumlarını uygulama durumuna çevirir (saf). Kaynak: NES OpenAPI enum'ları. */
export type EDoc = "SENT" | "ACCEPTED" | "REJECTED" | "FAILED" | "CANCELLED";

const OUTGOING_FAILED = new Set([
  "ErrorHasBeenDetectedInEnvelopeByGib",
  "EnvelopeCouldNotTransferredToReceiverByGib",
  "ErrorHasBeenDetectedInEnvelopeByReceiver",
  "FileNotFound",
  "XmlParseError",
]);

export function mapOutgoingStatus(d: { outgoingStatus?: string; recordStatus?: string; documentAnswer?: string; incomingAnswer?: { documentAnswer?: string } | null }): EDoc {
  const answer = d.incomingAnswer?.documentAnswer ?? d.documentAnswer;
  if (answer === "Rejected") return "REJECTED";
  if (d.recordStatus === "Error" || OUTGOING_FAILED.has(d.outgoingStatus ?? "")) return "FAILED";
  if (d.outgoingStatus === "EnvelopeHasBeenTransferredToReceiverSuccessfully") return "ACCEPTED";
  return "SENT";
}

export function mapArchiveStatus(d: { isCanceled?: boolean; archiveDocumentStatus?: string }): EDoc {
  if (d.isCanceled) return "CANCELLED";
  if (["Error", "XmlFileDoesNotExist", "XmlParseError"].includes(d.archiveDocumentStatus ?? "")) return "FAILED";
  if (d.archiveDocumentStatus === "Signed") return "ACCEPTED";
  return "SENT";
}

/** Bakiye ve stoktan düşen (hukuki etkisi kalmayan) e-belge durumları */
export const VOID_EDOC = ["REJECTED", "CANCELLED"] as const;
export const isVoidEDoc = (s: string) => (VOID_EDOC as readonly string[]).includes(s);
/** Değiştirilemeyen / tekrar gönderilemeyen */
export const LOCKED_EDOC = ["QUEUED", "SENT", "ACCEPTED", "REJECTED", "CANCELLED"] as const;
export const isLockedEDoc = (s: string) => (LOCKED_EDOC as readonly string[]).includes(s);
