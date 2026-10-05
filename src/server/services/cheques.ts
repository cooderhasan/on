import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ChequeDirection, ChequeStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { optDecimal, optText } from "@/lib/validation";
import { invoiceSign } from "./ledger";
import { startOfToday } from "./invoices";
import { CHEQUE_STATUS_LABELS } from "@/lib/cheque";

export { CHEQUE_STATUS_LABELS };

/**
 * Çek kuralları (hareketler Transaction tablosunda, chequeId ile):
 *  Alınan çek (müşteriden):
 *    alındı      → COLLECTION, hesapsız (müşteri bakiyesi / fatura kalanı düşer)
 *    tahsil      → DEPOSIT, banka / kasa hesabına (para girer)
 *    ciro        → PAYMENT, hesapsız, tedarikçiye (tedarikçi borcumuz düşer)
 *    karşılıksız → PAYMENT, hesapsız, aynı müşteriye (müşteri yeniden borçlu; fatura yeniden açık)
 *  Verilen çek (tedarikçiye):
 *    verildi     → PAYMENT, hesapsız (tedarikçi borcumuz / fatura kalanı düşer)
 *    ödendi      → WITHDRAWAL, hesaptan (para çıkar)
 *  Her durum değişikliği "geri al" ile tersine çevrilebilir; çek yalnızca ilk durumundayken silinir.
 */

const D = (v: { toString(): string } | null | undefined) => new Decimal(v?.toString() ?? 0);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih girin.");
export const CHEQUES_PAGE_SIZE = 25;

const INITIAL: Record<ChequeDirection, ChequeStatus> = { RECEIVED: "PORTFOLIO", ISSUED: "PENDING" };

export const chequeSchema = z
  .object({
    direction: z.enum(["RECEIVED", "ISSUED"]),
    contactId: z.string().min(1, "Cari seçin."),
    invoiceId: optText(50),
    chequeNo: z.string().trim().min(1, "Çek numarasını girin.").max(40, "En fazla 40 karakter."),
    bankName: optText(100),
    branch: optText(100),
    drawer: optText(200),
    amount: optDecimal({ min: 0, label: "Tutar" }).refine((v) => v !== null && new Decimal(v).greaterThan(0), "Tutarı girin."),
    issueDate: date,
    dueDate: date,
    notes: optText(500),
  })
  .superRefine((v, ctx) => {
    if (v.dueDate < v.issueDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Vade, düzenleme tarihinden önce olamaz." });
  });

export const chequeActionSchema = z.object({
  action: z.enum(["collect", "endorse", "bounce", "pay"]),
  date,
  accountId: optText(50),
  contactId: optText(50),
  invoiceId: optText(50),
});

const writePerms = (direction: ChequeDirection, user: CurrentUser) => {
  assertCan(user, direction === "RECEIVED" ? "sales.write" : "expenses.write");
  assertCan(user, "cash.write");
};

/** Faturanın kalanı (çek hareketleri dahil tüm tahsilat / ödemeler düşülmüş) */
async function invoiceRemaining(tx: Prisma.TransactionClient, invoiceId: string) {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, direction: true, kind: true, contactId: true, currency: true, payableTotal: true, transactions: { select: { appliedAmount: true } } } });
  if (!inv) throw new AppError("NOT_FOUND", "Fatura bulunamadı.");
  return { ...inv, remaining: D(inv.payableTotal).minus(inv.transactions.reduce((a, t) => a.plus(D(t.appliedAmount)), new Decimal(0))) };
}

async function checkInvoice(tx: Prisma.TransactionClient, invoiceId: string, contactId: string, moneyIn: boolean, amount: Decimal) {
  const inv = await invoiceRemaining(tx, invoiceId);
  if (inv.contactId !== contactId) throw new AppError("VALIDATION", "Fatura bu cariye ait değil.", { invoiceId: "Geçersiz" });
  if ((invoiceSign(inv.direction, inv.kind) > 0) !== moneyIn) throw new AppError("VALIDATION", moneyIn ? "Bu faturaya tahsilat girilemez." : "Bu faturaya ödeme girilemez.", { invoiceId: "Geçersiz" });
  if (amount.greaterThan(inv.remaining)) throw new AppError("VALIDATION", `Fatura kalanı ${formatMoney(inv.remaining, inv.currency)}. Çek tutarı daha fazla olamaz.`, { amount: "Kalanı aşıyor" });
}

