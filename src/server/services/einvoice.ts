import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan, can } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { encryptSecret } from "@/server/crypto";
import { getCompany } from "@/server/company";
import { AppError } from "@/lib/errors";
import { buildInvoiceXml, validateForUbl, type UblInvoice, type UblProfile } from "@/lib/ubl";
import { VAT_EXEMPTION_CODES } from "@/lib/gib-codes";
import { mapArchiveStatus, mapOutgoingStatus, type EDoc } from "@/lib/edoc-status";
import { checkTaxId } from "@/lib/tax-id";
import { NesError, NesTransportError, nesClient } from "@/server/nes/client";

/** Yalnızca gerçek canlı NES adresi "Canlı"; diğer her şey (test, yerel) "Test" */
const envLabel = (apiUrl: string) => (apiUrl.startsWith("https://api.nes.com.tr") ? "Canlı" : "Test");

// ── Ayarlar ────────────────────────────────────────────────

export const settingsSchema = z.object({
  apiUrl: z.enum(["https://apitest.nes.com.tr/", "https://api.nes.com.tr/"], { message: "Ortam seçin." }),
  apiKey: z.string().trim().max(500).optional().transform((v) => v || null),
  senderAlias: z.string().trim().max(200).optional().transform((v) => v || null),
  eInvoiceSeries: z.string().trim().toUpperCase().optional().transform((v) => v || null).refine((v) => v === null || /^[A-Z0-9]{3}$/.test(v), "Seri 3 karakter olmalı (ör. ABC)."),
  eArchiveSeries: z.string().trim().toUpperCase().optional().transform((v) => v || null).refine((v) => v === null || /^[A-Z0-9]{3}$/.test(v), "Seri 3 karakter olmalı (ör. ABC)."),
  defaultProfile: z.enum(["TICARIFATURA", "TEMELFATURA"]).default("TICARIFATURA"),
  despatchSeries: z.string().trim().toUpperCase().optional().transform((v) => v || null).refine((v) => v === null || /^[A-Z0-9]{3}$/.test(v), "Seri 3 karakter olmalı (ör. IRS)."),
  despatchSenderAlias: z.string().trim().max(200).optional().transform((v) => v || null),
}).superRefine((v, ctx) => {
  // GİB: e-Fatura ve e-Arşiv aynı seriyle kesilemez
  if (v.eInvoiceSeries && v.eInvoiceSeries === v.eArchiveSeries) ctx.addIssue({ code: "custom", path: ["eArchiveSeries"], message: "e-Arşiv serisi e-Fatura serisinden farklı olmalı." });
});

/** API anahtarı asla geri gösterilmez: yalnızca son 4 karakteri */
export async function getEInvoiceSettings(user: CurrentUser) {
  assertCan(user, "settings.manage");
  const s = await db.eInvoiceSettings.findUnique({ where: { id: "nes" } });
  return {
    apiUrl: s?.apiUrl ?? "https://apitest.nes.com.tr/",
    hasKey: Boolean(s?.apiKeyEnc),
    apiKeyLast4: s?.apiKeyLast4 ?? null,
    senderAlias: s?.senderAlias ?? null,
    eInvoiceSeries: s?.eInvoiceSeries ?? null,
    eArchiveSeries: s?.eArchiveSeries ?? null,
    defaultProfile: s?.defaultProfile ?? "TICARIFATURA",
    despatchSeries: s?.despatchSeries ?? null,
    despatchSenderAlias: s?.despatchSenderAlias ?? null,
  };
}

export async function saveEInvoiceSettings(user: CurrentUser, input: z.infer<typeof settingsSchema>) {
  assertCan(user, "settings.manage");
  const keyData = input.apiKey ? { apiKeyEnc: encryptSecret(input.apiKey), apiKeyLast4: input.apiKey.slice(-4) } : {};
  const data = { apiUrl: input.apiUrl, senderAlias: input.senderAlias, eInvoiceSeries: input.eInvoiceSeries, eArchiveSeries: input.eArchiveSeries, defaultProfile: input.defaultProfile, despatchSeries: input.despatchSeries, despatchSenderAlias: input.despatchSenderAlias, ...keyData };
  await db.eInvoiceSettings.upsert({ where: { id: "nes" }, create: { id: "nes", ...data }, update: data });
  await audit({ userId: user.id, action: "einvoice.settings_updated", metadata: { apiUrl: input.apiUrl, keyChanged: Boolean(input.apiKey) } });
}

