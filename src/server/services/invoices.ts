import "server-only";
import Decimal from "decimal.js";
import type { z } from "zod";
import type { InvoiceDirection } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan, type Permission } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { calculateDocument } from "@/lib/invoice-calc";
import { parseMoneyInput } from "@/lib/money";
import type { documentHeaderSchema, ParsedLine } from "@/lib/document-form";
import { invoicePaid, invoiceSign } from "./ledger";
import { isLockedEDoc, isVoidEDoc } from "@/lib/edoc-status";
import { applyMoves, resolveWarehouse, revertMoves } from "./stock";

export const PAGE_SIZE = 25;
const D = (v: { toString(): string } | null | undefined) => new Decimal(v?.toString() ?? 0);

const perms = (direction: InvoiceDirection): { read: Permission; write: Permission } =>
  direction === "SALE" ? { read: "sales.read", write: "sales.write" } : { read: "expenses.read", write: "expenses.write" };

/** Gönderilmiş / resmileşmiş / reddedilmiş / iptal edilmiş e-belge değiştirilemez (bkz. edoc-status) */
const isLocked = isLockedEDoc;
/** Silinebilir: hiç gönderilmemiş, hatalı ya da hukuki etkisi kalmamış (ret / iptal) */
const isDeletable = (s: string) => s === "NONE" || s === "FAILED" || isVoidEDoc(s);

export type PaymentFilter = "open" | "overdue" | "paid";

export interface InvoiceFilter {
  q?: string;
  payment?: PaymentFilter;
  from?: string;
  to?: string;
  contactId?: string;
  page?: number;
  /** Dışa aktarma: sayfalama yok */
  all?: boolean;
}

export async function listInvoices(user: CurrentUser, direction: InvoiceDirection, f: InvoiceFilter = {}) {
  assertCan(user, perms(direction).read);
  const where: Prisma.InvoiceWhereInput = { direction };
  if (f.contactId) where.contactId = f.contactId;
  if (f.from || f.to) where.issueDate = { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(f.to) } : {}) };
  if (f.q?.trim()) {
    const q = f.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { invoiceNo: { contains: q, mode: "insensitive" } },
      { contact: { title: { contains: q, mode: "insensitive" } } },
      { contact: { shortName: { contains: q, mode: "insensitive" } } },
    ];
  }
  const all = await db.invoice.findMany({
    where,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true, name: true, invoiceNo: true, kind: true, issueDate: true, dueDate: true, currency: true, payableTotal: true, grandTotal: true, eDocStatus: true, eDocProfile: true,
      contact: { select: { id: true, title: true, shortName: true } },
      category: { select: { name: true, color: true } },
    },
  });
  const paid = await invoicePaid(all.map((i) => i.id));
  const today = startOfToday();
  const rows = all
    .map((i) => {
      // Reddedilen / iptal edilen faturadan alacak kalmaz
      const remaining = isVoidEDoc(i.eDocStatus) ? new Decimal(0) : D(i.payableTotal).minus(paid.get(i.id)!);
      return { ...i, paid: paid.get(i.id)!, remaining, overdue: remaining.greaterThan(0) && i.dueDate < today };
    })
    .filter((i) => (f.payment === "paid" ? !i.remaining.greaterThan(0) : f.payment === "open" ? i.remaining.greaterThan(0) : f.payment === "overdue" ? i.overdue : true));
  const page = Math.max(1, f.page ?? 1);
  // Toplamlar TL dışı faturaları ayrı para biriminde tutar
  const sumBy = (pick: (r: (typeof rows)[number]) => Decimal) => {
    const m = new Map<string, Decimal>();
    for (const r of rows) m.set(r.currency, (m.get(r.currency) ?? new Decimal(0)).plus(pick(r).times(r.kind === "RETURN" ? -1 : 1)));
    return [...m].map(([currency, total]) => ({ currency, total }));
  };
  return {
    rows: f.all ? rows : rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: rows.length,
    page,
    pages: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    totals: { payable: sumBy((r) => D(r.payableTotal)), remaining: sumBy((r) => r.remaining) },
  };
}

