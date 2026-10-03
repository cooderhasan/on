import "server-only";
import type { z } from "zod";
import type { CategoryType } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { isUniqueViolation } from "@/server/prisma-errors";
import type { categorySchema, tagSchema } from "@/lib/validation";

export const CATEGORY_TYPE_LABELS: Record<CategoryType, string> = {
  SALES: "Gelir (satış) kategorileri",
  EXPENSE: "Gider kategorileri",
  CONTACT: "Müşteri / tedarikçi kategorileri",
  PRODUCT: "Hizmet / ürün kategorileri",
  EMPLOYEE: "Çalışan kategorileri",
};

export async function listCategories(type?: CategoryType) {
  return db.category.findMany({ where: type ? { type } : undefined, orderBy: [{ type: "asc" }, { name: "asc" }] });
}

export async function createCategory(user: CurrentUser, input: z.infer<typeof categorySchema>) {
  assertCan(user, "catalog.manage");
  try {
    const c = await db.category.create({ data: input });
    await audit({ userId: user.id, action: "category.created", entityType: "Category", entityId: c.id });
    return c;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("CONFLICT", "Bu adda bir kategori zaten var.", { name: "Aynı ad var" });
    throw err;
  }
}

/** Silinen kategori kayıtlardan kalkar (kayıtlar "kategorisiz" olur), kayıtlar silinmez. */
export async function deleteCategory(user: CurrentUser, id: string) {
  assertCan(user, "catalog.manage");
  const res = await db.category.deleteMany({ where: { id } });
  if (!res.count) throw new AppError("NOT_FOUND", "Kategori bulunamadı.");
  await audit({ userId: user.id, action: "category.deleted", entityType: "Category", entityId: id });
}

export async function listTags() {
  return db.tag.findMany({ orderBy: { name: "asc" } });
}

export async function createTag(user: CurrentUser, input: z.infer<typeof tagSchema>) {
  assertCan(user, "catalog.manage");
  try {
    return await db.tag.create({ data: input });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("CONFLICT", "Bu etiket zaten var.", { name: "Aynı ad var" });
    throw err;
  }
}

export async function deleteTag(user: CurrentUser, id: string) {
  assertCan(user, "catalog.manage");
  await db.tag.deleteMany({ where: { id } });
}
