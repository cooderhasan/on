import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";
import type { IncomingStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { parseIncomingUbl } from "@/lib/ubl-parse";
import { VAT_RATES, CURRENCIES } from "@/lib/units";
import { documentHeaderSchema, type ParsedLine } from "@/lib/document-form";
import { nesClient } from "@/server/nes/client";
import { saveInvoice } from "./invoices";

const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
export const PAGE_SIZE = 25;
/** Tek seferde en fazla çekilecek sayfa (100'lük) — çok eski geçmiş için tekrar çalıştırılabilir */
const MAX_PAGES = 10;

export const INCOMING_STATUS_LABELS: Record<IncomingStatus, string> = { NEW: "İşlenmedi", PROCESSED: "Gidere işlendi", IGNORED: "Yok sayıldı" };

/** NES'teki gelen faturaları içeri alır (uuid ile; mevcutsa yanıt / tutar güncellenir) */
export async function syncIncoming(user: CurrentUser) {
  assertCan(user, "expenses.write");
  const { client } = await nesClient();
  let created = 0;
  let updated = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await client.incomingInvoices(page, 100);
    for (const d of r.data ?? []) {
      const s = d.accountingSupplierParty ?? {};
      const title = s.partyName || [s.firstName, s.familyName].filter(Boolean).join(" ") || "Bilinmeyen gönderici";
      const kdv = (d.taxes ?? []).filter((t) => t.taxTypeCode === "0015");
      const data = {
        documentNumber: d.documentNumber ?? null,
        issueDate: new Date(d.issueDate.slice(0, 10)),
        senderTaxNumber: s.partyIdentification ?? null,
        senderTitle: title.slice(0, 250),
        profile: d.profileId ?? null,
        typeCode: d.invoiceTypeCode ?? null,
        currency: d.documentCurrencyCode || "TRY",
        payableAmount: D(d.payableAmount).toFixed(2),
        taxTotal: kdv.reduce((a, t) => a.plus(D(t.taxAmount)), new Decimal(0)).toFixed(2),
        taxExclusive: kdv.reduce((a, t) => a.plus(D(t.taxableAmount)), new Decimal(0)).toFixed(2),
        answer: d.documentAnswer ?? null,
        receivedAt: new Date(d.createdAt),
      };
      const existing = await db.incomingInvoice.findUnique({ where: { uuid: d.id }, select: { id: true } });
      if (existing) {
        await db.incomingInvoice.update({ where: { id: existing.id }, data: { answer: data.answer, syncedAt: new Date() } });
        updated++;
      } else {
        await db.incomingInvoice.create({ data: { uuid: d.id, ...data } });
        created++;
      }
    }
    if (!r.data || r.data.length < 100 || page * 100 >= r.totalCount) break;
  }
  await audit({ userId: user.id, action: "incoming.synced", metadata: { created, updated } });
  return { created, updated };
}

