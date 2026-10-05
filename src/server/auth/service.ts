import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError } from "@/lib/errors";
import { createHash, timingSafeEqual } from "node:crypto";
import { hashPassword, PASSWORD_MIN, verifyPassword } from "./password";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin."),
  password: z.string().min(1, "Şifrenizi girin."),
});

export const setupSchema = z
  .object({
    name: z.string().trim().min(2, "Adınızı girin.").max(100),
    email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin."),
    password: z.string().min(PASSWORD_MIN, `Şifre en az ${PASSWORD_MIN} karakter olmalı.`).max(200),
    passwordConfirm: z.string(),
    setupToken: z.string().optional(),
  })
  .refine((v) => v.password === v.passwordConfirm, { message: "Şifreler aynı değil.", path: ["passwordConfirm"] });

/**
 * Canlıda ilk kurulum SETUP_TOKEN ile korunur: sunucu yeni açıldığında /kurulum'a ilk ulaşan kişi yönetici olamasın.
 * Geliştirmede anahtar istenmez. Production'da anahtar tanımlı değilse kurulum kapalıdır.
 */
export function setupTokenRequired(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.SETUP_TOKEN);
}

function checkSetupToken(given: string | undefined) {
  if (!setupTokenRequired()) return;
  const expected = process.env.SETUP_TOKEN;
  if (!expected || expected.length < 12) throw new AppError("FORBIDDEN", "Kurulum kapalı: sunucuda SETUP_TOKEN (en az 12 karakter) tanımlayın.");
  const d = (s: string) => createHash("sha256").update(s).digest();
  if (!timingSafeEqual(d(given ?? ""), d(expected))) throw new AppError("VALIDATION", "Kurulum anahtarı hatalı.", { setupToken: "Hatalı" });
}

/** Hiç kullanıcı yoksa ilk kurulum gerekir (ilk kullanıcı yönetici olur). */
export async function needsSetup(): Promise<boolean> {
  return (await db.user.count()) === 0;
}

/**
 * İlk yöneticiyi oluşturur. Yarış durumuna karşı: kayıt işlem içinde, kullanıcı sayısı tekrar kontrol edilerek yapılır.
 */
export async function createFirstAdmin(input: z.infer<typeof setupSchema>) {
  checkSetupToken(input.setupToken);
  const passwordHash = await hashPassword(input.password);
  const user = await db.$transaction(async (tx) => {
    if ((await tx.user.count()) > 0) throw new AppError("CONFLICT", "Kurulum zaten yapılmış. Giriş yapın.");
    return tx.user.create({ data: { name: input.name, email: input.email, passwordHash, role: "ADMIN" } });
  }, { isolationLevel: "Serializable" });
  await audit({ userId: user.id, action: "user.setup_admin", entityType: "User", entityId: user.id });
  return user;
}

let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword("kullanici-yok"));

/** Bilinmeyen e-posta ile yanlış şifre aynı mesajı verir (hangi e-postanın kayıtlı olduğu sızmasın). */
export async function authenticate(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email } });
  // Kullanıcı yoksa da hash doğrulaması yapılır: yanıt süresinden e-posta tahmin edilemesin
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !ok) {
    await audit({ userId: user?.id ?? null, action: "auth.login_failed", metadata: { email } });
    throw new AppError("UNAUTHORIZED", "E-posta veya şifre hatalı.");
  }
  if (!user.isActive) throw new AppError("FORBIDDEN", "Hesabınız pasif. Yöneticinize başvurun.");
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ userId: user.id, action: "auth.login" });
  return user;
}