export async function createCheque(user: CurrentUser, input: z.infer<typeof chequeSchema>) {
  writePerms(input.direction, user);
  const amount = new Decimal(input.amount!);
  const received = input.direction === "RECEIVED";
  const id = await db.$transaction(async (tx) => {
    const c = await tx.contact.findUnique({ where: { id: input.contactId }, select: { id: true, kind: true, currency: true } });
    if (!c) throw new AppError("VALIDATION", "Cari bulunamadı.", { contactId: "Seçin" });
    if (c.kind !== (received ? "CUSTOMER" : "SUPPLIER")) throw new AppError("VALIDATION", received ? "Alınan çek müşteriden alınır." : "Verilen çek tedarikçiye verilir.", { contactId: "Geçersiz" });
    if (input.invoiceId) await checkInvoice(tx, input.invoiceId, c.id, received, amount);
    const ch = await tx.cheque.create({
      data: {
        direction: input.direction, status: INITIAL[input.direction], contactId: c.id, invoiceId: input.invoiceId, chequeNo: input.chequeNo, bankName: input.bankName, branch: input.branch,
        drawer: received ? input.drawer : null, amount: amount.toString(), currency: c.currency, issueDate: new Date(input.issueDate), dueDate: new Date(input.dueDate), notes: input.notes, createdById: user.id,
      },
    });
    await tx.transaction.create({
      data: { type: received ? "COLLECTION" : "PAYMENT", date: ch.issueDate, contactId: c.id, invoiceId: input.invoiceId, chequeId: ch.id, amount: amount.toString(), appliedAmount: amount.toString(), description: `Çek ${ch.chequeNo}`, createdById: user.id },
    });
    return ch.id;
  });
  await audit({ userId: user.id, action: received ? "cheque.received" : "cheque.issued", entityType: "Cheque", entityId: id, metadata: { amount: amount.toString(), invoiceId: input.invoiceId } });
  return id;
}

