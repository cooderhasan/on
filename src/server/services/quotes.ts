import "server-only";
import Decimal from "decimal.js";
import type { z } from "zod";
import type { QuoteStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { calculateDocument } from "@/lib/invoice-calc";
import { parseMoneyInput } from "@/lib/money";
import type { documentHeaderSchema, ParsedLine } from "@/lib/document-form";
import { saveInvoice, startOfToday } from "./invoices";

export const PAGE_SIZE = 25;

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  OPEN: "Açık",
  ACCEPTED: "Kabul edildi",
  REJECTED: "Reddedildi",
  INVOICED: "Faturalandı",
};

export async function listQuotes(user: CurrentUser, f: { q?: string; status?: QuoteStatus; page?: number } = {}) {
  assertCan(user, "sales.read");
  const where: Prisma.QuoteWhereInput = {};
  if (f.status) where.status = f.status;
  if (f.q?.trim()) {
    const q = f.q.trim();
    where.OR = [{ name: { contains: q, mode: "insensitive" } }, { quoteNo: { contains: q, mode: "insensitive" } }, { contact: { title: { contains: q, mode: "insensitive" } } }];
  }
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.quote.findMany({ where, orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }], take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE, include: { contact: { select: { title: true } } } }),
    db.quote.count({ where }),
  ]);
  const today = startOfToday();
  return { rows: rows.map((r) => ({ ...r, expired: r.status === "OPEN" && r.validUntil !== null && r.validUntil < today })), total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getQuote(user: CurrentUser, id: string) {
  assertCan(user, "sales.read");
  const q = await db.quote.findUnique({ where: { id }, include: { contact: true, lines: { orderBy: { position: "asc" } }, invoice: { select: { id: true, name: true } } } });
  if (!q) throw new AppError("NOT_FOUND", "Teklif bulunamadı.");
  return q;
}

export async function saveQuote(
  user: CurrentUser,
  id: string | null,
  input: { header: z.infer<typeof documentHeaderSchema>; validUntil: string | null; lines: ParsedLine[]; discount: { discountType: "PERCENT" | "AMOUNT" | null; discountValue: string | null } },
) {
  assertCan(user, "sales.write");
  const { header, lines } = input;
  if (lines.length === 0) throw new AppError("VALIDATION", "En az bir hizmet / ürün satırı ekleyin.");
  const contact = await db.contact.findUnique({ where: { id: header.contactId }, select: { kind: true, currency: true } });
  if (!contact || contact.kind !== "CUSTOMER") throw new AppError("VALIDATION", "Müşteri seçin.", { contactId: "Seçin" });
  if (header.currency !== contact.currency) throw new AppError("VALIDATION", `Bu müşteri ${contact.currency} ile izleniyor; teklif de ${contact.currency} olmalı.`, { currency: "Cari dövizi" });
  let rate = new Decimal(1);
  if (header.currency !== "TRY") {
    const r = header.exchangeRate ? parseMoneyInput(header.exchangeRate) : null;
    if (!r || r.lessThanOrEqualTo(0)) throw new AppError("VALIDATION", "Döviz kurunu girin.", { exchangeRate: "Kur gerekli" });
    rate = r;
  }
  if (input.validUntil && input.validUntil < header.issueDate) throw new AppError("VALIDATION", "Geçerlilik tarihi teklif tarihinden önce olamaz.", { validUntil: "Geçersiz" });
  const calc = calculateDocument(lines, input.discount);
  const t = calc.totals;
  const data = {
    quoteNo: header.docNo,
    name: header.name,
    contactId: header.contactId,
    issueDate: new Date(header.issueDate),
    validUntil: input.validUntil ? new Date(input.validUntil) : null,
    currency: header.currency,
    exchangeRate: rate.toString(),
    notes: header.notes,
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
    ...l,
    position: i + 1,
    grossAmount: calc.lines[i]!.grossAmount.toString(),
    discountAmount: calc.lines[i]!.discountAmount.toString(),
    netAmount: calc.lines[i]!.netAmount.toString(),
    otvAmount: calc.lines[i]!.otvAmount.toString(),
    vatAmount: calc.lines[i]!.vatAmount.toString(),
    withholdingAmount: calc.lines[i]!.withholdingAmount.toString(),
    totalAmount: calc.lines[i]!.totalAmount.toString(),
  }));
  const saved = await db.$transaction(async (tx) => {
    if (id) {
      const ex = await tx.quote.findUnique({ where: { id }, select: { status: true } });
      if (!ex) throw new AppError("NOT_FOUND", "Teklif bulunamadı.");
      if (ex.status === "INVOICED") throw new AppError("CONFLICT", "Faturalanmış teklif değiştirilemez.");
      await tx.documentLine.deleteMany({ where: { quoteId: id } });
      return tx.quote.update({ where: { id }, data: { ...data, lines: { create: lineData } } });
    }
    return tx.quote.create({ data: { ...data, createdById: user.id, lines: { create: lineData } } });
  });
  await audit({ userId: user.id, action: id ? "quote.updated" : "quote.created", entityType: "Quote", entityId: saved.id });
  return saved;
}

