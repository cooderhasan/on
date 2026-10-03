import "server-only";
import type { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { COMPANY_ID } from "@/server/company";
import type { companySchema } from "@/lib/validation";

export async function saveCompany(user: CurrentUser, input: z.infer<typeof companySchema>) {
  assertCan(user, "settings.manage");
  const company = await db.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, ...input }, update: input });
  await audit({ userId: user.id, action: "company.updated", entityType: "Company", entityId: COMPANY_ID });
  return company;
}
