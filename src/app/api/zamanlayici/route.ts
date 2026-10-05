import { createHash, timingSafeEqual } from "node:crypto";
import { runScheduledJobs } from "@/server/jobs";

/** Zamanlanmış görev: Authorization: Bearer <CRON_SECRET>. Anahtar tanımlı değilse uç kapalıdır. */
const digest = (s: string) => createHash("sha256").update(s).digest();

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return new Response("Bulunamadı", { status: 404 });
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!timingSafeEqual(digest(given), digest(secret))) return new Response("Yetkisiz", { status: 401 });
  const result = await runScheduledJobs();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
