import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { IncomingStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { getCompany } from "@/server/company";
import { AppError } from "@/lib/errors";
import { mapOutgoingStatus } from "@/lib/edoc-status";
import { buildDespatchXml, validateDespatch, type UblDespatch } from "@/lib/ubl-despatch";
import { parseDespatchUbl } from "@/lib/ubl-parse";
import { NesError, NesTransportError, nesClient } from "@/server/nes/client";
import { saveWaybill, waybillHeaderSchema } from "./waybills";

/**
 * e-İrsaliye (NES edespatch). Giden irsaliye e-İrsaliye olarak gönderilir; gelen e-İrsaliyeler içeri alınıp gelen irsaliyeye işlenir.
 * Çift gönderim olmasın diye fatura ile aynı düzen: UUID önce kaydedilir (QUEUED), sonra NES'e yüklenir;
 * ağ hatasında sonuç "durumu sorgula" ile netleşir.
 * Alıcı e-İrsaliye kullanıcısı değilse gönderilmez (kağıt irsaliye yazdırılır).
 */

const envLabel = (apiUrl: string) => (apiUrl.startsWith("https://api.nes.com.tr") ? "Canlı" : "Test");
const istanbulTime = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/Istanbul", hour12: false });
const MAX_PAGES = 10;

async function loadForSend(id: string) {
  const w = await db.waybill.findUnique({ where: { id }, include: { contact: true, lines: { orderBy: { position: "asc" }, include: { product: { select: { code: true } } } } } });
  if (!w) throw new AppError("NOT_FOUND", "İrsaliye bulunamadı.");
  if (w.direction !== "SALE") throw new AppError("VALIDATION", "Yalnızca giden irsaliye e-İrsaliye olarak gönderilir.");
  return w;
}

function toUbl(w: Awaited<ReturnType<typeof loadForSend>>, company: NonNullable<Awaited<ReturnType<typeof getCompany>>>, series: string, contactName: string): UblDespatch {
  const c = w.contact;
  return {
    uuid: w.eDocUuid ?? "",
    id: series,
    issueDate: w.issueDate.toISOString().slice(0, 10),
    issueTime: istanbulTime(),
    notes: w.notes ? [w.notes] : [],
    supplier: { taxNumber: company.taxNumber ?? "", title: company.title, taxOffice: company.taxOffice, address: company.address, district: company.district, city: company.city, postalCode: company.postalCode, phone: company.phone, email: company.email, website: company.website },
    despatchContact: contactName,
    customer: { taxNumber: c.taxNumber ?? "", title: c.title, taxOffice: c.taxOffice, address: c.address, district: c.isAbroad ? c.city : c.district, city: c.city, postalCode: c.postalCode, country: c.isAbroad ? c.country : null, phone: c.phone, email: c.email },
    deliveryAddress: w.deliveryAddress,
    despatchDate: w.dispatchDate.toISOString().slice(0, 10),
    despatchTime: w.dispatchTime ?? "",
    driver: w.driverName || w.driverTckn ? { name: w.driverName ?? "", tckn: w.driverTckn ?? "" } : null,
    vehiclePlate: w.vehiclePlate,
    trailerPlate: w.trailerPlate,
    carrier: w.carrierTaxNumber || w.carrierTitle ? { taxNumber: w.carrierTaxNumber ?? "", title: w.carrierTitle ?? "", district: w.carrierDistrict, city: w.carrierCity } : null,
    lines: w.lines.map((l) => ({ name: l.name, code: l.product?.code ?? null, quantity: l.quantity.toString(), unitCode: l.unit })),
  };
}

/** Alıcının e-İrsaliye posta kutusu (PK) etiketi; kayıtlı değilse null */
async function receiverAlias(client: Awaited<ReturnType<typeof nesClient>>["client"], taxNumber: string | null) {
  if (!taxNumber || taxNumber === "11111111111") return null;
  const u = await client.queryUser(taxNumber, "Pk", "edespatch");
  return u?.aliases?.find((a) => a.type === "Pk")?.alias ?? null;
}

/** Gönderim ön kontrolü: alıcı e-İrsaliye kullanıcısı mı, eksik bilgiler (belge gönderilmez) */
export async function prepareDespatch(user: CurrentUser, id: string) {
  assertCan(user, "einvoice.send");
  const w = await loadForSend(id);
  const company = await getCompany();
  const { cfg, client } = await nesClient();
  const errors: string[] = [];
  let alias: string | null = null;
  try {
    alias = await receiverAlias(client, w.contact.taxNumber);
  } catch (err) {
    errors.push(`Alıcı sorgulanamadı: ${(err as Error).message}`);
  }
  if (!alias && !errors.length) errors.push("Alıcı e-İrsaliye kullanıcısı değil. Bu irsaliyeyi kağıt olarak yazdırın.");
  if (!cfg.despatchSenderAlias) errors.push("e-İrsaliye gönderici (GB) etiketi tanımlı değil — e-Fatura Ayarları'nda 'Bağlantıyı test et'.");
  if (company) errors.push(...validateDespatch(toUbl(w, company, cfg.despatchSeries ?? "", user.name)));
  else errors.push("Firma bilgileri girilmemiş.");
  return { alias, errors, env: envLabel(cfg.apiUrl), status: w.eDocStatus };
}

export async function sendDespatch(user: CurrentUser, id: string) {
  assertCan(user, "einvoice.send");
  const { cfg, client } = await nesClient();
  const company = await getCompany();
  if (!company) throw new AppError("VALIDATION", "Firma bilgileri girilmemiş.");
  // Eşzamanlı ikinci gönderim engeli: NONE/FAILED → QUEUED atomik
  const claimed = await db.waybill.updateMany({ where: { id, direction: "SALE", eDocStatus: { in: ["NONE", "FAILED"] } }, data: { eDocStatus: "QUEUED", eDocError: null } });
  if (!claimed.count) {
    const cur = await db.waybill.findUnique({ where: { id }, select: { eDocStatus: true } });
    if (!cur) throw new AppError("NOT_FOUND", "İrsaliye bulunamadı.");
    throw new AppError("CONFLICT", cur.eDocStatus === "QUEUED" ? "Bu irsaliye şu an gönderiliyor. Birkaç saniye sonra durumu sorgulayın." : "Bu irsaliye zaten e-İrsaliye olarak gönderilmiş.");
  }
  try {
    let w = await loadForSend(id);
    if (!w.eDocUuid) {
      await db.waybill.update({ where: { id }, data: { eDocUuid: randomUUID() } });
      w = await loadForSend(id);
    }
    const alias = await receiverAlias(client, w.contact.taxNumber);
    if (!alias) throw new AppError("VALIDATION", "Alıcı e-İrsaliye kullanıcısı değil. Bu irsaliyeyi kağıt olarak yazdırın.");
    if (!cfg.despatchSenderAlias) throw new AppError("VALIDATION", "e-İrsaliye gönderici (GB) etiketi tanımlı değil. e-Fatura Ayarları'nda 'Bağlantıyı test et'.");
    const ubl = toUbl(w, company, cfg.despatchSeries ?? "", user.name);
    const errs = validateDespatch(ubl);
    if (errs.length) throw new AppError("VALIDATION", errs.join(" "));
    const r = await client.upload("edespatch", buildDespatchXml(ubl), { senderAlias: cfg.despatchSenderAlias, receiverAlias: alias, recordId: w.id });
    await db.waybill.update({ where: { id }, data: { eDocStatus: "SENT", eDocSentAt: new Date(), waybillNo: r.documentNumber ?? w.waybillNo, eDocError: null } });
    await audit({ userId: user.id, action: "edespatch.sent", entityType: "Waybill", entityId: id, metadata: { uuid: w.eDocUuid, documentNumber: r.documentNumber } });
    return { status: "SENT" as const, documentNumber: r.documentNumber };
  } catch (err) {
    if (err instanceof NesTransportError) {
      await db.waybill.update({ where: { id }, data: { eDocError: `${err.message} Durumu sorgulayın.` } });
      throw new AppError("EXTERNAL", `${err.message} İrsaliye gönderilmiş olabilir; "Durumu sorgula" ile kontrol edin.`);
    }
    if (err instanceof NesError && err.status === 409) {
      await db.waybill.update({ where: { id }, data: { eDocStatus: "SENT", eDocSentAt: new Date() } });
      return refreshDespatch(user, id);
    }
    await db.waybill.update({ where: { id }, data: { eDocStatus: "FAILED", eDocError: (err as Error).message.slice(0, 1000) } });
    await audit({ userId: user.id, action: "edespatch.failed", entityType: "Waybill", entityId: id, metadata: { error: (err as Error).message.slice(0, 300) } });
    throw err;
  }
}

/** NES'ten güncel durum: resmileşti / hata; alıcı yanıtı (ReceiptAdvice) */
export async function refreshDespatch(user: CurrentUser, id: string) {
  assertCan(user, "sales.read");
  const w = await db.waybill.findUnique({ where: { id }, select: { eDocUuid: true, waybillNo: true } });
  if (!w?.eDocUuid) throw new AppError("VALIDATION", "İrsaliye henüz e-İrsaliye olarak gönderilmemiş.");
  const { client } = await nesClient();
  const d = await client.outgoingDespatch(w.eDocUuid);
  if (!d) {
    // NES'te yok: gönderim ulaşmamış → aynı UUID ile tekrar gönderilebilir
    await db.waybill.update({ where: { id }, data: { eDocStatus: "FAILED", eDocError: "Belge NES'te bulunamadı (gönderim ulaşmamış). Tekrar gönderebilirsiniz.", eDocCheckedAt: new Date() } });
    return { status: "FAILED" as const, documentNumber: null };
  }
  const status = mapOutgoingStatus({ outgoingStatus: d.outgoingStatus, recordStatus: d.recordStatus });
  const error = status === "FAILED" ? (d.errorDescription || d.outgoingEnvelope?.description || "GİB / alıcı zarfı reddetti.") : null;
  await db.waybill.update({
    where: { id },
    data: { eDocStatus: status, eDocError: error, eDocCheckedAt: new Date(), eDocAnswer: d.despatchAnswer ?? null, waybillNo: d.documentNumber ?? w.waybillNo },
  });
  return { status, documentNumber: d.documentNumber ?? null };
}

/** NES görüntüsü (HTML / PDF) */
export async function despatchDocument(user: CurrentUser, id: string, format: "pdf" | "html", direction: "outgoing" | "incoming" = "outgoing") {
  const uuid =
    direction === "outgoing"
      ? (await db.waybill.findUnique({ where: { id }, select: { eDocUuid: true } }))?.eDocUuid
      : (await db.incomingDespatch.findUnique({ where: { id }, select: { uuid: true } }))?.uuid;
  assertCan(user, direction === "outgoing" ? "sales.read" : "expenses.read");
  if (!uuid) throw new AppError("NOT_FOUND", "e-İrsaliye bulunamadı.");
  const { client } = await nesClient();
  return { res: await client.document("edespatch", uuid, format, direction), fileName: `irsaliye-${uuid}.${format}` };
}

// ── Gelen e-İrsaliyeler ────────────────────────────────────

export const INCOMING_DESPATCH_LABELS: Record<IncomingStatus, string> = { NEW: "İşlenmedi", PROCESSED: "Gelen irsaliyeye işlendi", IGNORED: "Yok sayıldı" };

export async function syncIncomingDespatches(user: CurrentUser) {
  assertCan(user, "expenses.write");
  const { client } = await nesClient();
  let created = 0;
  let updated = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await client.incomingDespatches(page, 100);
    for (const d of r.data ?? []) {
      const s = d.despatchSupplierParty ?? {};
      const title = (s.partyName || [s.firstName, s.familyName].filter(Boolean).join(" ") || "Bilinmeyen gönderici").slice(0, 250);
      const existing = await db.incomingDespatch.findUnique({ where: { uuid: d.id }, select: { id: true } });
      if (existing) {
        await db.incomingDespatch.update({ where: { id: existing.id }, data: { answer: d.despatchAnswer ?? null, syncedAt: new Date() } });
        updated++;
      } else {
        await db.incomingDespatch.create({
          data: { uuid: d.id, documentNumber: d.documentNumber ?? null, issueDate: new Date(d.issueDate.slice(0, 10)), senderTaxNumber: s.partyIdentification ?? null, senderTitle: title, answer: d.despatchAnswer ?? null, receivedAt: new Date(d.createdAt) },
        });
        created++;
      }
    }
    if (!r.data || r.data.length < 100 || page * 100 >= r.totalCount) break;
  }
  await audit({ userId: user.id, action: "edespatch.incoming_synced", metadata: { created, updated } });
  return { created, updated };
}