/** Bağlantı testi: firmanın kendi VKN'si sorgulanır; gönderici (GB) etiketi boşsa doldurulur */
export async function testConnection(user: CurrentUser) {
  assertCan(user, "settings.manage");
  const company = await getCompany();
  if (!company?.taxNumber) throw new AppError("VALIDATION", "Önce Firma Bilgileri'nde VKN / TCKN girin.");
  const { cfg, client } = await nesClient();
  const me = await client.queryUser(company.taxNumber, "Gb");
  const gb = me?.aliases?.filter((a) => a.type === "Gb").map((a) => a.alias) ?? [];
  if (gb.length && !cfg.senderAlias) await db.eInvoiceSettings.update({ where: { id: "nes" }, data: { senderAlias: gb[0] } });
  // e-İrsaliye kullanıcısı mı (ayrı etiket); API anahtarının e-İrsaliye yetkisi yoksa e-Fatura testi yine geçerli
  let despatchAliases: string[] = [];
  try {
    const d = await client.queryUser(company.taxNumber, "Gb", "edespatch");
    despatchAliases = d?.aliases?.filter((a) => a.type === "Gb").map((a) => a.alias) ?? [];
    if (despatchAliases.length && !cfg.despatchSenderAlias) await db.eInvoiceSettings.update({ where: { id: "nes" }, data: { despatchSenderAlias: despatchAliases[0] } });
  } catch {
    despatchAliases = [];
  }
  return { ok: true as const, isEInvoiceUser: Boolean(me), title: me?.title ?? null, senderAliases: gb, despatchAliases, env: envLabel(cfg.apiUrl) };
}

// ── Mükellef sorgusu ───────────────────────────────────────

/** VKN / TCKN e-Fatura mükellefi mi? Aynı numaralı carilerin etiket bilgisi güncellenir. */
export async function lookupTaxpayer(user: CurrentUser, taxNumber: string) {
  if (!can(user.role, "sales.write") && !can(user.role, "expenses.write")) throw new AppError("FORBIDDEN", "Bu işlem için yetkiniz yok.");
  const check = checkTaxId(taxNumber);
  if (!check.ok) throw new AppError("VALIDATION", check.message);
  const { client } = await nesClient();
  const u = await client.queryUser(taxNumber, "Pk");
  const pk = u?.aliases?.filter((a) => a.type === "Pk").map((a) => a.alias) ?? [];
  await db.contact.updateMany({ where: { taxNumber }, data: { eInvoiceAlias: pk[0] ?? null, eInvoiceCheckedAt: new Date() } });
  return { isEInvoiceUser: pk.length > 0, title: u?.title ?? null, aliases: pk };
}

// ── Gönderim ───────────────────────────────────────────────

async function loadForSend(invoiceId: string) {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { contact: true, lines: { orderBy: { position: "asc" }, include: { product: { select: { code: true } } } } } });
  if (!inv) throw new AppError("NOT_FOUND", "Fatura bulunamadı.");
  if (inv.direction !== "SALE") throw new AppError("VALIDATION", "Yalnızca satış faturaları e-belge olarak gönderilir.");
  return inv;
}

/** Türkiye saatiyle şimdi (IssueTime) */
const istanbulTime = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/Istanbul", hour12: false });

