import "server-only";
import { db } from "@/server/db";
import { decryptSecret } from "@/server/crypto";
import { AppError } from "@/lib/errors";

/**
 * NES REST istemcisi. Kaynak: developertest.nes.com.tr (OpenAPI: {apiUrl}{einvoice|earchive}/v1.swagger.taged.json).
 * Kimlik: Authorization: Bearer {API anahtarı}. Test: https://apitest.nes.com.tr/  Canlı: https://api.nes.com.tr/
 */
export type NesService = "einvoice" | "earchive";

export interface NesConfig {
  apiUrl: string;
  apiKey: string;
  senderAlias: string | null;
  eInvoiceSeries: string | null;
  eArchiveSeries: string | null;
  defaultProfile: string;
}

export async function getNesConfig(): Promise<NesConfig> {
  const s = await db.eInvoiceSettings.findUnique({ where: { id: "nes" } });
  if (!s?.apiKeyEnc) throw new AppError("VALIDATION", "e-Fatura ayarları yapılmamış. Ayarlar › e-Fatura Ayarları'ndan NES API anahtarını girin.");
  let apiKey: string;
  try {
    apiKey = decryptSecret(s.apiKeyEnc);
  } catch {
    throw new AppError("INTERNAL", "Kayıtlı API anahtarı çözülemedi (ENCRYPTION_KEY değişmiş olabilir). Anahtarı yeniden girin.");
  }
  return { apiUrl: s.apiUrl.endsWith("/") ? s.apiUrl : `${s.apiUrl}/`, apiKey, senderAlias: s.senderAlias, eInvoiceSeries: s.eInvoiceSeries, eArchiveSeries: s.eArchiveSeries, defaultProfile: s.defaultProfile };
}

/** NES hata gövdesinden okunabilir mesaj (biçim sabit değil: message / title / detail / errors) */
export function nesErrorMessage(status: number, body: string): string {
  let msg = "";
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const errors = j.errors;
    const list = Array.isArray(errors)
      ? errors.map((e) => (typeof e === "string" ? e : (e as { message?: string; description?: string })?.message ?? (e as { description?: string })?.description ?? JSON.stringify(e)))
      : errors && typeof errors === "object"
        ? Object.values(errors as Record<string, unknown>).flat().map(String)
        : [];
    msg = [j.message, j.title, j.detail, j.description, ...list].filter((x) => typeof x === "string" && x.trim()).join(" · ");
  } catch {
    msg = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  }
  if (status === 401) return "NES API anahtarı geçersiz veya süresi dolmuş.";
  if (status === 403) return `NES: bu işlem için API anahtarının yetkisi yok${msg ? ` (${msg})` : ""}.`;
  return `NES hatası (${status})${msg ? `: ${msg}` : ""}`;
}

export class NesError extends AppError {
  constructor(readonly status: number, message: string) {
    super("EXTERNAL", message);
  }
}

export class NesClient {
  constructor(private readonly cfg: Pick<NesConfig, "apiUrl" | "apiKey">) {}

