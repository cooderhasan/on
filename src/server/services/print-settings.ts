import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { optText } from "@/lib/validation";

const ID = "yazdir";
const checkbox = z.string().optional().transform((v) => v === "on" || v === "true");

export const printSettingsSchema = z.object({
  footerNote: optText(1000),
  showAmountInWords: checkbox,
  showSignature: checkbox,
  showContactBalance: checkbox,
});

/** Kayıt yoksa varsayılanlar (yazıyla tutar açık, diğerleri kapalı) */
export async function getPrintSettings() {
  const s = await db.printSettings.findUnique({ where: { id: ID } });
  return s ?? { id: ID, footerNote: null, bankAccountIds: [] as string[], showAmountInWords: true, showSignature: false, showContactBalance: false, updatedAt: null };
}

export async function savePrintSettings(user: CurrentUser, input: z.infer<typeof printSettingsSchema>, bankAccountIds: string[]) {
  assertCan(user, "settings.manage");
  const valid = (await db.account.findMany({ where: { id: { in: bankAccountIds }, type: "BANK" }, select: { id: true } })).map((a) => a.id);
  const data = { ...input, bankAccountIds: bankAccountIds.filter((id) => valid.includes(id)) };
  await db.printSettings.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data });
  await audit({ userId: user.id, action: "print_settings.updated" });
}

/** Belge altına basılacak banka hesapları (seçim sırasıyla, IBAN'ı olanlar) */
export async function printBankAccounts(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.account.findMany({ where: { id: { in: ids }, iban: { not: null } }, select: { id: true, name: true, bankName: true, branch: true, iban: true, currency: true } });
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
}
