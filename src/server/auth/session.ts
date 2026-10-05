import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/server/db";
import { can, type Permission } from "./permissions";

export const SESSION_COOKIE = "oturum";
const SESSION_DAYS = 14;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Yeni oturum: çereze rastgele token, veritabanına yalnızca özeti yazılır (sızıntıda token ele geçmez). */
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const h = await headers();
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  store.delete(SESSION_COOKIE);
}

/** Oturumdaki kullanıcı (istek başına bir kez sorgulanır). Pasif kullanıcı ve süresi dolmuş oturum geçersizdir. */
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;
  return session.user;
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** Sayfalar için: oturum yoksa girişe, yetki yoksa "yetkiniz yok" sayfasına yönlendirir (menü yerinde kalır). */
export async function requireUser(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/giris");
  if (permission && !can(user.role, permission)) redirect("/yetki-yok");
  return user;
}