function toUbl(inv: Awaited<ReturnType<typeof loadForSend>>, company: NonNullable<Awaited<ReturnType<typeof getCompany>>>, profile: UblProfile, series: string, sendType: "ELEKTRONIK" | "KAGIT"): UblInvoice {
  const c = inv.contact;
  return {
    uuid: inv.eDocUuid ?? "",
    id: series,
    profile,
    kind: inv.kind,
    issueDate: inv.issueDate.toISOString().slice(0, 10),
    issueTime: istanbulTime(),
    currency: inv.currency,
    exchangeRate: inv.exchangeRate.toString(),
    notes: inv.notes ? [inv.notes] : [],
    orderNo: inv.orderNo,
    orderDate: inv.orderDate?.toISOString().slice(0, 10) ?? null,
    dueDate: inv.dueDate.toISOString().slice(0, 10),
    returnRef: inv.kind === "RETURN" && inv.returnRefNo && inv.returnRefDate ? { no: inv.returnRefNo, date: inv.returnRefDate.toISOString().slice(0, 10) } : null,
    sendType,
    supplier: { taxNumber: company.taxNumber ?? "", title: company.title, taxOffice: company.taxOffice, address: company.address, district: company.district, city: company.city, postalCode: company.postalCode, phone: company.phone, email: company.email, website: company.website },
    customer: { taxNumber: c.taxNumber ?? "", title: c.title, taxOffice: c.taxOffice, address: c.address, district: c.isAbroad ? c.city : c.district, city: c.city, postalCode: c.postalCode, country: c.isAbroad ? c.country : null, phone: c.phone, email: c.email },
    lines: inv.lines.map((l) => ({
      name: l.name, description: l.description, code: l.product?.code ?? null, quantity: l.quantity.toString(), unitCode: l.unit, unitPrice: l.unitPrice.toString(),
      grossAmount: l.grossAmount.toString(), discountAmount: l.discountAmount.toString(), netAmount: l.netAmount.toString(),
      vatRate: l.vatRate, vatAmount: l.vatAmount.toString(), vatExemptionCode: l.vatExemptionCode, vatExemptionReason: VAT_EXEMPTION_CODES.find((x) => x.code === l.vatExemptionCode)?.label ?? null,
      otvCode: l.otvCode, otvRate: l.otvRate?.toString() ?? null, otvAmount: l.otvAmount.toString(),
      withholdingCode: l.withholdingCode, withholdingRate: l.withholdingRate, withholdingAmount: l.withholdingAmount.toString(),
    })),
    totals: {
      grossTotal: inv.grossTotal.toString(), discountTotal: inv.discountTotal.toString(), netTotal: inv.netTotal.toString(), otvTotal: inv.otvTotal.toString(),
      vatTotal: inv.vatTotal.toString(), withholdingTotal: inv.withholdingTotal.toString(), grandTotal: inv.grandTotal.toString(), payableTotal: inv.payableTotal.toString(),
    },
  };
}

/**
 * Gönderim ön kontrolü (dialog için): alıcı e-Fatura mükellefi mi, hangi senaryo, eksikler.
 * NES'e yalnızca mükellef sorgusu yapılır; belge gönderilmez.
 */
export async function prepareSend(user: CurrentUser, invoiceId: string) {
  assertCan(user, "einvoice.send");
  const inv = await loadForSend(invoiceId);
  const company = await getCompany();
  const { cfg, client } = await nesClient();
  const taxNumber = inv.contact.taxNumber;
  let alias: string | null = null;
  let lookupError: string | null = null;
  if (taxNumber && taxNumber !== "11111111111") {
    try {
      const u = await client.queryUser(taxNumber, "Pk");
      alias = u?.aliases?.find((a) => a.type === "Pk")?.alias ?? null;
      await db.contact.update({ where: { id: inv.contactId }, data: { eInvoiceAlias: alias, eInvoiceCheckedAt: new Date() } });
    } catch (err) {
      lookupError = (err as Error).message;
    }
  }
  const profile: UblProfile = alias ? (cfg.defaultProfile as UblProfile) : "EARSIVFATURA";
  const series = (profile === "EARSIVFATURA" ? cfg.eArchiveSeries : cfg.eInvoiceSeries) ?? "";
  const errors = company ? validateForUbl(toUbl(inv, company, profile, series, "ELEKTRONIK")) : ["Firma bilgileri girilmemiş."];
  if (profile !== "EARSIVFATURA" && !cfg.senderAlias) errors.push("Gönderici (GB) etiketi tanımlı değil — e-Fatura Ayarları'nda 'Bağlantıyı test et'.");
  if (lookupError) errors.push(`Mükellef sorgusu yapılamadı: ${lookupError}`);
  return { isEInvoiceUser: Boolean(alias), alias, profile, errors, env: envLabel(cfg.apiUrl), status: inv.eDocStatus };
}