export async function setQuoteStatus(user: CurrentUser, id: string, status: "OPEN" | "ACCEPTED" | "REJECTED") {
  assertCan(user, "sales.write");
  const q = await db.quote.findUnique({ where: { id }, select: { status: true } });
  if (!q) throw new AppError("NOT_FOUND", "Teklif bulunamadı.");
  if (q.status === "INVOICED") throw new AppError("CONFLICT", "Faturalanmış teklifin durumu değiştirilemez.");
  await db.quote.update({ where: { id }, data: { status } });
  await audit({ userId: user.id, action: "quote.status", entityType: "Quote", entityId: id, metadata: { status } });
}

/** Tekliften satış faturası: satırlar birebir kopyalanır, teklif "faturalandı" olur. Fatura tarihi bugündür. */
export async function convertQuoteToInvoice(user: CurrentUser, id: string) {
  assertCan(user, "sales.write");
  const q = await db.quote.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } }, invoice: { select: { id: true } } } });
  if (!q) throw new AppError("NOT_FOUND", "Teklif bulunamadı.");
  if (q.invoice) throw new AppError("CONFLICT", "Bu tekliften zaten fatura oluşturulmuş.");
  const today = startOfToday().toISOString().slice(0, 10);
  const invoiceId = await saveInvoice(user, null, {
    direction: "SALE",
    quoteId: q.id,
    header: {
      contactId: q.contactId, name: q.name, docNo: null, issueDate: today, dueDate: today, currency: q.currency as "TRY",
      exchangeRate: q.exchangeRate.toString(), categoryId: null, notes: q.notes, orderNo: null, orderDate: null, stockMode: "WITH_INVOICE", kind: "INVOICE", returnRefNo: null, returnRefDate: null,
    },
    lines: q.lines.map((l) => ({
      productId: l.productId, name: l.name, description: l.description, quantity: l.quantity.toString(), unit: l.unit, unitPrice: l.unitPrice.toString(),
      discountType: l.discountType, discountValue: l.discountValue?.toString() ?? null, vatRate: l.vatRate, vatExemptionCode: l.vatExemptionCode, otvRate: l.otvRate?.toString() ?? null, otvCode: l.otvCode,
      withholdingRate: l.withholdingRate, withholdingCode: l.withholdingCode,
    })),
    discount: { discountType: q.discountType, discountValue: q.discountValue?.toString() ?? null },
    tagIds: [],
  });
  await db.quote.update({ where: { id }, data: { status: "INVOICED" } });
  return invoiceId;
}

export async function deleteQuote(user: CurrentUser, id: string) {
  assertCan(user, "sales.write");
  const q = await db.quote.findUnique({ where: { id }, select: { status: true } });
  if (!q) throw new AppError("NOT_FOUND", "Teklif bulunamadı.");
  await db.quote.delete({ where: { id } });
  await audit({ userId: user.id, action: "quote.deleted", entityType: "Quote", entityId: id });
}