export async function listIncomingDespatches(user: CurrentUser, status?: IncomingStatus) {
  assertCan(user, "expenses.read");
  const [rows, last] = await Promise.all([
    db.incomingDespatch.findMany({ where: status ? { status } : {}, orderBy: { receivedAt: "desc" }, take: 200, include: { waybill: { select: { id: true } } } }),
    db.incomingDespatch.findFirst({ orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
  ]);
  return { rows, lastSync: last?.syncedAt ?? null };
}

export const processDespatchSchema = z.object({ warehouseId: z.string().optional().transform((v) => v || null) });

/**
 * Gelen e-İrsaliyeyi gelen irsaliye olarak işler: tedarikçi VKN ile bulunur (yoksa açılır), ürünler adı birebir
 * eşleşirse stoğa girer. Kayıt atomik sahiplenilir; hata olursa geri bırakılır.
 */
export async function processIncomingDespatch(user: CurrentUser, id: string, opts: z.infer<typeof processDespatchSchema>) {
  assertCan(user, "expenses.write");
  assertCan(user, "stock.write");
  const claimed = await db.incomingDespatch.updateMany({ where: { id, status: "NEW" }, data: { status: "PROCESSED" } });
  if (!claimed.count) throw new AppError("CONFLICT", "Bu irsaliye zaten işlenmiş veya yok sayılmış.");
  try {
    const inc = await db.incomingDespatch.findUniqueOrThrow({ where: { id } });
    const { client } = await nesClient();
    const ubl = parseDespatchUbl(await client.incomingDespatchXml(inc.uuid));
    const taxNumber = ubl.supplier.taxNumber ?? inc.senderTaxNumber;
    let supplier = taxNumber ? await db.contact.findFirst({ where: { kind: "SUPPLIER", taxNumber }, select: { id: true } }) : null;
    if (!supplier) {
      supplier = await db.contact.create({
        data: {
          kind: "SUPPLIER", personType: taxNumber?.length === 11 ? "NATURAL" : "LEGAL", title: ubl.supplier.title || inc.senderTitle, taxNumber,
          taxOffice: ubl.supplier.taxOffice, address: ubl.supplier.address, district: ubl.supplier.district, city: ubl.supplier.city, email: ubl.supplier.email, phone: ubl.supplier.phone,
        },
        select: { id: true },
      });
    }
    const products = await db.product.findMany({ where: { isArchived: false }, select: { id: true, name: true } });
    const byName = new Map(products.map((p) => [p.name.toLocaleLowerCase("tr"), p.id]));
    const issue = ubl.issueDate || inc.issueDate.toISOString().slice(0, 10);
    const waybillId = await saveWaybill(
      user,
      "PURCHASE",
      null,
      waybillHeaderSchema.parse({ contactId: supplier.id, warehouseId: opts.warehouseId ?? undefined, waybillNo: inc.documentNumber ?? ubl.id, issueDate: issue, dispatchDate: ubl.despatchDate && ubl.despatchDate >= issue ? ubl.despatchDate : issue, notes: ubl.notes.join("\n") || undefined }),
      ubl.lines.map((l) => ({ productId: byName.get(l.name.toLocaleLowerCase("tr")) ?? null, name: l.name.slice(0, 250), quantity: l.quantity, unit: l.unit })),
    );
    await db.incomingDespatch.update({ where: { id }, data: { waybillId } });
    await audit({ userId: user.id, action: "edespatch.incoming_processed", entityType: "IncomingDespatch", entityId: id, metadata: { waybillId, warnings: ubl.warnings } });
    return { waybillId, warnings: ubl.warnings };
  } catch (err) {
    await db.incomingDespatch.updateMany({ where: { id, status: "PROCESSED", waybillId: null }, data: { status: "NEW" } });
    throw err;
  }
}

export async function setIncomingDespatchIgnored(user: CurrentUser, id: string, ignored: boolean) {
  assertCan(user, "expenses.write");
  const r = await db.incomingDespatch.updateMany({ where: { id, status: ignored ? "NEW" : "IGNORED" }, data: { status: ignored ? "IGNORED" : "NEW" } });
  if (!r.count) throw new AppError("CONFLICT", "İrsaliye bu durumda değil.");
}