/** Gönderilecek XML'in önizlemesi (destek / hata ayıklama): NES'e gönderilmez */
export async function invoiceXmlPreview(user: CurrentUser, invoiceId: string) {
  assertCan(user, "einvoice.send");
  const inv = await loadForSend(invoiceId);
  const company = await getCompany();
  if (!company) throw new AppError("VALIDATION", "Firma bilgileri girilmemiş.");
  const s = await db.eInvoiceSettings.findUnique({ where: { id: "nes" } });
  const profile = (inv.eDocProfile as UblProfile | null) ?? "EARSIVFATURA";
  const series = (profile === "EARSIVFATURA" ? s?.eArchiveSeries : s?.eInvoiceSeries) ?? "";
  const ubl = { ...toUbl(inv, company, profile, series, "ELEKTRONIK"), uuid: inv.eDocUuid ?? "00000000-0000-0000-0000-000000000000" };
  return { xml: buildInvoiceXml(ubl), errors: validateForUbl(ubl) };
}

export const sendSchema = z.object({
  profile: z.enum(["TICARIFATURA", "TEMELFATURA", "EARSIVFATURA"]),
  sendType: z.enum(["ELEKTRONIK", "KAGIT"]).default("ELEKTRONIK"),
});

/**
 * e-Fatura / e-Arşiv gönderimi. Çift fatura kesilmesin diye:
 *  1) UUID önce veritabanına yazılır (QUEUED), 2) NES'e yüklenir, 3) sonuç yazılır.
 *  Ağ hatasında (sonuç bilinmiyor) QUEUED kalır; "durumu sorgula" aynı UUID ile netleştirir.
 */
