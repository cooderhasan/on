import "server-only";
import type { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { COMPANY_ID } from "@/server/company";
import type { companySchema } from "@/lib/validation";
import { AppError } from "@/lib/errors";

export async function saveCompany(user: CurrentUser, input: z.infer<typeof companySchema>) {
  assertCan(user, "settings.manage");
  const company = await db.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, ...input }, update: input });
  await audit({ userId: user.id, action: "company.updated", entityType: "Company", entityId: COMPANY_ID });
  return company;
}

// ── Logo ───────────────────────────────────────────────────
const LOGO_MAX = 300 * 1024;

/** Dosya türü uzantıdan / beyan edilen MIME'den değil içerikten (imza baytları) belirlenir; SVG kabul edilmez (betik içerebilir) */
export function detectImageMime(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function saveLogo(user: CurrentUser, file: File | null) {
  assertCan(user, "settings.manage");
  if (!file || file.size === 0) throw new AppError("VALIDATION", "Logo dosyası seçin.", { logo: "Dosya seçin" });
  if (file.size > LOGO_MAX) throw new AppError("VALIDATION", "Logo en fazla 300 KB olabilir.", { logo: "Çok büyük" });
  const data = new Uint8Array(await file.arrayBuffer());
  const mime = detectImageMime(data);
  if (!mime) throw new AppError("VALIDATION", "Yalnızca PNG, JPEG veya WebP yüklenebilir.", { logo: "Geçersiz dosya" });
  await db.companyLogo.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, data, mime }, update: { data, mime } });
  await audit({ userId: user.id, action: "company.logo_updated", entityType: "Company", entityId: COMPANY_ID, metadata: { size: file.size, mime } });
}

export async function deleteLogo(user: CurrentUser) {
  assertCan(user, "settings.manage");
  await db.companyLogo.deleteMany({ where: { id: COMPANY_ID } });
  await audit({ userId: user.id, action: "company.logo_deleted", entityType: "Company", entityId: COMPANY_ID });
}

/** Logo var mı ve son değişiklik (önbellek kırıcı) — baytlar yüklenmez */
export async function logoInfo() {
  return db.companyLogo.findUnique({ where: { id: COMPANY_ID }, select: { updatedAt: true } });
}
