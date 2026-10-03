import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/** Geliştirmede sıcak yeniden yüklemede bağlantı havuzu çoğalmasın diye tek örnek tutulur. */
const globalForDb = globalThis as unknown as { db?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL tanımlı değil (.env dosyasını kontrol edin).");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const db = globalForDb.db ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.db = db;