export function startOfToday() {
  // Türkiye saatine göre bugün (vade karşılaştırması @db.Date ile UTC gece yarısı)
  const s = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
  return new Date(`${s}T00:00:00Z`);
}

export async function getInvoice(user: CurrentUser, id: string) {
  const inv = await db.invoice.findUnique({
    where: { id },
    include: {
      contact: true,
      category: true,
      lines: { orderBy: { position: "asc" } },
      tags: { include: { tag: true } },
      transactions: { orderBy: { date: "asc" }, include: { account: { select: { id: true, name: true, currency: true } }, cheque: { select: { id: true, chequeNo: true } } } },
      waybills: { select: { id: true, waybillNo: true, dispatchDate: true } },
      warehouse: { select: { id: true, name: true } },
      quote: { select: { id: true, quoteNo: true } },
      recurring: { select: { templateId: true } },
    },
  });
  if (!inv) throw new AppError("NOT_FOUND", "Fatura bulunamadı.");
  assertCan(user, perms(inv.direction).read);
  const paid = inv.transactions.reduce((a, t) => a.plus(D(t.appliedAmount)), new Decimal(0));
  const remaining = isVoidEDoc(inv.eDocStatus) ? new Decimal(0) : D(inv.payableTotal).minus(paid);
  return { ...inv, paid, remaining, deletable: isDeletable(inv.eDocStatus), overdue: remaining.greaterThan(0) && inv.dueDate < startOfToday(), locked: isLocked(inv.eDocStatus) };
}

export interface SaveInvoiceInput {
  direction: InvoiceDirection;
  header: z.infer<typeof documentHeaderSchema>;
  lines: ParsedLine[];
  discount: { discountType: "PERCENT" | "AMOUNT" | null; discountValue: string | null };
  tagIds: string[];
  quoteId?: string | null;
}

/** Stok yönü: satış faturası ve alış iadesi çıkış (−), satış iadesi ve alış faturası giriş (+) */
const stockSign = (direction: InvoiceDirection, kind: "INVOICE" | "RETURN") => -invoiceSign(direction, kind) as 1 | -1;

