import "server-only";
import { db } from "@/server/db";
import { SYSTEM_USER_ID } from "@/server/audit";
import type { CurrentUser } from "@/server/auth/session";
import { refreshStatus } from "@/server/services/einvoice";
import { syncIncoming } from "@/server/services/incoming";
import { runRecurring } from "@/server/services/recurring";
import { refreshDespatch, syncIncomingDespatches } from "@/server/services/edespatch";

/**
 * Otomatik işler (Coolify zamanlanmış görevi /api/zamanlayici'yi çağırır):
 *  - Gönderilmiş e-belgelerin durumunu NES'ten sorgular (resmileşti / ret / hata, ticari faturada alıcı yanıtı)
 *  - Gelen e-faturaları içeri alır
 *  - Vadesi gelen tekrarlayan faturaları oluşturur (NES ayarı olmasa da)
 * Tek container: aynı anda ikinci çalıştırma bellek bayrağıyla engellenir.
 */
const SYSTEM_USER: CurrentUser = { id: SYSTEM_USER_ID, name: "Zamanlayıcı", email: "", role: "ADMIN", isActive: true };
let running = false;

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

export async function runScheduledJobs() {
  if (running) return { skipped: true as const };
  running = true;
  try {
    const recurring = await runRecurring();
    const settings = await db.eInvoiceSettings.findUnique({ where: { id: "nes" }, select: { apiKeyEnc: true, despatchSenderAlias: true } });
    if (!settings?.apiKeyEnc) return { skipped: true as const, reason: "NES ayarı yok", recurring };
    const pending = await db.invoice.findMany({
      where: {
        eDocUuid: { not: null },
        OR: [
          // Gönderim yarıda kalmış (15 dk'dan eski): NES'te var mı bakılır
          { eDocStatus: "QUEUED", updatedAt: { lt: minutesAgo(15) } },
          // Sonucu beklenen gönderimler
          { eDocStatus: "SENT", OR: [{ eDocCheckedAt: null }, { eDocCheckedAt: { lt: minutesAgo(20) } }] },
          // Ticari faturada alıcı yanıtı (8 gün içinde verilebilir)
          { eDocStatus: "ACCEPTED", eDocAnswer: "Waiting", eDocSentAt: { gt: minutesAgo(10 * 24 * 60) }, OR: [{ eDocCheckedAt: null }, { eDocCheckedAt: { lt: minutesAgo(120) } }] },
        ],
      },
      orderBy: { eDocSentAt: "asc" },
      take: 50,
      select: { id: true },
    });
    let refreshed = 0;
    const errors: string[] = [];
    for (const inv of pending) {
      try {
        await refreshStatus(SYSTEM_USER, inv.id);
        refreshed++;
      } catch (err) {
        errors.push(`${inv.id}: ${(err as Error).message.slice(0, 200)}`);
      }
    }
    let incoming: { created: number; updated: number } | null = null;
    try {
      incoming = await syncIncoming(SYSTEM_USER);
    } catch (err) {
      errors.push(`gelen: ${(err as Error).message.slice(0, 200)}`);
    }
    // e-İrsaliye (firma e-İrsaliye kullanıcısıysa: gönderici etiketi tanımlı)
    let despatches = 0;
    let incomingDespatch: { created: number; updated: number } | null = null;
    if (settings.despatchSenderAlias) {
      const pendingD = await db.waybill.findMany({
        where: { eDocUuid: { not: null }, OR: [{ eDocStatus: "QUEUED", updatedAt: { lt: minutesAgo(15) } }, { eDocStatus: "SENT", OR: [{ eDocCheckedAt: null }, { eDocCheckedAt: { lt: minutesAgo(20) } }] }] },
        orderBy: { eDocSentAt: "asc" },
        take: 50,
        select: { id: true },
      });
      for (const w of pendingD) {
        try {
          await refreshDespatch(SYSTEM_USER, w.id);
          despatches++;
        } catch (err) {
          errors.push(`irsaliye ${w.id}: ${(err as Error).message.slice(0, 200)}`);
        }
      }
      try {
        incomingDespatch = await syncIncomingDespatches(SYSTEM_USER);
      } catch (err) {
        errors.push(`gelen irsaliye: ${(err as Error).message.slice(0, 200)}`);
      }
    }
    if (errors.length) console.error("[zamanlayıcı]", errors);
    return { skipped: false as const, recurring, refreshed, pending: pending.length, incoming, despatches, incomingDespatch, errors: errors.length };
  } finally {
    running = false;
  }
}
