import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit, SYSTEM_USER_ID } from "@/server/audit";
import { assertCan, can } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { documentHeaderSchema } from "@/lib/document-form";
import { saveInvoice, startOfToday } from "./invoices";
import { tcmbRate } from "./rates";

/**
 * Tekrarlayan satış faturası: şablon faturanın kopyası nextDate geldiğinde oluşturulur.
 *  - Kopya taslaktır (kağıt); e-Fatura / e-Arşiv gönderimi kullanıcı onayıyla yapılır.
 *  - Vade farkı, satırlar, indirim, kategori, etiketler ve not şablondan gelir.
 *  - Her dönem bir kez: nextDate atomik olarak ilerletilir (eşzamanlı çalıştırmada çift fatura oluşmaz).
 */

const MAX_CATCH_UP = 12;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const recurSchema = z
  .object({
    period: z.enum(["MONTHLY", "YEARLY"]),
    interval: z.coerce.number().int().min(1, "En az 1.").max(12, "En fazla 12."),
    nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "İlk oluşturma tarihini girin."),
    endDate: z.string().optional().transform((v) => v?.trim() || null).refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Tarih geçersiz."),
  })
  .superRefine((v, ctx) => {
    if (v.endDate && v.endDate < v.nextDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Bitiş, ilk tarihten önce olamaz." });
  });

/** Ay / yıl ekler; ayın günü yoksa ayın son günü (31 Ocak + 1 ay = 28/29 Şubat) — gün, şablonun gününe göre korunur */
export function addPeriod(date: Date, period: "MONTHLY" | "YEARLY", interval: number, anchorDay: number): Date {
  const months = period === "MONTHLY" ? interval : interval * 12;
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, last)));
}

export async function setRecurring(user: CurrentUser, invoiceId: string, input: z.infer<typeof recurSchema>) {
  assertCan(user, "sales.write");
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { direction: true, kind: true } });
  if (!inv) throw new AppError("NOT_FOUND", "Fatura bulunamadı.");
  if (inv.direction !== "SALE" || inv.kind !== "INVOICE") throw new AppError("VALIDATION", "Yalnızca satış faturası tekrarlanabilir.");
  const data = { period: input.period, interval: input.interval, nextDate: new Date(input.nextDate), endDate: input.endDate ? new Date(input.endDate) : null, isActive: true };
  const r = await db.recurringInvoice.upsert({ where: { templateId: invoiceId }, create: { templateId: invoiceId, createdById: user.id, ...data }, update: data });
  await audit({ userId: user.id, action: "recurring.saved", entityType: "Invoice", entityId: invoiceId, metadata: { period: input.period, interval: input.interval, nextDate: input.nextDate } });
  return r;
}

export async function stopRecurring(user: CurrentUser, invoiceId: string) {
  assertCan(user, "sales.write");
  await db.recurringInvoice.updateMany({ where: { templateId: invoiceId }, data: { isActive: false } });
  await audit({ userId: user.id, action: "recurring.stopped", entityType: "Invoice", entityId: invoiceId });
}

export async function getRecurring(templateId: string) {
  return db.recurringInvoice.findUnique({ where: { templateId }, include: { invoices: { orderBy: { issueDate: "desc" }, take: 12, select: { id: true, issueDate: true, invoiceNo: true, name: true } } } });
}

export async function listRecurring(user: CurrentUser) {
  assertCan(user, "sales.read");
  return db.recurringInvoice.findMany({
    orderBy: [{ isActive: "desc" }, { nextDate: "asc" }],
    include: { template: { select: { id: true, name: true, invoiceNo: true, payableTotal: true, currency: true, contact: { select: { title: true } } } } },
  });
}

/** Vadesi gelen tekrarlayan faturaları oluşturur (zamanlayıcı ve satış listesi açılışında çağrılır) */
export async function runRecurring(today = startOfToday()) {
  const due = await db.recurringInvoice.findMany({ where: { isActive: true, nextDate: { lte: today } }, select: { id: true } });
  let created = 0;
  const errors: string[] = [];
  for (const { id } of due) {
    for (let i = 0; i < MAX_CATCH_UP; i++) {
      const r = await db.recurringInvoice.findUnique({ where: { id }, include: { template: { include: { lines: { orderBy: { position: "asc" } }, tags: true } } } });
      if (!r || !r.isActive || r.nextDate > today) break;
      if (r.endDate && r.nextDate > r.endDate) {
        await db.recurringInvoice.update({ where: { id }, data: { isActive: false } });
        break;
      }
      const t = r.template;
      const issue = r.nextDate;
      const next = addPeriod(issue, r.period, r.interval, t.issueDate.getUTCDate());
      // Bu dönemi sahiplen: başka bir çalıştırma aynı anda ilerlettiyse atla
      const claim = await db.recurringInvoice.updateMany({ where: { id, nextDate: issue, isActive: true }, data: { nextDate: next, lastRunAt: new Date() } });
      if (!claim.count) break;
      try {
        const creator = r.createdById ? await db.user.findUnique({ where: { id: r.createdById }, select: { id: true, name: true, email: true, role: true, isActive: true } }) : null;
        const actor: CurrentUser = creator?.isActive && can(creator.role, "sales.write") ? creator : { id: SYSTEM_USER_ID, name: "Zamanlayıcı", email: "", role: "ADMIN", isActive: true };
        // Dövizli şablon: yeni tarihin TCMB kuru; alınamazsa şablonun kuru
        let rate = t.exchangeRate.toString();
        if (t.currency !== "TRY") rate = await tcmbRate(t.currency, iso(issue)).then((x) => x.buying.toString(), () => rate);
        const dueOffset = Math.round((t.dueDate.getTime() - t.issueDate.getTime()) / 86_400_000);
        const invoiceId = await saveInvoice(actor, null, {
          direction: "SALE",
          header: documentHeaderSchema.parse({
            contactId: t.contactId, name: t.name ?? undefined, issueDate: iso(issue), dueDate: iso(new Date(issue.getTime() + dueOffset * 86_400_000)),
            currency: t.currency, exchangeRate: rate, categoryId: t.categoryId ?? undefined, notes: t.notes ?? undefined,
            stockMode: t.stockMode, kind: "INVOICE", warehouseId: t.warehouseId ?? undefined,
          }),
          lines: t.lines.map((l) => ({
            productId: l.productId, name: l.name, description: l.description, quantity: l.quantity.toString(), unit: l.unit, unitPrice: l.unitPrice.toString(),
            discountType: l.discountType, discountValue: l.discountValue?.toString() ?? null, vatRate: l.vatRate, vatExemptionCode: l.vatExemptionCode,
            otvRate: l.otvRate?.toString() ?? null, otvCode: l.otvCode, withholdingRate: l.withholdingRate, withholdingCode: l.withholdingCode,
          })),
          discount: { discountType: t.discountType, discountValue: t.discountValue?.toString() ?? null },
          tagIds: t.tags.map((x) => x.tagId),
        });
        await db.invoice.update({ where: { id: invoiceId }, data: { recurringId: id } });
        await db.recurringInvoice.update({ where: { id }, data: { createdCount: { increment: 1 } } });
        created++;
      } catch (err) {
        // Oluşturulamadıysa dönem geri alınır, bir sonraki çalıştırmada tekrar denenir
        await db.recurringInvoice.updateMany({ where: { id, nextDate: next }, data: { nextDate: issue } });
        errors.push(`${id}: ${(err as Error).message.slice(0, 200)}`);
        break;
      }
    }
  }
  if (errors.length) console.error("[tekrarlayan]", errors);
  return { created, errors: errors.length };
}
