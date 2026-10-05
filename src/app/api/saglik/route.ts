import { connection } from "next/server";
import { db } from "@/server/db";

/** Coolify / Docker sağlık kontrolü: uygulama ve veritabanı ayakta mı */
export async function GET() {
  // Her istekte gerçekten sorgulansın (build anında sabitlenmesin)
  await connection();
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
