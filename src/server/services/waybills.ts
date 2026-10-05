import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { InvoiceDirection } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan, type Permission } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { parseMoneyInput } from "@/lib/money";
import { isUnitCode } from "@/lib/units";
import { optText } from "@/lib/validation";
import { applyMoves, resolveWarehouse, revertMoves } from "./stock";

/** İrsaliye: giden (SALE, stok çıkışı) / gelen (PURCHASE, stok girişi). Faturalanan irsaliye değiştirilemez. */

export const WAYBILLS_PAGE_SIZE = 25;
const date = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);

const perms = (direction: InvoiceDirection): { read: Permission; write: Permission } =>
  direction === "SALE" ? { read: "sales.read", write: "sales.write" } : { read: "expenses.read", write: "expenses.write" };

export const waybillHeaderSchema = z.object({
  contactId: z.string().min(1, "Cari seçin."),
  warehouseId: optText(50),
  waybillNo: optText(40),
  issueDate: date("Düzenleme tarihini girin."),
  dispatchDate: date("Sevk tarihini girin."),
  deliveryAddress: optText(500),
  notes: optText(1000),
});

export interface WaybillLineInput { productId: string | null; name: string; quantity: string; unit: string }

/** line_productId[] / line_name[] / line_qty[] / line_unit[]; boş satırlar atlanır */
export function parseWaybillLines(fd: FormData): { lines: WaybillLineInput[]; error: string | null } {
  const col = (k: string) => fd.getAll(`line_${k}`).map(String);
  const names = col("name");
  const ids = col("productId");
  const qtys = col("qty");
  const units = col("unit");
  const lines: WaybillLineInput[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!.trim();
    const raw = qtys[i]?.trim() ?? "";
    if (!name && (!raw || raw === "1")) continue;
    if (!name) return { lines: [], error: `${i + 1}. satırda ürün / hizmet adını girin.` };
    const q = parseMoneyInput(raw || "1");
    if (!q || !q.greaterThan(0)) return { lines: [], error: `${i + 1}. satırda geçerli bir miktar girin.` };
    const unit = units[i] && isUnitCode(units[i]!) ? units[i]! : "C62";
    lines.push({ productId: ids[i]?.trim() || null, name: name.slice(0, 250), quantity: q.toString(), unit });
  }
  return { lines, error: null };
}

/** Giden irsaliye stok çıkışı (−), gelen irsaliye stok girişi (+) */
const sign = (direction: InvoiceDirection) => (direction === "SALE" ? -1 : 1);

export async function saveWaybill(user: CurrentUser, direction: InvoiceDirection, id: string | null, header: z.infer<typeof waybillHeaderSchema>, lines: WaybillLineInput[]) {
  assertCan(user, perms(direction).write);
  assertCan(user, "stock.write");
  if (!lines.length) throw new AppError("VALIDATION", "En az bir ürün satırı ekleyin.");
  if (header.dispatchDate < header.issueDate) throw new AppError("VALIDATION", "Sevk tarihi düzenleme tarihinden önce olamaz.", { dispatchDate: "Tarih geçersiz" });
  const contact = await db.contact.findUnique({ where: { id: header.contactId }, select: { id: true, kind: true } });
  if (!contact || contact.kind !== (direction === "SALE" ? "CUSTOMER" : "SUPPLIER")) throw new AppError("VALIDATION", direction === "SALE" ? "Müşteri seçin." : "Tedarikçi seçin.", { contactId: "Seçin" });
  const productIds = [...new Set(lines.map((l) => l.productId).filter((p): p is string => Boolean(p)))];
  const products = productIds.length ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, trackStock: true } }) : [];
  if (products.length !== productIds.length) throw new AppError("VALIDATION", "Satırdaki ürünlerden biri bulunamadı.");
  const tracked = new Set(products.filter((p) => p.trackStock).map((p) => p.id));

  const saved = await db.$transaction(async (tx) => {
    const warehouseId = await resolveWarehouse(tx, header.warehouseId);
    const data = {
      direction, contactId: contact.id, warehouseId, waybillNo: header.waybillNo, issueDate: new Date(header.issueDate), dispatchDate: new Date(header.dispatchDate),
      deliveryAddress: header.deliveryAddress, notes: header.notes,
    };
    const lineData = lines.map((l, i) => ({ position: i + 1, productId: l.productId, name: l.name, quantity: l.quantity, unit: l.unit }));
    let wid = id;
    if (id) {
      const existing = await tx.waybill.findUnique({ where: { id }, select: { direction: true, invoiceId: true } });
      if (!existing || existing.direction !== direction) throw new AppError("NOT_FOUND", "İrsaliye bulunamadı.");
      if (existing.invoiceId) throw new AppError("CONFLICT", "Faturalanmış irsaliye değiştirilemez.");
      await revertMoves(tx, { waybillId: id });
      await tx.waybillLine.deleteMany({ where: { waybillId: id } });
      await tx.waybill.update({ where: { id }, data: { ...data, lines: { create: lineData } } });
    } else {
      wid = (await tx.waybill.create({ data: { ...data, createdById: user.id, lines: { create: lineData } } })).id;
    }
    await applyMoves(
      tx,
      lines
        .filter((l) => l.productId && tracked.has(l.productId))
        .map((l) => ({ productId: l.productId!, warehouseId, quantity: new Decimal(l.quantity).times(sign(direction)), date: data.dispatchDate, source: "WAYBILL" as const, waybillId: wid!, createdById: user.id })),
    );
    return wid!;
  });
  await audit({ userId: user.id, action: id ? "waybill.updated" : "waybill.created", entityType: "Waybill", entityId: saved, metadata: { direction } });
  return saved;
}