export async function listIncoming(user: CurrentUser, f: { q?: string; status?: IncomingStatus; page?: number } = {}) {
  assertCan(user, "expenses.read");
  const where: Prisma.IncomingInvoiceWhereInput = {};
  if (f.status) where.status = f.status;
  if (f.q?.trim()) {
    const q = f.q.trim();
    where.OR = [{ senderTitle: { contains: q, mode: "insensitive" } }, { documentNumber: { contains: q, mode: "insensitive" } }, { senderTaxNumber: { contains: q } }];
  }
  const page = Math.max(1, f.page ?? 1);
  const [rows, total, lastSync] = await Promise.all([
    db.incomingInvoice.findMany({ where, orderBy: [{ issueDate: "desc" }, { receivedAt: "desc" }], take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    db.incomingInvoice.count({ where }),
    db.incomingInvoice.aggregate({ _max: { syncedAt: true } }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), lastSync: lastSync._max.syncedAt };
}

export const answerSchema = z.object({ answer: z.enum(["KABUL", "RED"]), note: z.string().trim().max(500).optional().transform((v) => v || null) });

/** Ticari faturaya kabul / red (yasal süre 8 gün; süreyi NES denetler) */
export async function answerIncoming(user: CurrentUser, id: string, input: z.infer<typeof answerSchema>) {
  assertCan(user, "expenses.write");
  const inc = await db.incomingInvoice.findUnique({ where: { id } });
  if (!inc) throw new AppError("NOT_FOUND", "Fatura bulunamadı.");
  if (inc.profile !== "TICARIFATURA") throw new AppError("VALIDATION", "Yalnızca ticari faturalara kabul / red yanıtı verilir.");
  if (inc.answer === "Accepted" || inc.answer === "Rejected") throw new AppError("CONFLICT", "Bu faturaya daha önce yanıt verilmiş.");
  if (input.answer === "RED" && !input.note) throw new AppError("VALIDATION", "Ret gerekçesi yazın.", { note: "Gerekli" });
  if (input.answer === "RED" && inc.status === "PROCESSED") throw new AppError("CONFLICT", "Gidere işlenmiş fatura reddedilemez; önce alış faturasını silin.");
  const { client } = await nesClient();
  const r = await client.answerIncoming(inc.uuid, input.answer, input.note);
  const answer = r?.documentAnswer && r.documentAnswer !== "None" ? r.documentAnswer : input.answer === "KABUL" ? "Accepted" : "Rejected";
  await db.incomingInvoice.update({ where: { id }, data: { answer, ...(input.answer === "RED" ? { status: "IGNORED" as const } : {}) } });
  await audit({ userId: user.id, action: "incoming.answered", entityType: "IncomingInvoice", entityId: id, metadata: { answer: input.answer } });
}

export const processSchema = z.object({
  categoryId: z.string().optional().transform((v) => v || null),
  stockMode: z.enum(["WITH_INVOICE", "NONE"]).default("WITH_INVOICE"),
});

/**
 * "Gidere işle": XML'den alış faturası oluşturur. Tedarikçi VKN ile bulunur, yoksa açılır.
 * Kayıt önce atomik sahiplenilir (çift işleme olmaz); hata olursa geri bırakılır.
 */
export async function processIncoming(user: CurrentUser, id: string, opts: z.infer<typeof processSchema>) {
  assertCan(user, "expenses.write");
  const claimed = await db.incomingInvoice.updateMany({ where: { id, status: "NEW" }, data: { status: "PROCESSED" } });
  if (!claimed.count) throw new AppError("CONFLICT", "Bu fatura zaten işlenmiş veya yok sayılmış.");
  try {
    const inc = await db.incomingInvoice.findUniqueOrThrow({ where: { id } });
    const { client } = await nesClient();
    const ubl = parseIncomingUbl(await client.incomingXml(inc.uuid));
    if (!(CURRENCIES as readonly string[]).includes(ubl.currency)) throw new AppError("VALIDATION", `${ubl.currency} para birimi desteklenmiyor.`);
    const bad = ubl.lines.find((l) => !(VAT_RATES as readonly number[]).includes(l.vatRate));
    if (bad) throw new AppError("VALIDATION", `"${bad.name}" satırında KDV %${bad.vatRate}; uygulamada tanımlı değil. Faturayı elle girin.`);

    // Tedarikçi: VKN ile, yoksa XML'deki bilgilerle yeni
    const taxNumber = ubl.supplier.taxNumber ?? inc.senderTaxNumber;
    let supplier = taxNumber ? await db.contact.findFirst({ where: { kind: "SUPPLIER", taxNumber }, select: { id: true, currency: true } }) : null;
    if (!supplier) {
      supplier = await db.contact.create({
        data: {
          kind: "SUPPLIER", personType: taxNumber?.length === 11 ? "NATURAL" : "LEGAL", title: ubl.supplier.title || inc.senderTitle, taxNumber,
          taxOffice: ubl.supplier.taxOffice, address: ubl.supplier.address, district: ubl.supplier.district, city: ubl.supplier.city,
          email: ubl.supplier.email, phone: ubl.supplier.phone, currency: ubl.currency, eInvoiceCheckedAt: new Date(),
        },
        select: { id: true, currency: true },
      });
    }
    if (supplier.currency !== ubl.currency) throw new AppError("VALIDATION", `Tedarikçi ${supplier.currency} ile izleniyor, fatura ${ubl.currency}. Tedarikçinin dövizini düzeltin.`);

    // Ürün eşleştirme: yalnızca ad birebir aynıysa (yanlış ürüne stok yazılmasın)
    const products = await db.product.findMany({ where: { isArchived: false }, select: { id: true, name: true } });
    const byName = new Map(products.map((p) => [p.name.toLocaleLowerCase("tr"), p.id]));
    const lines: ParsedLine[] = ubl.lines.map((l) => ({
      productId: byName.get(l.name.toLocaleLowerCase("tr")) ?? null,
      name: l.name.slice(0, 250),
      description: null,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      discountType: l.discountAmount ? "AMOUNT" : null,
      discountValue: l.discountAmount,
      vatRate: l.vatRate,
      vatExemptionCode: l.vatExemptionCode,
      otvRate: l.otvRate,
      otvCode: l.otvCode,
      withholdingRate: l.withholdingRate,
      withholdingCode: l.withholdingCode,
    }));
    const isReturn = ubl.typeCode === "IADE" || ubl.typeCode === "TEVKIFATIADE";
    const header = documentHeaderSchema.parse({
      contactId: supplier.id, docNo: inc.documentNumber ?? ubl.id, issueDate: ubl.issueDate || inc.issueDate.toISOString().slice(0, 10),
      currency: ubl.currency, exchangeRate: ubl.exchangeRate ?? undefined, categoryId: opts.categoryId ?? undefined, notes: ubl.notes.join("\n") || undefined,
      stockMode: opts.stockMode, kind: isReturn ? "RETURN" : "INVOICE",
    });
    const invoiceId = await saveInvoice(user, null, { direction: "PURCHASE", header, lines, discount: { discountType: null, discountValue: null }, tagIds: [] });
    await db.incomingInvoice.update({ where: { id }, data: { purchaseInvoiceId: invoiceId } });

    // Bizim hesap faturadaki tutarla tutmuyorsa kullanıcı uyarılır (yuvarlama farkı tedarikçinin hesabından)
    const saved = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { payableTotal: true } });
    const diff = D(saved.payableTotal.toString()).minus(ubl.payableAmount).abs();
    const warnings = [...ubl.warnings, ...(diff.greaterThan("0.05") ? [`Hesaplanan tutar faturadakinden ${diff.toFixed(2)} ${ubl.currency} farklı; satırları kontrol edin.`] : [])];
    await audit({ userId: user.id, action: "incoming.processed", entityType: "IncomingInvoice", entityId: id, metadata: { invoiceId, warnings } });
    return { invoiceId, warnings };
  } catch (err) {
    await db.incomingInvoice.update({ where: { id }, data: { status: "NEW", purchaseInvoiceId: null } });
    throw err;
  }
}

export async function setIncomingIgnored(user: CurrentUser, id: string, ignored: boolean) {
  assertCan(user, "expenses.write");
  const res = await db.incomingInvoice.updateMany({ where: { id, status: ignored ? "NEW" : "IGNORED" }, data: { status: ignored ? "IGNORED" : "NEW" } });
  if (!res.count) throw new AppError("CONFLICT", "Bu fatura için işlem yapılamaz (işlenmiş olabilir).");
  await audit({ userId: user.id, action: ignored ? "incoming.ignored" : "incoming.unignored", entityType: "IncomingInvoice", entityId: id });
}

/** Gelen faturanın NES görüntüsü */
export async function incomingDocument(user: CurrentUser, id: string, format: "pdf" | "html") {
  assertCan(user, "expenses.read");
  const inc = await db.incomingInvoice.findUnique({ where: { id }, select: { uuid: true, documentNumber: true } });
  if (!inc) throw new AppError("NOT_FOUND", "Fatura bulunamadı.");
  const { client } = await nesClient();
  return { res: await client.document("einvoice", inc.uuid, format, "incoming"), fileName: `${inc.documentNumber ?? inc.uuid}.${format}` };
}
