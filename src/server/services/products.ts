import "server-only";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { isUniqueViolation } from "@/server/prisma-errors";
import type { productSchema } from "@/lib/validation";
import Decimal from "decimal.js";
import { syncOpeningMove } from "./stock";

export const PAGE_SIZE = 25;

export async function listProducts(user: CurrentUser, f: { q?: string; archived?: boolean; categoryId?: string; critical?: boolean; page?: number } = {}) {
  assertCan(user, "stock.read");
  const where: Prisma.ProductWhereInput = { isArchived: Boolean(f.archived) };
  if (f.categoryId) where.categoryId = f.categoryId;
  if (f.q?.trim()) {
    const q = f.q.trim();
    where.OR = [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { barcode: { contains: q } }];
  }
  const page = Math.max(1, f.page ?? 1);
  const all = await db.product.findMany({
    where,
    orderBy: { name: "asc" },
    include: { category: { select: { name: true, color: true } } },
  });
  // Kritik stok filtresi iki sütunu karşılaştırır (Prisma'da sütun-sütun koşulu yok) → bellekte
  const filtered = f.critical ? all.filter((p) => p.trackStock && p.criticalStock !== null && p.stockQuantity.lessThanOrEqualTo(p.criticalStock)) : all;
  const total = filtered.length;
  return { rows: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getProduct(user: CurrentUser, id: string) {
  assertCan(user, "stock.read");
  const p = await db.product.findUnique({ where: { id }, include: { category: true } });
  if (!p) throw new AppError("NOT_FOUND", "Ürün bulunamadı.");
  return p;
}

type ProductInput = z.infer<typeof productSchema>;

async function assertCategory(categoryId: string | null) {
  if (!categoryId) return;
  const c = await db.category.findUnique({ where: { id: categoryId }, select: { type: true } });
  if (!c || c.type !== "PRODUCT") throw new AppError("VALIDATION", "Kategori geçersiz.", { categoryId: "Geçersiz kategori" });
}

function toData(input: ProductInput) {
  const { trackStock, initialStock, criticalEnabled, criticalStock, ...rest } = input;
  return {
    ...rest,
    trackStock: trackStock === "yes",
    criticalStock: trackStock === "yes" && criticalEnabled ? criticalStock : null,
    initialStock: trackStock === "yes" ? (initialStock ?? "0") : "0",
  };
}

const codeConflict = () => new AppError("CONFLICT", "Bu ürün / stok kodu başka bir üründe kullanılıyor.", { code: "Kod kullanımda" });

export async function createProduct(user: CurrentUser, input: ProductInput) {
  assertCan(user, "stock.write");
  await assertCategory(input.categoryId);
  const data = toData(input);
  try {
    // Yeni üründe güncel stok = başlangıç stoku (varsayılan depoya "açılış" hareketi)
    const p = await db.$transaction(async (tx) => {
      const created = await tx.product.create({ data: { ...data, stockQuantity: data.initialStock } });
      await syncOpeningMove(tx, created.id, new Decimal(data.initialStock), created.createdAt);
      return created;
    });
    await audit({ userId: user.id, action: "product.created", entityType: "Product", entityId: p.id });
    return p;
  } catch (err) {
    if (isUniqueViolation(err)) throw codeConflict();
    throw err;
  }
}

export async function updateProduct(user: CurrentUser, id: string, input: ProductInput) {
  assertCan(user, "stock.write");
  await assertCategory(input.categoryId);
  const existing = await db.product.findUnique({ where: { id }, select: { initialStock: true, stockQuantity: true, createdAt: true } });
  if (!existing) throw new AppError("NOT_FOUND", "Ürün bulunamadı.");
  const data = toData(input);
  // Başlangıç stoku değişirse fark güncel stoğa ve açılış hareketine yansır (diğer hareketler korunur)
  const delta = new Decimal(data.initialStock).minus(existing.initialStock.toString());
  try {
    const p = await db.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id }, data: { ...data, stockQuantity: { increment: delta.toString() } } });
      await syncOpeningMove(tx, id, new Decimal(data.initialStock), existing.createdAt);
      return updated;
    });
    await audit({ userId: user.id, action: "product.updated", entityType: "Product", entityId: id });
    return p;
  } catch (err) {
    if (isUniqueViolation(err)) throw codeConflict();
    throw err;
  }
}

export async function setProductArchived(user: CurrentUser, id: string, archived: boolean) {
  assertCan(user, "stock.write");
  const res = await db.product.updateMany({ where: { id }, data: { isArchived: archived } });
  if (!res.count) throw new AppError("NOT_FOUND", "Ürün bulunamadı.");
  await audit({ userId: user.id, action: archived ? "product.archived" : "product.unarchived", entityType: "Product", entityId: id });
}