/** Durum değişikliği: tahsil, ciro, karşılıksız (alınan) / ödendi (verilen) */
export async function chequeAction(user: CurrentUser, id: string, input: z.infer<typeof chequeActionSchema>) {
  await db.$transaction(async (tx) => {
    const ch = await tx.cheque.findUnique({ where: { id } });
    if (!ch) throw new AppError("NOT_FOUND", "Çek bulunamadı.");
    writePerms(ch.direction, user);
    const day = new Date(input.date);
    const amount = D(ch.amount);
    const expected = ch.direction === "RECEIVED" ? ["collect", "endorse", "bounce"] : ["pay"];
    if (!expected.includes(input.action)) throw new AppError("VALIDATION", "Bu çek için geçersiz işlem.");
    if (ch.status !== INITIAL[ch.direction]) throw new AppError("CONFLICT", `Çek ${CHEQUE_STATUS_LABELS[ch.status].toLocaleLowerCase("tr")}; önce son işlemi geri alın.`);

    if (input.action === "collect" || input.action === "pay") {
      if (!input.accountId) throw new AppError("VALIDATION", "Hesap seçin.", { accountId: "Seçin" });
      const acc = await tx.account.findUnique({ where: { id: input.accountId }, select: { id: true, currency: true, isArchived: true } });
      if (!acc || acc.isArchived) throw new AppError("VALIDATION", "Hesap bulunamadı.", { accountId: "Seçin" });
      if (acc.currency !== ch.currency) throw new AppError("VALIDATION", `Çek ${ch.currency}; aynı dövizde bir hesap seçin.`, { accountId: "Döviz farklı" });
      const collect = input.action === "collect";
      await tx.transaction.create({ data: { type: collect ? "DEPOSIT" : "WITHDRAWAL", date: day, accountId: acc.id, chequeId: ch.id, amount: amount.toString(), appliedAmount: "0", description: `${collect ? "Çek tahsili" : "Çek ödemesi"} · ${ch.chequeNo}`, createdById: user.id } });
      await tx.cheque.update({ where: { id }, data: { status: collect ? "COLLECTED" : "PAID", statusDate: day, accountId: acc.id } });
    } else if (input.action === "endorse") {
      if (!input.contactId) throw new AppError("VALIDATION", "Ciro edilecek tedarikçiyi seçin.", { contactId: "Seçin" });
      const s = await tx.contact.findUnique({ where: { id: input.contactId }, select: { id: true, kind: true, currency: true } });
      if (!s || s.kind !== "SUPPLIER") throw new AppError("VALIDATION", "Çek yalnızca tedarikçiye ciro edilir.", { contactId: "Geçersiz" });
      if (s.currency !== ch.currency) throw new AppError("VALIDATION", `Tedarikçi ${s.currency} ile izleniyor, çek ${ch.currency}.`, { contactId: "Döviz farklı" });
      if (input.invoiceId) await checkInvoice(tx, input.invoiceId, s.id, false, amount);
      await tx.transaction.create({ data: { type: "PAYMENT", date: day, contactId: s.id, invoiceId: input.invoiceId, chequeId: ch.id, amount: amount.toString(), appliedAmount: amount.toString(), description: `Çek ciro · ${ch.chequeNo}`, createdById: user.id } });
      await tx.cheque.update({ where: { id }, data: { status: "ENDORSED", statusDate: day, endorsedToId: s.id } });
    } else {
      // Karşılıksız: müşteri yeniden borçlu, bağlı fatura yeniden açık
      await tx.transaction.updateMany({ where: { chequeId: id, type: "COLLECTION" }, data: { invoiceId: null } });
      await tx.transaction.create({ data: { type: "PAYMENT", date: day, contactId: ch.contactId, chequeId: ch.id, amount: amount.toString(), appliedAmount: amount.toString(), description: `Karşılıksız çek · ${ch.chequeNo}`, createdById: user.id } });
      await tx.cheque.update({ where: { id }, data: { status: "BOUNCED", statusDate: day } });
    }
  });
  await audit({ userId: user.id, action: `cheque.${input.action}`, entityType: "Cheque", entityId: id });
}

/** Son durum değişikliğini geri alır (çek portföye / ödenecek durumuna döner) */
export async function revertCheque(user: CurrentUser, id: string) {
  await db.$transaction(async (tx) => {
    const ch = await tx.cheque.findUnique({ where: { id } });
    if (!ch) throw new AppError("NOT_FOUND", "Çek bulunamadı.");
    writePerms(ch.direction, user);
    switch (ch.status) {
      case "COLLECTED":
        await tx.transaction.deleteMany({ where: { chequeId: id, type: "DEPOSIT" } });
        break;
      case "PAID":
        await tx.transaction.deleteMany({ where: { chequeId: id, type: "WITHDRAWAL" } });
        break;
      case "ENDORSED":
        await tx.transaction.deleteMany({ where: { chequeId: id, type: "PAYMENT", contactId: ch.endorsedToId } });
        break;
      case "BOUNCED":
        await tx.transaction.deleteMany({ where: { chequeId: id, type: "PAYMENT", contactId: ch.contactId } });
        if (ch.invoiceId) {
          // Fatura bu arada başka tahsilatla kapandıysa çek yeniden faturaya bağlanamaz
          const inv = await invoiceRemaining(tx, ch.invoiceId);
          const relink = !D(ch.amount).greaterThan(inv.remaining);
          await tx.transaction.updateMany({ where: { chequeId: id, type: "COLLECTION" }, data: { invoiceId: relink ? ch.invoiceId : null } });
          if (!relink) await tx.cheque.update({ where: { id }, data: { invoiceId: null } });
        }
        break;
      default:
        throw new AppError("CONFLICT", "Geri alınacak işlem yok.");
    }
    await tx.cheque.update({ where: { id }, data: { status: INITIAL[ch.direction], statusDate: null, accountId: null, endorsedToId: null } });
  });
  await audit({ userId: user.id, action: "cheque.reverted", entityType: "Cheque", entityId: id });
}