export async function deleteWaybill(user: CurrentUser, id: string) {
  const w = await db.waybill.findUnique({ where: { id }, select: { direction: true, invoiceId: true } });
  if (!w) throw new AppError("NOT_FOUND", "İrsaliye bulunamadı.");
  assertCan(user, perms(w.direction).write);
  assertCan(user, "stock.write");
  if (w.invoiceId) throw new AppError("CONFLICT", "Faturalanmış irsaliye silinemez. Önce faturayı silin.");
  await db.$transaction(async (tx) => {
    await revertMoves(tx, { waybillId: id });
    await tx.waybill.delete({ where: { id } });
  });
  await audit({ userId: user.id, action: "waybill.deleted", entityType: "Waybill", entityId: id });
  return w.direction;
}

export async function listWaybills(user: CurrentUser, direction: InvoiceDirection, f: { q?: string; invoiced?: "yes" | "no"; page?: number } = {}) {
  assertCan(user, perms(direction).read);
  const where: Prisma.WaybillWhereInput = { direction };
  if (f.invoiced === "yes") where.invoiceId = { not: null };
  if (f.invoiced === "no") where.invoiceId = null;
  if (f.q?.trim()) {
    const q = f.q.trim();
    where.OR = [{ waybillNo: { contains: q, mode: "insensitive" } }, { contact: { title: { contains: q, mode: "insensitive" } } }, { lines: { some: { name: { contains: q, mode: "insensitive" } } } }];
  }
  const page = Math.max(1, f.page ?? 1);
  const [total, rows] = await Promise.all([
    db.waybill.count({ where }),
    db.waybill.findMany({
      where,
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * WAYBILLS_PAGE_SIZE,
      take: WAYBILLS_PAGE_SIZE,
      include: { contact: { select: { id: true, title: true } }, warehouse: { select: { name: true } }, invoice: { select: { id: true, invoiceNo: true } }, _count: { select: { lines: true } } },
    }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / WAYBILLS_PAGE_SIZE)) };
}

export async function getWaybill(user: CurrentUser, id: string) {
  const w = await db.waybill.findUnique({
    where: { id },
    include: {
      contact: true,
      warehouse: { select: { id: true, name: true } },
      invoice: { select: { id: true, invoiceNo: true, name: true } },
      lines: { orderBy: { position: "asc" }, include: { product: { select: { id: true, trackStock: true } } } },
    },
  });
  if (!w) throw new AppError("NOT_FOUND", "İrsaliye bulunamadı.");
  assertCan(user, perms(w.direction).read);
  return w;
}
