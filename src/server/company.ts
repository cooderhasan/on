import "server-only";
import { cache } from "react";
import { db } from "@/server/db";

export const COMPANY_ID = "firma";

/** Firma kaydı (tek satır). Henüz girilmediyse null. */
export const getCompany = cache(async () => db.company.findUnique({ where: { id: COMPANY_ID } }));

export async function getCompanyName(): Promise<string | null> {
  return (await getCompany())?.title ?? null;
}