export async function saveInvoice(user: CurrentUser, id: string | null, input: SaveInvoiceInput) {
  const { direction, header, lines } = input;
  assertCan(user, perms(direction).write);
  if (lines.length === 0) throw new AppError("VALIDATION", "En az bir hizmet / ürün satırı ekleyin.");

  const contact = await db.contact.findUnique({ where: { id: header.contactId }, select: { id: true, kind: true, currency: true, isArchived: true } });
  if (!contact) throw new AppError("VALIDATION", "Müşteri bulunamadı.", { contactId: "Seçin" });
  const expectedKind = direction === "SALE" ? "CUSTOMER" : "SUPPLIER";
  if (contact.kind !== expectedKind) throw new AppError("VALIDATION", direction === "SALE" ? "Satış faturası yalnızca müşteriye kesilir." : "Alış faturası yalnızca tedarikçiden girilir.", { contactId: "Geçersiz" });
  // Faz 2 kuralı: belge cari ile aynı para biriminde (bakiye tek dövizde tutulur)
  if (header.currency !== contact.currency) {
    throw new AppError("VALIDATION", `Bu cari ${contact.currency} ile izleniyor; fatura da ${contact.currency} olmalı.`, { currency: `Cari dövizi ${contact.currency}` });
  }
  let exchangeRate = new Decimal(1);
  if (header.currency !== "TRY") {
    const r = header.exchangeRate ? parseMoneyInput(header.exchangeRate) : null;
    if (!r || r.lessThanOrEqualTo(0)) throw new AppError("VALIDATION", "Döviz kurunu girin.", { exchangeRate: "Kur gerekli" });
    exchangeRate = r;
  }
  if (header.categoryId) {
    const c = await db.category.findUnique({ where: { id: header.categoryId }, select: { type: true } });
    if (!c || c.type !== (direction === "SALE" ? "SALES" : "EXPENSE")) throw new AppError("VALIDATION", "Kategori geçersiz.", { categoryId: "Geçersiz" });
  }
  const productIds = [...new Set(lines.map((l) => l.productId).filter((p): p is string => Boolean(p)))];
  const products = productIds.length ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, trackStock: true } }) : [];
  if (products.length !== productIds.length) throw new AppError("VALIDATION", "Satırdaki ürünlerden biri bulunamadı (silinmiş olabilir).");
  const tracked = new Set(products.filter((p) => p.trackStock).map((p) => p.id));
  const tagIds = [...new Set(input.tagIds)].slice(0, 20);

  // İrsaliyeden fatura: stok irsaliyede hareket etti → faturada stok hareketi yok
  let waybill: { id: string; warehouseId: string } | null = null;
  if (header.waybillId && !id) {
    const w = await db.waybill.findUnique({ where: { id: header.waybillId }, select: { id: true, direction: true, contactId: true, invoiceId: true, warehouseId: true } });
    if (!w || w.direction !== direction) throw new AppError("VALIDATION", "İrsaliye bulunamadı.");
    if (w.invoiceId) throw new AppError("CONFLICT", "Bu irsaliye zaten faturalanmış.");
    if (w.contactId !== contact.id) throw new AppError("VALIDATION", "Fatura, irsaliyedeki cariye kesilmeli.", { contactId: "İrsaliyedeki cari" });
    waybill = { id: w.id, warehouseId: w.warehouseId };
  }
  const stockMode = waybill ? "NONE" : header.stockMode;

  const calc = calculateDocument(lines, input.discount);
  const t = calc.totals;
  const data = {
    direction,
    kind: header.kind,
    name: header.name,
    invoiceNo: header.docNo,
    contactId: contact.id,
    issueDate: new Date(header.issueDate),
    dueDate: new Date(header.dueDate ?? header.issueDate),
    currency: header.currency,
    exchangeRate: exchangeRate.toString(),
    categoryId: header.categoryId,
    notes: header.notes,
    orderNo: header.orderNo,
    orderDate: header.orderDate ? new Date(header.orderDate) : null,
    stockMode,
    returnRefNo: header.kind === "RETURN" ? header.returnRefNo : null,
    returnRefDate: header.kind === "RETURN" && header.returnRefDate ? new Date(header.returnRefDate) : null,
    discountType: input.discount.discountType,
    discountValue: input.discount.discountValue,
    grossTotal: t.grossTotal.toString(),
    discountTotal: t.discountTotal.toString(),
    netTotal: t.netTotal.toString(),
    otvTotal: t.otvTotal.toString(),
    vatTotal: t.vatTotal.toString(),
    withholdingTotal: t.withholdingTotal.toString(),
    grandTotal: t.grandTotal.toString(),
    payableTotal: t.payableTotal.toString(),
  };
  const lineData = lines.map((l, i) => ({
    position: i + 1,
    productId: l.productId,
    name: l.name,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    unitPrice: l.unitPrice,
    discountType: l.discountType,
    discountValue: l.discountValue,
    vatRate: l.vatRate,
    otvRate: l.otvRate,
    otvCode: l.otvCode,
    vatExemptionCode: l.vatExemptionCode,
    withholdingCode: l.withholdingCode,
    withholdingRate: l.withholdingRate,
    grossAmount: calc.lines[i]!.grossAmount.toString(),
    discountAmount: calc.lines[i]!.discountAmount.toString(),
    netAmount: calc.lines[i]!.netAmount.toString(),
    otvAmount: calc.lines[i]!.otvAmount.toString(),
    vatAmount: calc.lines[i]!.vatAmount.toString(),
    withholdingAmount: calc.lines[i]!.withholdingAmount.toString(),
    totalAmount: calc.lines[i]!.totalAmount.toString(),
  }));

  const saved = await db.$transaction(async (tx) => {
    const warehouseId = waybill ? waybill.warehouseId : await resolveWarehouse(tx, header.warehouseId);
    let invoiceId = id;
    if (id) {
      const existing = await tx.invoice.findUnique({ where: { id }, select: { direction: true, eDocStatus: true, transactions: { select: { appliedAmount: true } } } });
      if (!existing || existing.direction !== direction) throw new AppError("NOT_FOUND", "Fatura bulunamadı.");
      if (isLocked(existing.eDocStatus)) throw new AppError("CONFLICT", "Gönderilmiş / resmileşmiş fatura değiştirilemez. Gerekirse iade faturası kesin.");
      const paid = existing.transactions.reduce((a, x) => a.plus(D(x.appliedAmount)), new Decimal(0));
      if (t.payableTotal.lessThan(paid)) throw new AppError("VALIDATION", "Fatura tutarı, yapılmış tahsilat / ödemelerin altına düşemez. Önce tahsilatı düzeltin.");
      await revertMoves(tx, { invoiceId: id });
      await tx.documentLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceTag.deleteMany({ where: { invoiceId: id } });
      // Hatalı gönderilmiş fatura düzeltildi: içerik değiştiği için bir sonraki gönderim yeni UUID ile yapılır
      const eDocReset = existing.eDocStatus === "FAILED" ? { eDocStatus: "NONE" as const, eDocUuid: null, eDocError: null } : {};
      await tx.invoice.update({ where: { id }, data: { ...data, warehouseId, ...eDocReset, lines: { create: lineData }, tags: { create: tagIds.map((tagId) => ({ tagId })) } } });
    } else {
      const inv = await tx.invoice.create({ data: { ...data, warehouseId, createdById: user.id, quoteId: input.quoteId ?? null, lines: { create: lineData }, tags: { create: tagIds.map((tagId) => ({ tagId })) } } });
      invoiceId = inv.id;
      if (waybill) await tx.waybill.update({ where: { id: waybill.id }, data: { invoiceId: inv.id } });
    }
    // Stok hareketleri (yalnızca stok takipli ürünler, "fatura ile" seçiliyse)
    if (stockMode === "WITH_INVOICE") {
      const sign = stockSign(direction, header.kind);
      await applyMoves(
        tx,
        lines
          .filter((l) => l.productId && tracked.has(l.productId))
          .map((l) => ({ productId: l.productId!, warehouseId, quantity: new Decimal(l.quantity).times(sign), date: data.issueDate, source: "INVOICE" as const, invoiceId: invoiceId!, createdById: user.id })),
      );
    }
    return invoiceId!;
  });

  await audit({ userId: user.id, action: id ? "invoice.updated" : "invoice.created", entityType: "Invoice", entityId: saved, metadata: { direction, total: t.payableTotal.toString(), currency: header.currency } });
  return saved;
}