  private async call(path: string, init: RequestInit = {}, timeoutMs = Number(process.env.NES_TIMEOUT_MS) || 30_000): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.apiUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.cfg.apiKey}`, Accept: "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Zaman aşımı / bağlantı hatası: işlemin NES'te gerçekleşip gerçekleşmediği bilinmez
      throw new NesTransportError((err as Error).name === "TimeoutError" ? "NES zamanında yanıt vermedi." : "NES'e bağlanılamadı.");
    }
    return res;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.call(path, init);
    const text = await res.text();
    if (!res.ok) throw new NesError(res.status, nesErrorMessage(res.status, text));
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Mükellef sorgusu. Kayıtlı değilse null. aliasType: Pk (posta kutusu), Gb (gönderici), All */
  async queryUser(identifier: string, aliasType: "Pk" | "Gb" | "All" = "All"): Promise<NesUserInfo | null> {
    const res = await this.call(`einvoice/v1/users/${encodeURIComponent(identifier)}/${aliasType}`);
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) throw new NesError(res.status, nesErrorMessage(res.status, text));
    const j = JSON.parse(text) as NesUserInfo | NesUserInfo[];
    const u = Array.isArray(j) ? j[0] : j;
    return u && (u.identifier || u.title) ? u : null;
  }

  /** Belge yükler ve (IsDirectSend) resmileştirir */
  async upload(service: NesService, xml: string, opts: { senderAlias?: string | null; receiverAlias?: string | null; recordId: string }): Promise<{ uuid: string; documentNumber: string | null }> {
    const fd = new FormData();
    fd.append("File", new Blob([xml], { type: "application/xml" }), "fatura.xml");
    fd.append("IsDirectSend", "true");
    fd.append("PreviewType", "None");
    fd.append("SourceApp", "OnMuhasebe");
    fd.append("SourceAppRecordId", opts.recordId);
    if (service === "einvoice") {
      if (opts.senderAlias) fd.append("SenderAlias", opts.senderAlias);
      if (opts.receiverAlias) fd.append("ReceiverAlias", opts.receiverAlias);
    }
    const r = await this.json<{ uuid: string; documentNumber?: string | null }>(`${service}/v1/uploads/document`, { method: "POST", body: fd });
    return { uuid: r.uuid, documentNumber: r.documentNumber ?? null };
  }

  /** Giden e-Fatura detayı (durum). Bulunamazsa null. */
  async outgoingInvoice(uuid: string): Promise<NesOutgoingDetail | null> {
    const res = await this.call(`einvoice/v1/outgoing/invoices/${uuid}`);
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) throw new NesError(res.status, nesErrorMessage(res.status, text));
    return JSON.parse(text) as NesOutgoingDetail;
  }

  async archiveInvoice(uuid: string): Promise<NesArchiveDetail | null> {
    const res = await this.call(`earchive/v1/invoices/${uuid}`);
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) throw new NesError(res.status, nesErrorMessage(res.status, text));
    return JSON.parse(text) as NesArchiveDetail;
  }

  async cancelArchive(uuids: string[]): Promise<void> {
    await this.json(`earchive/v1/invoices/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uuids }) });
  }

  /** PDF / HTML görüntü (ham yanıt; çağıran akıtır) */
  async document(service: NesService, uuid: string, format: "pdf" | "html", direction: "outgoing" | "incoming" = "outgoing"): Promise<Response> {
    const path = service === "earchive" ? `earchive/v1/invoices/${uuid}/${format}` : `einvoice/v1/${direction}/invoices/${uuid}/${format}`;
    const res = await this.call(path, { headers: { Accept: format === "pdf" ? "application/pdf" : "text/html" } }, 60_000);
    if (!res.ok) throw new NesError(res.status, nesErrorMessage(res.status, await res.text()));
    return res;
  }
}

/** Ağ / zaman aşımı: sonuç bilinmiyor → durum sorgusuyla netleştirilir */
export class NesTransportError extends AppError {
  constructor(message: string) {
    super("EXTERNAL", message);
  }
}

export interface NesUserInfo {
  identifier: string;
  title: string;
  type?: string;
  aliases?: Array<{ alias: string; type: "All" | "Gb" | "Pk"; creationTime?: string }>;
}

export interface NesOutgoingDetail {
  id: string;
  documentNumber?: string | null;
  outgoingStatus?: string;
  recordStatus?: string;
  documentAnswer?: string;
  profileId?: string;
  outgoingEnvelope?: { description?: string | null; code?: string | null } | null;
  incomingAnswer?: { documentAnswer?: string; answerNote?: string | null; errorDescription?: string | null } | null;
}

export interface NesArchiveDetail {
  id: string;
  documentNumber?: string | null;
  errorDescription?: string | null;
  isCanceled?: boolean;
  archiveDocumentStatus?: string;
}

export async function nesClient() {
  const cfg = await getNesConfig();
  return { cfg, client: new NesClient(cfg) };
}
