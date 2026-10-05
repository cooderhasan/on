import "server-only";
import { db } from "@/server/db";
import { decryptSecret } from "@/server/crypto";
import { AppError } from "@/lib/errors";

/**
 * NES REST istemcisi. Kaynak: developertest.nes.com.tr (OpenAPI: {apiUrl}{einvoice|earchive|edespatch}/v1.swagger.taged.json).
 * Kimlik: Authorization: Bearer {API anahtarı}. Test: https://apitest.nes.com.tr/  Canlı: https://api.nes.com.tr/
 */
export type NesService = "einvoice" | "earchive" | "edespatch";

export interface NesConfig {
  apiUrl: string;
  apiKey: string;
  senderAlias: string | null;
  eInvoiceSeries: string | null;
  eArchiveSeries: string | null;
  defaultProfile: string;
  despatchSenderAlias: string | null;
  despatchSeries: string | null;
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
  return { apiUrl: s.apiUrl.endsWith("/") ? s.apiUrl : `${s.apiUrl}/`, apiKey, senderAlias: s.senderAlias, eInvoiceSeries: s.eInvoiceSeries, eArchiveSeries: s.eArchiveSeries, defaultProfile: s.defaultProfile, despatchSenderAlias: s.despatchSenderAlias, despatchSeries: s.despatchSeries };
}