export async function deleteInvoice(user: CurrentUser, id: string) {
  const inv = await db.invoice.findUnique({ where: { id }, select: { direction: true, eDocStatus: true, _count: { select: { transactions: true } } } });
  if (!inv) throw new AppError("NOT_FOUND", "Fatura bulunamadı.");
  assertCan(user, perms(inv.direction).write);
  if (!isDeletable(inv.eDocStatus)) throw new AppError("CONFLICT", "Gönderilmiş / resmileşmiş fatura silinemez. Gerekirse iade faturası kesin veya e-Arşiv'i iptal edin.");
  if (inv._count.transactions > 0) throw new AppError("CONFLICT", "Bu faturaya bağlı tahsilat / ödeme var. Önce onları silin.");
  await db.$transaction(async (tx) => {
    await revertMoves(tx, { invoiceId: id });
    // Gelen e-faturadan oluşturulduysa, gelen fatura yeniden işlenebilir hale gelir
    await tx.incomingInvoice.updateMany({ where: { purchaseInvoiceId: id }, data: { status: "NEW", purchaseInvoiceId: null } });
    await tx.invoice.delete({ where: { id } });
  });
  await audit({ userId: user.id, action: "invoice.deleted", entityType: "Invoice", entityId: id });
  return inv.direction;
}