export async function sendInvoice(user: CurrentUser, invoiceId: string, input: z.infer<typeof sendSchema>) {
  assertCan(user, "einvoice.send");
  const { cfg, client } = await nesClient();
  const company = await getCompany();
  if (!company) throw new AppError("VALIDATION", "Firma bilgileri girilmemiş.");

  // Aynı faturanın eşzamanlı ikinci gönderimini engelle: NONE/FAILED → QUEUED geçişi atomik
  const claimed = await db.invoice.updateMany({ where: { id: invoiceId, direction: "SALE", eDocStatus: { in: ["NONE", "FAILED"] } }, data: { eDocStatus: "QUEUED", eDocProfile: input.profile, eDocError: null } });
  if (!claimed.count) {
    const cur = await db.invoice.findUnique({ where: { id: invoiceId }, select: { eDocStatus: true } });
    if (!cur) throw new AppError("NOT_FOUND", "Fatura bulunamadı.");
    throw new AppError("CONFLICT", cur.eDocStatus === "QUEUED" ? "Bu fatura şu an gönderiliyor. Birkaç saniye sonra durumu sorgulayın." : "Bu fatura zaten e-belge olarak gönderilmiş.");
  }

  try {
    let inv = await loadForSend(invoiceId);
    if (!inv.eDocUuid) inv = await db.invoice.update({ where: { id: invoiceId }, data: { eDocUuid: randomUUID() }, include: { contact: true, lines: { orderBy: { position: "asc" }, include: { product: { select: { code: true } } } } } });
    const isArchive = input.profile === "EARSIVFATURA";
    let receiverAlias: string | null = null;
    if (!isArchive) {
      const u = inv.contact.taxNumber ? await client.queryUser(inv.contact.taxNumber, "Pk") : null;
      receiverAlias = u?.aliases?.find((a) => a.type === "Pk")?.alias ?? null;
      if (!receiverAlias) throw new AppError("VALIDATION", "Alıcı e-Fatura mükellefi değil; e-Arşiv olarak gönderin.");
      if (!cfg.senderAlias) throw new AppError("VALIDATION", "Gönderici (GB) etiketi tanımlı değil. e-Fatura Ayarları'nda 'Bağlantıyı test et'.");
    }
    const series = (isArchive ? cfg.eArchiveSeries : cfg.eInvoiceSeries) ?? "";
    const ubl = toUbl(inv, company, input.profile, series, input.sendType);
    const errs = validateForUbl(ubl);
    if (errs.length) throw new AppError("VALIDATION", errs.join(" "));

    const r = await client.upload(isArchive ? "earchive" : "einvoice", buildInvoiceXml(ubl), { senderAlias: cfg.senderAlias, receiverAlias, recordId: inv.id });
    await db.invoice.update({ where: { id: invoiceId }, data: { eDocStatus: "SENT", eDocSentAt: new Date(), invoiceNo: r.documentNumber ?? inv.invoiceNo, eDocError: null } });
    await audit({ userId: user.id, action: "einvoice.sent", entityType: "Invoice", entityId: invoiceId, metadata: { profile: input.profile, uuid: inv.eDocUuid, documentNumber: r.documentNumber } });
    return { status: "SENT" as const, documentNumber: r.documentNumber };
  } catch (err) {
    if (err instanceof NesTransportError) {
      // Sonuç bilinmiyor → QUEUED kalır (tekrar gönderim engelli), durum sorgusu netleştirir
      await db.invoice.update({ where: { id: invoiceId }, data: { eDocError: `${err.message} Durumu sorgulayın.` } });
      throw new AppError("EXTERNAL", `${err.message} Fatura gönderilmiş olabilir; "Durumu sorgula" ile kontrol edin.`);
    }
    if (err instanceof NesError && err.status === 409) {
      // UUID / numara NES'te zaten var → durumla eşitle
      await db.invoice.update({ where: { id: invoiceId }, data: { eDocStatus: "SENT", eDocSentAt: new Date() } });
      return refreshStatus(user, invoiceId);
    }
    // NES belgeyi kabul etmedi veya ön kontrol hatası → tekrar gönderilebilir
    await db.invoice.update({ where: { id: invoiceId }, data: { eDocStatus: "FAILED", eDocError: (err as Error).message.slice(0, 1000) } });
    await audit({ userId: user.id, action: "einvoice.failed", entityType: "Invoice", entityId: invoiceId, metadata: { error: (err as Error).message.slice(0, 300) } });
    throw err;
  }
}

/** NES'ten güncel durumu alır; ret / iptal durumunda fatura bakiye ve stoktan düşer */
export async function refreshStatus(user: CurrentUser, invoiceId: string) {
  assertCan(user, "sales.read");
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, eDocUuid: true, eDocProfile: true, eDocStatus: true, eDocSentAt: true } });
  if (!inv?.eDocUuid || !inv.eDocProfile) throw new AppError("VALIDATION", "Fatura henüz e-belge olarak gönderilmemiş.");
  const { client } = await nesClient();
  const isArchive = inv.eDocProfile === "EARSIVFATURA";
  let status: EDoc;
  let error: string | null = null;
  let documentNumber: string | null = null;
  let answer: string | null = null;
  if (isArchive) {
    const d = await client.archiveInvoice(inv.eDocUuid);
    if (!d) return markNotFound(inv.id);
    status = mapArchiveStatus(d);
    error = d.errorDescription ?? null;
    documentNumber = d.documentNumber ?? null;
  } else {
    const d = await client.outgoingInvoice(inv.eDocUuid);
    if (!d) return markNotFound(inv.id);
    status = mapOutgoingStatus(d);
    error = status === "FAILED" ? (d.outgoingEnvelope?.description ?? "GİB / alıcı zarfı reddetti.") : status === "REJECTED" ? (d.incomingAnswer?.answerNote ?? "Alıcı faturayı reddetti.") : null;
    documentNumber = d.documentNumber ?? null;
    answer = d.incomingAnswer?.documentAnswer ?? d.documentAnswer ?? null;
  }
  await applyStatus(inv.id, status, { error, documentNumber, answer });
  return { status, documentNumber };
}

