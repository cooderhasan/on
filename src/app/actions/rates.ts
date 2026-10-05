"use server";

import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { tcmbRate } from "@/server/services/rates";
import { isAppError } from "@/lib/errors";

/** Belge formundaki "TCMB'den al": belge tarihine göre TCMB döviz alış kuru */
export async function tcmbRateAction(currency: string, date: string): Promise<{ rate?: string; bulletinDate?: string; error?: string }> {
  try {
    await requireUser();
    const r = await tcmbRate(currency, date);
    return { rate: r.buying.toString(), bulletinDate: r.bulletinDate };
  } catch (err) {
    unstable_rethrow(err);
    if (isAppError(err)) return { error: err.message };
    console.error("[tcmb]", err);
    return { error: "Kur alınamadı. Elle girin." };
  }
}
