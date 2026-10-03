import { db } from "@/server/db";
import { resetLoginRate } from "@/server/auth/rate-limit";

/** Tüm tabloları boşaltır (yalnızca test veritabanında çalışır). */
export async function resetDb() {
  if (!process.env.DATABASE_URL?.includes("_test")) throw new Error("resetDb yalnızca test veritabanında çalışır.");
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  resetLoginRate();
}
