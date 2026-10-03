import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AppError, isAppError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";

/** Server action gövdesi: AppError kullanıcıya gösterilir, beklenmeyen hata loglanıp genel mesaja çevrilir. */
export async function safeAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (err) {
    // redirect() / notFound() Next tarafından fırlatılır — yutulmamalı
    unstable_rethrow(err);
    if (isAppError(err)) return { error: err.message, fieldErrors: err.fieldErrors };
    console.error("[action]", err);
    return { error: "Beklenmeyen bir hata oluştu. Tekrar deneyin." };
  }
}

/** FormData'yı şemaya göre doğrular; hata varsa alan bazında AppError fırlatır. */
export function parseForm<T extends z.ZodType>(schema: T, fd: FormData): z.infer<T> {
  const raw = Object.fromEntries(fd.entries());
  const res = schema.safeParse(raw);
  if (res.success) return res.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = String(issue.path[0] ?? "_");
    fieldErrors[key] ??= issue.message;
  }
  throw new AppError("VALIDATION", "Formdaki hataları düzeltin.", fieldErrors);
}