/** NES hata gövdesinden okunabilir mesaj (biçim sabit değil: message / title / detail / errors) */
export function nesErrorMessage(status: number, body: string): string {
  let msg = "";
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const errors = j.errors;
    // 422: errors[].detail asıl nedeni taşır (ör. şematron kuralının metni); 400: invalidFields[].field + description
    const item = (e: unknown) => {
      if (typeof e === "string") return e;
      const x = e as { message?: string; description?: string; detail?: string; field?: string; code?: string };
      const head = x.field ? `${x.field}: ${x.description ?? ""}` : (x.message ?? x.description ?? "");
      const detail = x.detail && x.detail !== head ? x.detail : "";
      return [head, detail].filter((t) => t && t.trim()).join(" — ") || JSON.stringify(e);
    };
    const list = [
      ...(Array.isArray(errors) ? errors.map(item) : errors && typeof errors === "object" ? Object.values(errors as Record<string, unknown>).flat().map(String) : []),
      ...(Array.isArray(j.invalidFields) ? (j.invalidFields as unknown[]).map(item) : []),
    ];
    msg = [j.message, j.title, j.detail, j.description, ...list].filter((x) => typeof x === "string" && x.trim()).join(" · ");
  } catch {
    msg = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  }
  if (status === 401) return "NES API anahtarı geçersiz veya süresi dolmuş.";
  // Sık görülen GİB kural hatalarına yol gösterici not
  if (/SERI TESPIT EDILDI|SERILERI BIRBIRINDEN FARKLI/i.test(msg)) msg += " → Bu seri GİB'de diğer belge türünde kullanılmış. NES portalında bu belge türü için tanımlı başka bir seri seçip Ayarlar › e-Fatura Ayarları'nda güncelleyin, sonra tekrar gönderin.";
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

  /** Mükellef sorgusu (e-Fatura veya e-İrsaliye). Kayıtlı değilse null. aliasType: Pk (posta kutusu), Gb (gönderici), All */
  async queryUser(identifier: string, aliasType: "Pk" | "Gb" | "All" = "All", service: "einvoice" | "edespatch" = "einvoice"): Promise<NesUserInfo | null> {
    const res = await this.call(`${service}/v1/users/${encodeURIComponent(identifier)}/${aliasType}`);
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
    fd.append("File", new Blob([xml], { type: "application/xml" }), service === "edespatch" ? "irsaliye.xml" : "fatura.xml");
    fd.append("IsDirectSend", "true");
    fd.append("PreviewType", "None");
    fd.append("SourceApp", "OnMuhasebe");
    fd.append("SourceAppRecordId", opts.recordId);
    if (service === "einvoice" || service === "edespatch") {
      if (opts.senderAlias) fd.append("SenderAlias", opts.senderAlias);
      if (opts.receiverAlias) fd.append("ReceiverAlias", opts.receiverAlias);
    }
    // e-İrsaliye yüklemesinde zorunlu alan: alıcıyı NES portalında firma olarak kaydetme
    if (service === "edespatch") fd.append("AutoSaveCompany", "false");
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

  /** Gelen e-faturalar (sayfalı, en yeni önce) */
  async incomingInvoices(page: number, pageSize: number, startDate?: string): Promise<NesIncomingPage> {
    const q = new URLSearchParams({ sort: "CreatedAt desc", page: String(page), pageSize: String(pageSize) });
    if (startDate) q.set("startDate", startDate);
    return this.json<NesIncomingPage>(`einvoice/v1/incoming/invoices?${q.toString()}`);
  }

  /** Gelen faturanın UBL XML'i */
  async incomingXml(uuid: string): Promise<string> {
    const res = await this.call(`einvoice/v1/incoming/invoices/${uuid}/xml`, { headers: { Accept: "application/xml" } }, 60_000);
    const text = await res.text();
    if (!res.ok) throw new NesError(res.status, nesErrorMessage(res.status, text));
    return text;
  }

  /** Ticari faturaya kabul / red yanıtı */
  async answerIncoming(uuid: string, answer: "KABUL" | "RED", note: string | null) {
    return this.json<{ documentAnswer?: string }>(`einvoice/v1/incoming/invoices/${uuid}/documentAnswer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incomingInvoiceAnswerParameter: answer, answerNote: note ?? "" }),
    });
  }

  // ── e-İrsaliye ──

  /** Giden e-İrsaliye detayı (durum). Bulunamazsa null. */
  async outgoingDespatch(uuid: string): Promise<NesOutgoingDespatch | null> {
    const res = await this.call(`edespatch/v1/outgoing/despatches/${uuid}`);
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) throw new NesError(res.status, nesErrorMessage(res.status, text));
    return JSON.parse(text) as NesOutgoingDespatch;
  }

  /** Gelen e-İrsaliyeler (sayfalı, en yeni önce) */
  async incomingDespatches(page: number, pageSize: number): Promise<NesIncomingDespatchPage> {
    const q = new URLSearchParams({ sort: "CreatedAt desc", page: String(page), pageSize: String(pageSize) });
    return this.json<NesIncomingDespatchPage>(`edespatch/v1/incoming/despatches?${q.toString()}`);
  }

  async incomingDespatchXml(uuid: string): Promise<string> {
    const res = await this.call(`edespatch/v1/incoming/despatches/${uuid}/xml`, { headers: { Accept: "application/xml" } }, 60_000);
    const text = await res.text();
    if (!res.ok) throw new NesError(res.status, nesErrorMessage(res.status, text));
    return text;
  }

  /** PDF / HTML görüntü (ham yanıt; çağıran akıtır) */
  async document(service: NesService, uuid: string, format: "pdf" | "html", direction: "outgoing" | "incoming" = "outgoing"): Promise<Response> {
    const path =
      service === "earchive" ? `earchive/v1/invoices/${uuid}/${format}`
      : service === "edespatch" ? `edespatch/v1/${direction}/despatches/${uuid}/${format}`
      : `einvoice/v1/${direction}/invoices/${uuid}/${format}`;
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

export interface NesIncomingPage {
  page: number;
  pageSize: number;
  totalCount: number;
  data: Array<{
    id: string;
    createdAt: string;
    issueDate: string;
    documentNumber?: string | null;
    profileId?: string;
    invoiceTypeCode?: string;
    payableAmount?: number;
    documentCurrencyCode?: string;
    documentAnswer?: string;
    accountingSupplierParty?: { partyIdentification?: string; partyName?: string | null; firstName?: string | null; familyName?: string | null };
    taxes?: Array<{ taxTypeCode?: string; taxableAmount?: number; taxAmount?: number }>;
  }>;
}

export interface NesOutgoingDespatch {
  id: string;
  documentNumber?: string | null;
  outgoingStatus?: string;
  recordStatus?: string;
  /** Alıcının irsaliye yanıtı: None / Waiting / Answered */
  despatchAnswer?: string;
  errorDescription?: string | null;
  outgoingEnvelope?: { description?: string | null; code?: string | null } | null;
}

export interface NesIncomingDespatchPage {
  page: number;
  pageSize: number;
  totalCount: number;
  data: Array<{
    id: string;
    createdAt: string;
    issueDate: string;
    documentNumber?: string | null;
    despatchAnswer?: string;
    despatchSupplierParty?: { partyIdentification?: string; partyName?: string | null; firstName?: string | null; familyName?: string | null };
  }>;
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
