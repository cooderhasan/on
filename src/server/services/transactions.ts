import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { optDecimal, optText } from "@/lib/validation";
import { invoiceSign } from "./ledger";

const D = (v: { toString(): string } | null | undefined) => new Decimal(v?.toString() ?? 0);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih girin.");
const amount = (label: string) => optDecimal({ min: 0, label }).refine((v) => v !== null && new Decimal(v).greaterThan(0), `${label} girin.`);

/** Fatura / cari tahsilatı veya ödemesi */
export const settlementSchema = z.object({
  invoiceId: optText(50),
  /** Fatura dışı gider (hızlı fiş, maaş, vergi, banka gideri) */
  expenseId: optText(50),
  contactId: optText(50),
  /** Çalışana doğrudan ödeme (avans / maaş) */
  employeeId: optText(50),
  accountId: z.string().min(1, "Kasa / banka hesabı seçin."),
  date,
  amount: amount("Tutar"),
  /** Hesap dövizi fatura / cari dövizinden farklıysa cariye yansıyan tutar */
  appliedAmount: optDecimal({ min: 0, label: "Cariye yansıyan tutar" }),
  description: optText(300),
});

export const transferSchema = z.object({
  accountId: z.string().min(1, "Çıkış hesabını seçin."),
  targetAccountId: z.string().min(1, "Giriş hesabını seçin."),
  date,
  amount: amount("Tutar"),
  targetAmount: optDecimal({ min: 0, label: "Giriş tutarı" }),
  description: optText(300),
});

export const cashMoveSchema = z.object({
  type: z.enum(["DEPOSIT", "WITHDRAWAL"]),
  accountId: z.string().min(1, "Hesap seçin."),
  date,
  amount: amount("Tutar"),
  description: optText(300).refine((v) => v !== null, "Açıklama girin (ör. ortak sermaye, banka masrafı)."),
});

/**
 * Faturaya veya doğrudan cariye tahsilat / ödeme.
 *  - Satış faturası / alış iadesi → tahsilat (para girer)
 *  - Alış faturası / satış iadesi → ödeme (para çıkar)
 * Faturanın kalanından fazlası girilemez.
 */
export async function createSettlement(user: CurrentUser, input: z.infer<typeof settlementSchema>) {
  const account = await db.account.findUnique({ where: { id: input.accountId }, select: { id: true, currency: true, isArchived: true } });
  if (!account || account.isArchived) throw new AppError("VALIDATION", "Hesap bulunamadı.", { accountId: "Seçin" });

  let contactId = input.contactId;
  let employeeId = input.employeeId;
  let docCurrency: string;
  let type: "COLLECTION" | "PAYMENT";
  let remaining: Decimal | null = null;

  if (input.invoiceId) {
    const inv = await db.invoice.findUnique({
      where: { id: input.invoiceId },
      select: { id: true, direction: true, kind: true, contactId: true, currency: true, payableTotal: true, transactions: { select: { appliedAmount: true } } },
    });
    if (!inv) throw new AppError("NOT_FOUND", "Fatura bulunamadı.");
    assertCan(user, inv.direction === "SALE" ? "sales.write" : "expenses.write");
    assertCan(user, "cash.write");
    contactId = inv.contactId;
    docCurrency = inv.currency;
    type = invoiceSign(inv.direction, inv.kind) > 0 ? "COLLECTION" : "PAYMENT";
    remaining = D(inv.payableTotal).minus(inv.transactions.reduce((a, t) => a.plus(D(t.appliedAmount)), new Decimal(0)));
  } else if (input.expenseId) {
    const e = await db.expense.findUnique({ where: { id: input.expenseId }, select: { contactId: true, employeeId: true, currency: true, totalAmount: true, transactions: { select: { appliedAmount: true } } } });
    if (!e) throw new AppError("NOT_FOUND", "Gider bulunamadı.");
    assertCan(user, "expenses.write");
    assertCan(user, "cash.write");
    contactId = e.contactId;
    employeeId = e.employeeId;
    docCurrency = e.currency;
    type = "PAYMENT";
    remaining = D(e.totalAmount).minus(e.transactions.reduce((a, t) => a.plus(D(t.appliedAmount)), new Decimal(0)));
  } else if (input.employeeId) {
    const emp = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } });
    if (!emp) throw new AppError("NOT_FOUND", "Çalışan bulunamadı.");
    assertCan(user, "expenses.write");
    assertCan(user, "cash.write");
    contactId = null;
    docCurrency = "TRY";
    type = "PAYMENT";
  } else {
    if (!contactId) throw new AppError("VALIDATION", "Cari seçin.");
    const c = await db.contact.findUnique({ where: { id: contactId }, select: { kind: true, currency: true } });
    if (!c) throw new AppError("NOT_FOUND", "Cari bulunamadı.");
    assertCan(user, c.kind === "CUSTOMER" ? "sales.write" : "expenses.write");
    assertCan(user, "cash.write");
    docCurrency = c.currency;
    type = c.kind === "CUSTOMER" ? "COLLECTION" : "PAYMENT";
  }

  const amt = new Decimal(input.amount!);
  let applied: Decimal;
  if (account.currency === docCurrency) applied = amt;
  else {
    if (!input.appliedAmount) throw new AppError("VALIDATION", `Hesap ${account.currency}, belge ${docCurrency}. Cariye yansıyacak ${docCurrency} tutarını girin.`, { appliedAmount: "Gerekli" });
    applied = new Decimal(input.appliedAmount);
  }
  if (remaining !== null && applied.greaterThan(remaining)) {
    throw new AppError("VALIDATION", `Kalan tutar ${formatMoney(remaining, docCurrency)}. Daha fazlası girilemez.`, { amount: "Kalanı aşıyor" });
  }

  const tx = await db.transaction.create({
    data: {
      type,
      date: new Date(input.date),
      accountId: account.id,
      contactId,
      invoiceId: input.invoiceId,
      expenseId: input.invoiceId ? null : input.expenseId,
      employeeId,
      amount: amt.toString(),
      appliedAmount: applied.toString(),
      description: input.description,
      createdById: user.id,
    },
  });
  await audit({ userId: user.id, action: `transaction.${type.toLowerCase()}`, entityType: "Transaction", entityId: tx.id, metadata: { invoiceId: input.invoiceId, amount: amt.toString() } });
  return tx;
}

