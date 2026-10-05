import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { UserRole } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import { hashPassword, PASSWORD_MIN, verifyPassword } from "@/server/auth/password";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { isUniqueViolation } from "@/server/prisma-errors";

/**
 * Kullanıcı kuralları:
 *  - Yalnızca yönetici kullanıcı ekler / değiştirir.
 *  - Her zaman en az bir aktif yönetici kalır (kendi rolünü düşüremez, kendini pasifleştiremez).
 *  - Pasifleştirme ve şifre sıfırlama o kullanıcının tüm oturumlarını kapatır.
 */

const ROLES = ["ADMIN", "ACCOUNTANT", "SALES", "VIEWER"] as const;
const password = z.string().min(PASSWORD_MIN, `Şifre en az ${PASSWORD_MIN} karakter olmalı.`).max(200);

export const userCreateSchema = z.object({
  name: z.string().trim().min(2, "Ad soyad girin.").max(100),
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin."),
  role: z.enum(ROLES, { message: "Rol seçin." }),
  password,
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2, "Ad soyad girin.").max(100),
  role: z.enum(ROLES, { message: "Rol seçin." }),
  isActive: z.enum(["1", "0"]).transform((v) => v === "1"),
});

export const passwordResetSchema = z.object({ password });

export const ownPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Mevcut şifrenizi girin."),
    password,
    passwordConfirm: z.string(),
  })
  .refine((v) => v.password === v.passwordConfirm, { message: "Şifreler aynı değil.", path: ["passwordConfirm"] });

const select = { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true } satisfies Prisma.UserSelect;

export async function listUsers(user: CurrentUser) {
  assertCan(user, "users.manage");
  const rows = await db.user.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], select: { ...select, _count: { select: { sessions: { where: { expiresAt: { gt: new Date() } } } } } } });
  return rows;
}

export async function getUser(user: CurrentUser, id: string) {
  assertCan(user, "users.manage");
  const u = await db.user.findUnique({ where: { id }, select });
  if (!u) throw new AppError("NOT_FOUND", "Kullanıcı bulunamadı.");
  return u;
}

export async function createUser(user: CurrentUser, input: z.infer<typeof userCreateSchema>) {
  assertCan(user, "users.manage");
  try {
    const u = await db.user.create({ data: { name: input.name, email: input.email, role: input.role, passwordHash: await hashPassword(input.password) }, select });
    await audit({ userId: user.id, action: "user.created", entityType: "User", entityId: u.id, metadata: { role: u.role } });
    return u;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("CONFLICT", "Bu e-posta ile kayıtlı bir kullanıcı var.", { email: "Kayıtlı" });
    throw err;
  }
}

/** Başka aktif yönetici var mı (bu kullanıcı hariç) */
async function otherActiveAdmins(tx: Prisma.TransactionClient, exceptId: string) {
  return tx.user.count({ where: { role: "ADMIN", isActive: true, id: { not: exceptId } } });
}

export async function updateUser(user: CurrentUser, id: string, input: z.infer<typeof userUpdateSchema>) {
  assertCan(user, "users.manage");
  const u = await db.$transaction(
    async (tx) => {
      const cur = await tx.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
      if (!cur) throw new AppError("NOT_FOUND", "Kullanıcı bulunamadı.");
      const losesAdmin = cur.role === "ADMIN" && cur.isActive && (input.role !== "ADMIN" || !input.isActive);
      if (losesAdmin && (await otherActiveAdmins(tx, id)) === 0) throw new AppError("CONFLICT", "En az bir aktif yönetici kalmalı.");
      if (id === user.id && (!input.isActive || input.role !== "ADMIN")) throw new AppError("CONFLICT", "Kendi rolünüzü düşüremez veya hesabınızı pasifleştiremezsiniz.");
      const updated = await tx.user.update({ where: { id }, data: input, select });
      // Pasifleşen kullanıcının açık oturumları hemen kapanır
      if (!input.isActive) await tx.session.deleteMany({ where: { userId: id } });
      return { updated, cur };
    },
    { isolationLevel: "Serializable" },
  );
  await audit({ userId: user.id, action: "user.updated", entityType: "User", entityId: id, metadata: { role: input.role, isActive: input.isActive, previousRole: u.cur.role as UserRole, wasActive: u.cur.isActive } });
  return u.updated;
}

/** Yönetici yeni şifre belirler; kullanıcının tüm oturumları kapanır */
export async function resetPassword(user: CurrentUser, id: string, newPassword: string) {
  assertCan(user, "users.manage");
  const exists = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new AppError("NOT_FOUND", "Kullanıcı bulunamadı.");
  const passwordHash = await hashPassword(newPassword);
  await db.$transaction([db.user.update({ where: { id }, data: { passwordHash } }), db.session.deleteMany({ where: { userId: id } })]);
  await audit({ userId: user.id, action: "user.password_reset", entityType: "User", entityId: id });
}

/** Kullanıcının kendi şifresini değiştirmesi; diğer oturumları kapanır, bu oturum kalır */
export async function changeOwnPassword(user: CurrentUser, input: z.infer<typeof ownPasswordSchema>, currentTokenHash: string | null) {
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(input.currentPassword, u.passwordHash))) throw new AppError("VALIDATION", "Mevcut şifre hatalı.", { currentPassword: "Hatalı" });
  const passwordHash = await hashPassword(input.password);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash } }),
    db.session.deleteMany({ where: { userId: user.id, ...(currentTokenHash ? { tokenHash: { not: currentTokenHash } } : {}) } }),
  ]);
  await audit({ userId: user.id, action: "user.password_changed", entityType: "User", entityId: user.id });
}

export async function updateOwnName(user: CurrentUser, name: string) {
  const n = name.trim();
  if (n.length < 2 || n.length > 100) throw new AppError("VALIDATION", "Ad soyad girin.", { name: "Geçersiz" });
  await db.user.update({ where: { id: user.id }, data: { name: n } });
}

export async function listOwnSessions(user: CurrentUser) {
  return db.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { id: true, tokenHash: true, createdAt: true, ip: true, userAgent: true } });
}

export async function closeOtherSessions(user: CurrentUser, currentTokenHash: string | null) {
  const r = await db.session.deleteMany({ where: { userId: user.id, ...(currentTokenHash ? { tokenHash: { not: currentTokenHash } } : {}) } });
  await audit({ userId: user.id, action: "auth.sessions_closed", metadata: { count: r.count } });
  return r.count;
}

// ── İşlem geçmişi ──────────────────────────────────────────

export const AUDIT_PAGE_SIZE = 50;

export async function listAudit(user: CurrentUser, f: { userId?: string; action?: string; page?: number } = {}) {
  assertCan(user, "users.manage");
  const where: Prisma.AuditLogWhereInput = {};
  if (f.userId) where.userId = f.userId;
  if (f.action) where.action = { startsWith: f.action };
  const page = Math.max(1, f.page ?? 1);
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE, include: { user: { select: { name: true } } } }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) };
}