export async function deleteCheque(user: CurrentUser, id: string) {
  const ch = await db.cheque.findUnique({ where: { id }, select: { direction: true, status: true } });
  if (!ch) throw new AppError("NOT_FOUND", "Çek bulunamadı.");
  writePerms(ch.direction, user);
  if (ch.status !== INITIAL[ch.direction]) throw new AppError("CONFLICT", "Önce çekin son işlemini geri alın.");
  await db.cheque.delete({ where: { id } });
  await audit({ userId: user.id, action: "cheque.deleted", entityType: "Cheque", entityId: id });
  return ch.direction;
}

export interface ChequeFilter {
  direction?: ChequeDirection;
  status?: ChequeStatus | "open" | "overdue";
  q?: string;
  page?: number;
}

export async function listCheques(user: CurrentUser, f: ChequeFilter = {}) {
  assertCan(user, "cash.read");
  const today = startOfToday();
  const where: Prisma.ChequeWhereInput = {};
  if (f.direction) where.direction = f.direction;
  if (f.status === "open") where.status = { in: ["PORTFOLIO", "PENDING"] };
  else if (f.status === "overdue") Object.assign(where, { status: { in: ["PORTFOLIO", "PENDING"] }, dueDate: { lt: today } });
  else if (f.status) where.status = f.status;
  if (f.q?.trim()) {
    const q = f.q.trim();
    where.OR = [
      { chequeNo: { contains: q, mode: "insensitive" } },
      { bankName: { contains: q, mode: "insensitive" } },
      { drawer: { contains: q, mode: "insensitive" } },
      { contact: { title: { contains: q, mode: "insensitive" } } },
    ];
  }
  const page = Math.max(1, f.page ?? 1);
  const [total, rows, open] = await Promise.all([
    db.cheque.count({ where }),
    db.cheque.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      skip: (page - 1) * CHEQUES_PAGE_SIZE,
      take: CHEQUES_PAGE_SIZE,
      include: { contact: { select: { id: true, title: true, kind: true } }, endorsedTo: { select: { id: true, title: true } }, account: { select: { id: true, name: true } } },
    }),
    db.cheque.groupBy({ by: ["direction", "currency"], where: { ...where, status: { in: ["PORTFOLIO", "PENDING"] } }, _sum: { amount: true } }),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, overdue: (r.status === "PORTFOLIO" || r.status === "PENDING") && r.dueDate < today })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / CHEQUES_PAGE_SIZE)),
    openTotals: open.map((o) => ({ direction: o.direction, currency: o.currency, total: D(o._sum.amount) })),
  };
}

export async function getCheque(user: CurrentUser, id: string) {
  assertCan(user, "cash.read");
  const ch = await db.cheque.findUnique({
    where: { id },
    include: {
      contact: { select: { id: true, title: true, kind: true } },
      endorsedTo: { select: { id: true, title: true } },
      invoice: { select: { id: true, direction: true, invoiceNo: true, name: true } },
      account: { select: { id: true, name: true } },
      transactions: { orderBy: [{ date: "asc" }, { createdAt: "asc" }], include: { account: { select: { id: true, name: true } }, contact: { select: { id: true, title: true, kind: true } }, invoice: { select: { id: true, direction: true, invoiceNo: true, name: true } } } },
    },
  });
  if (!ch) throw new AppError("NOT_FOUND", "Çek bulunamadı.");
  return { ...ch, initial: ch.status === INITIAL[ch.direction], overdue: ch.status === INITIAL[ch.direction] && ch.dueDate < startOfToday() };
}