export async function createTransfer(user: CurrentUser, input: z.infer<typeof transferSchema>) {
  assertCan(user, "cash.write");
  if (input.accountId === input.targetAccountId) throw new AppError("VALIDATION", "Çıkış ve giriş hesabı aynı olamaz.", { targetAccountId: "Farklı hesap seçin" });
  const [from, to] = await Promise.all([
    db.account.findUnique({ where: { id: input.accountId }, select: { currency: true } }),
    db.account.findUnique({ where: { id: input.targetAccountId }, select: { currency: true } }),
  ]);
  if (!from || !to) throw new AppError("NOT_FOUND", "Hesap bulunamadı.");
  const amt = new Decimal(input.amount!);
  let target = amt;
  if (from.currency !== to.currency) {
    if (!input.targetAmount) throw new AppError("VALIDATION", `Farklı döviz: giriş hesabına geçen ${to.currency} tutarını girin.`, { targetAmount: "Gerekli" });
    target = new Decimal(input.targetAmount);
  }
  const tx = await db.transaction.create({
    data: { type: "TRANSFER", date: new Date(input.date), accountId: input.accountId, targetAccountId: input.targetAccountId, amount: amt.toString(), appliedAmount: "0", targetAmount: target.toString(), description: input.description, createdById: user.id },
  });
  await audit({ userId: user.id, action: "transaction.transfer", entityType: "Transaction", entityId: tx.id });
  return tx;
}

export async function createCashMove(user: CurrentUser, input: z.infer<typeof cashMoveSchema>) {
  assertCan(user, "cash.write");
  const acc = await db.account.findUnique({ where: { id: input.accountId }, select: { id: true } });
  if (!acc) throw new AppError("NOT_FOUND", "Hesap bulunamadı.");
  const tx = await db.transaction.create({
    data: { type: input.type, date: new Date(input.date), accountId: input.accountId, amount: input.amount!, appliedAmount: "0", description: input.description, createdById: user.id },
  });
  await audit({ userId: user.id, action: `transaction.${input.type.toLowerCase()}`, entityType: "Transaction", entityId: tx.id });
  return tx;
}

export async function deleteTransaction(user: CurrentUser, id: string) {
  const t = await db.transaction.findUnique({ where: { id }, select: { type: true, invoiceId: true, contactId: true, chequeId: true, invoice: { select: { direction: true, eDocStatus: true } } } });
  if (!t) throw new AppError("NOT_FOUND", "Hareket bulunamadı.");
  if (t.chequeId) throw new AppError("CONFLICT", "Çek hareketi Çekler ekranından geri alınır.");
  assertCan(user, "cash.write");
  if (t.invoice) assertCan(user, t.invoice.direction === "SALE" ? "sales.write" : "expenses.write");
  await db.transaction.delete({ where: { id } });
  await audit({ userId: user.id, action: "transaction.deleted", entityType: "Transaction", entityId: id, metadata: { type: t.type, invoiceId: t.invoiceId } });
  return t;
}

/** Hesap hareketleri (kasa / banka detayında), yürüyen bakiye ile */
export async function accountMovements(user: CurrentUser, accountId: string) {
  assertCan(user, "cash.read");
  const account = await db.account.findUnique({ where: { id: accountId }, select: { openingBalance: true, openingDate: true, createdAt: true } });
  if (!account) throw new AppError("NOT_FOUND", "Hesap bulunamadı.");
  const rows = await db.transaction.findMany({
    where: { OR: [{ accountId }, { targetAccountId: accountId }] },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: {
      contact: { select: { id: true, title: true, kind: true } },
      invoice: { select: { id: true, name: true, invoiceNo: true, direction: true } },
      expense: { select: { id: true, description: true } },
      employee: { select: { id: true, name: true } },
      cheque: { select: { id: true, chequeNo: true, direction: true, contactId: true, contact: { select: { title: true } } } },
      account: { select: { name: true } },
      targetAccount: { select: { name: true } },
    },
  });
  let bal = D(account.openingBalance);
  const out = rows.map((r) => {
    const incoming = r.type === "TRANSFER" ? r.targetAccountId === accountId : r.type === "COLLECTION" || r.type === "DEPOSIT";
    const value = r.type === "TRANSFER" && incoming ? D(r.targetAmount) : D(r.amount);
    bal = incoming ? bal.plus(value) : bal.minus(value);
    return { ...r, incoming, value, balance: bal };
  });
  return out.reverse();
}

export type MovementRow = Awaited<ReturnType<typeof accountMovements>>[number];