/** NES'te kayıt yoksa: gönderim hiç ulaşmamış → tekrar gönderilebilir (aynı UUID ile) */
async function markNotFound(invoiceId: string) {
  await db.invoice.update({ where: { id: invoiceId }, data: { eDocStatus: "FAILED", eDocError: "Belge NES'te bulunamadı (gönderim ulaşmamış). Tekrar gönderebilirsiniz." } });
  return { status: "FAILED" as const, documentNumber: null };
}

async function applyStatus(invoiceId: string, status: EDoc, x: { error: string | null; documentNumber: string | null; answer: string | null }) {
  await db.$transaction(async (tx) => {
    const before = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { eDocStatus: true, invoiceNo: true } });
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { eDocStatus: status, eDocError: x.error, eDocCheckedAt: new Date(), eDocAnswer: x.answer, invoiceNo: x.documentNumber ?? before.invoiceNo },
    });
    // Ret / iptal: hukuki etkisi kalmayan faturanın stok hareketi geri alınır (bakiye ledger'da hariç tutulur)
    if ((status === "REJECTED" || status === "CANCELLED") && before.eDocStatus !== status) {
      const moves = await tx.stockMovement.findMany({ where: { invoiceId }, select: { productId: true, quantity: true } });
      for (const m of moves) await tx.product.update({ where: { id: m.productId }, data: { stockQuantity: { decrement: m.quantity } } });
      await tx.stockMovement.deleteMany({ where: { invoiceId } });
    }
  });
}

/** e-Arşiv iptali (e-Fatura iptali NES / GİB portalından yapılır) */
export async function cancelArchiveInvoice(user: CurrentUser, invoiceId: string) {
  assertCan(user, "einvoice.send");
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { eDocUuid: true, eDocProfile: true, eDocStatus: true, _count: { select: { transactions: true } } } });
  if (!inv?.eDocUuid) throw new AppError("NOT_FOUND", "Fatura bulunamadı.");
  if (inv.eDocProfile !== "EARSIVFATURA") throw new AppError("VALIDATION", "e-Fatura API ile iptal edilemez; alıcıyla iade faturası veya GİB portalı üzerinden iptal yapılır.");
  if (!["SENT", "ACCEPTED"].includes(inv.eDocStatus)) throw new AppError("CONFLICT", "Bu fatura iptal edilebilir durumda değil.");
  if (inv._count.transactions > 0) throw new AppError("CONFLICT", "Faturaya bağlı tahsilat var. İptalden önce tahsilatları silin veya cariye aktarın.");
  const { client } = await nesClient();
  await client.cancelArchive([inv.eDocUuid]);
  await applyStatus(invoiceId, "CANCELLED", { error: null, documentNumber: null, answer: null });
  await audit({ userId: user.id, action: "einvoice.archive_cancelled", entityType: "Invoice", entityId: invoiceId });
}

/** PDF / HTML akışı (API route) */
export async function eDocDocument(user: CurrentUser, invoiceId: string, format: "pdf" | "html") {
  assertCan(user, "sales.read");
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { eDocUuid: true, eDocProfile: true, eDocStatus: true, invoiceNo: true } });
  if (!inv?.eDocUuid || !inv.eDocProfile || inv.eDocStatus === "NONE") throw new AppError("NOT_FOUND", "e-Belge bulunamadı.");
  const { client } = await nesClient();
  const res = await client.document(inv.eDocProfile === "EARSIVFATURA" ? "earchive" : "einvoice", inv.eDocUuid, format);
  return { res, fileName: `${inv.invoiceNo ?? inv.eDocUuid}.${format}` };
}

