import "server-only";
import { AppError } from "@/lib/errors";

/**
 * Basit kaba kuvvet koruması: aynı e-posta için 15 dakikada en fazla 10 deneme.
 * Bellek içi — tek sunucu kopyası için yeterli (Coolify'da tek container).
 */
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, number[]>();

export function checkLoginRate(key: string, now = Date.now()) {
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    throw new AppError("FORBIDDEN", "Çok fazla deneme yapıldı. 15 dakika sonra tekrar deneyin.");
  }
  recent.push(now);
  attempts.set(key, recent);
}

export function resetLoginRate() {
  attempts.clear();
}
