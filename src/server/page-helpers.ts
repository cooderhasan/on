import "server-only";
import { notFound } from "next/navigation";
import { isAppError } from "@/lib/errors";

/** Servis NOT_FOUND hatası verirse Next'in 404 sayfası gösterilir. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}

/** URL'deki sayfa numarası */
export const pageParam = (v: string | string[] | undefined) => Math.max(1, Number(Array.isArray(v) ? v[0] : v) || 1);
export const strParam = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
