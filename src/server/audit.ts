import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Kritik işlemleri kaydeder. Audit yazılamazsa ana işlem durmaz, hata loglanır. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({ data: { ...entry, userId: entry.userId ?? null, ip: entry.ip ?? null } });
  } catch (err) {
    console.error("[audit] yazılamadı", entry.action, err);
  }
}
