import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";
import type { ExpenseKind } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { optDecimal, optText } from "@/lib/validation";
import { VAT_RATES } from "@/lib/units";
import { isVoidEDoc } from "@/lib/edoc-status";
import { startOfToday } from "./invoices";

const D = (v: { toString(): string } | null | undefined) => new Decimal(v?.toString() ?? 0);
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  RECEIPT: "Fiş / fatura",
  SALARY: "Maaş / prim",
  TAX: "Vergi / SGK primi",
  BANK_FEE: "Banka gideri",
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih girin.");

export const expenseSchema = z
  .object({
    kind: z.enum(["RECEIPT", "SALARY", "TAX", "BANK_FEE"]),
    description: z.string().trim().min(1, "Açıklama girin.").max(300),
    date,
    dueDate: z.string().optional().transform((v) => v?.trim() || null),
    categoryId: optText(50),
    contactId: optText(50),
    employeeId: optText(50),
    /** KDV dahil toplam tutar */
    totalAmount: optDecimal({ min: 0, label: "Tutar" }).refine((v) => v !== null && new Decimal(v).greaterThan(0), "Tutarı girin."),
    vatRate: z.coerce.number().default(0).refine((n) => (VAT_RATES as readonly number[]).includes(n), "KDV oranı seçin."),
    receiptNo: optText(40),
  })
  .superRefine((v, ctx) => {
    if (v.dueDate && v.dueDate < v.date) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Ödeme tarihi kayıt tarihinden önce olamaz." });
    if (v.kind === "SALARY" && !v.employeeId) ctx.addIssue({ code: "custom", path: ["employeeId"], message: "Çalışan seçin." });
  });

/** KDV dahil tutardan matrah ve KDV (Paraşüt hızlı fiş: tutar KDV dahil girilir) */
export function splitVat(total: Decimal.Value, rate: number) {
  const t = r2(new Decimal(total));
  const net = r2(t.times(100).dividedBy(100 + rate));
  return { net, vat: t.minus(net), total: t };
}

async function assertRefs(input: z.infer<typeof expenseSchema>) {
  if (input.categoryId) {
    const c = await db.category.findUnique({ where: { id: input.categoryId }, select: { type: true } });
    if (!c || c.type !== "EXPENSE") throw new AppError("VALIDATION", "Kategori geçersiz.", { categoryId: "Geçersiz" });
  }
  if (input.contactId) {
    const c = await db.contact.findUnique({ where: { id: input.contactId }, select: { kind: true } });
    if (!c || c.kind !== "SUPPLIER") throw new AppError("VALIDATION", "Tedarikçi geçersiz.", { contactId: "Geçersiz" });
  }
  if (input.employeeId && !(await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } }))) {
    throw new AppError("VALIDATION", "Çalışan bulunamadı.", { employeeId: "Geçersiz" });
  }
}

function toData(input: z.infer<typeof expenseSchema>) {
  const rate = input.kind === "RECEIPT" ? input.vatRate : 0;
  const { net, vat, total } = splitVat(input.totalAmount!, rate);
  return {
    kind: input.kind,
    description: input.description,
    date: new Date(input.date),
    dueDate: new Date(input.dueDate ?? input.date),
    categoryId: input.categoryId,
    // Tedarikçi yalnızca fişte, çalışan yalnızca maaşta
    contactId: input.kind === "RECEIPT" ? input.contactId : null,
    employeeId: input.kind === "SALARY" ? input.employeeId : null,
    netAmount: net.toString(),
    vatRate: rate,
    vatAmount: vat.toString(),
    totalAmount: total.toString(),
    receiptNo: input.receiptNo,
  };
}

export async function saveExpense(user: CurrentUser, id: string | null, input: z.infer<typeof expenseSchema>) {
  assertCan(user, "expenses.write");
  await assertRefs(input);
  const data = toData(input);
  let saved;
  if (id) {
    const ex = await db.expense.findUnique({ where: { id }, select: { transactions: { select: { appliedAmount: true } } } });
    if (!ex) throw new AppError("NOT_FOUND", "Gider bulunamadı.");
    const paid = ex.transactions.reduce((a, t) => a.plus(D(t.appliedAmount)), new Decimal(0));
    if (new Decimal(data.totalAmount).lessThan(paid)) throw new AppError("VALIDATION", "Tutar, yapılmış ödemelerin altına düşemez. Önce ödemeyi düzeltin.");
    saved = await db.expense.update({ where: { id }, data });
  } else {
    saved = await db.expense.create({ data: { ...data, createdById: user.id } });
  }
  await audit({ userId: user.id, action: id ? "expense.updated" : "expense.created", entityType: "Expense", entityId: saved.id, metadata: { kind: saved.kind, total: data.totalAmount } });
  return saved;
}

export async function getExpense(user: CurrentUser, id: string) {
  assertCan(user, "expenses.read");
  const e = await db.expense.findUnique({
    where: { id },
    include: { category: true, contact: { select: { id: true, title: true } }, employee: { select: { id: true, name: true } }, transactions: { orderBy: { date: "asc" }, include: { account: { select: { id: true, name: true, currency: true } } } } },
  });
  if (!e) throw new AppError("NOT_FOUND", "Gider bulunamadı.");
  const paid = e.transactions.reduce((a, t) => a.plus(D(t.appliedAmount)), new Decimal(0));
  const remaining = D(e.totalAmount).minus(paid);
  return { ...e, paid, remaining, overdue: remaining.greaterThan(0) && e.dueDate < startOfToday() };
}

export async function deleteExpense(user: CurrentUser, id: string) {
  assertCan(user, "expenses.write");
  const e = await db.expense.findUnique({ where: { id }, select: { _count: { select: { transactions: true } } } });
  if (!e) throw new AppError("NOT_FOUND", "Gider bulunamadı.");
  if (e._count.transactions > 0) throw new AppError("CONFLICT", "Bu gidere bağlı ödeme var. Önce ödemeyi silin.");
  await db.expense.delete({ where: { id } });
  await audit({ userId: user.id, action: "expense.deleted", entityType: "Expense", entityId: id });
}

// ── Gider listesi: alış faturaları + fatura dışı giderler ──

export interface ExpenseRow {
  id: string;
  href: string;
  kindLabel: string;
  title: string;
  party: string | null;
  date: Date;
  dueDate: Date;
  currency: string;
  total: Decimal;
  remaining: Decimal;
  overdue: boolean;
  isReturn: boolean;
  category: { name: string; color: string } | null;
}

export const PAGE_SIZE = 25;

export async function listExpenseRows(user: CurrentUser, f: { q?: string; payment?: "open" | "overdue" | "paid"; kind?: "INVOICE" | ExpenseKind; from?: string; to?: string; page?: number } = {}) {
  assertCan(user, "expenses.read");
  const dateWhere = f.from || f.to ? { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(f.to) } : {}) } : undefined;
  const q = f.q?.trim();
  const invWhere: Prisma.InvoiceWhereInput = { direction: "PURCHASE", ...(dateWhere ? { issueDate: dateWhere } : {}) };
  if (q) invWhere.OR = [{ name: { contains: q, mode: "insensitive" } }, { invoiceNo: { contains: q, mode: "insensitive" } }, { contact: { title: { contains: q, mode: "insensitive" } } }];
  const expWhere: Prisma.ExpenseWhereInput = { ...(dateWhere ? { date: dateWhere } : {}) };
  if (f.kind && f.kind !== "INVOICE") expWhere.kind = f.kind;
  if (q) expWhere.OR = [{ description: { contains: q, mode: "insensitive" } }, { receiptNo: { contains: q, mode: "insensitive" } }, { contact: { title: { contains: q, mode: "insensitive" } } }, { employee: { name: { contains: q, mode: "insensitive" } } }];

  const [invoices, expenses] = await Promise.all([
    !f.kind || f.kind === "INVOICE"
      ? db.invoice.findMany({ where: invWhere, select: { id: true, name: true, invoiceNo: true, kind: true, issueDate: true, dueDate: true, currency: true, payableTotal: true, eDocStatus: true, contact: { select: { title: true } }, category: { select: { name: true, color: true } }, transactions: { select: { appliedAmount: true } } } })
      : Promise.resolve([]),
    f.kind === "INVOICE" ? Promise.resolve([]) : db.expense.findMany({ where: expWhere, include: { contact: { select: { title: true } }, employee: { select: { name: true } }, category: { select: { name: true, color: true } }, transactions: { select: { appliedAmount: true } } } }),
  ]);
  const today = startOfToday();
  const paidOf = (ts: Array<{ appliedAmount: { toString(): string } }>) => ts.reduce((a, t) => a.plus(D(t.appliedAmount)), new Decimal(0));
  let rows: ExpenseRow[] = [
    ...invoices.map((i) => {
      const remaining = isVoidEDoc(i.eDocStatus) ? new Decimal(0) : D(i.payableTotal).minus(paidOf(i.transactions));
      return { id: i.id, href: `/giderler/${i.id}`, kindLabel: i.kind === "RETURN" ? "Alış iadesi" : "Alış faturası", title: i.name || i.invoiceNo || (i.kind === "RETURN" ? "İade faturası" : "Alış faturası"), party: i.contact.title, date: i.issueDate, dueDate: i.dueDate, currency: i.currency, total: D(i.payableTotal), remaining, overdue: remaining.greaterThan(0) && i.dueDate < today, isReturn: i.kind === "RETURN", category: i.category };
    }),
    ...expenses.map((e) => {
      const remaining = D(e.totalAmount).minus(paidOf(e.transactions));
      return { id: e.id, href: `/giderler/kayit/${e.id}`, kindLabel: EXPENSE_KIND_LABELS[e.kind], title: e.description, party: e.contact?.title ?? e.employee?.name ?? null, date: e.date, dueDate: e.dueDate, currency: e.currency, total: D(e.totalAmount), remaining, overdue: remaining.greaterThan(0) && e.dueDate < today, isReturn: false, category: e.category };
    }),
  ];
  rows = rows.filter((r) => (f.payment === "paid" ? !r.remaining.greaterThan(0) : f.payment === "open" ? r.remaining.greaterThan(0) : f.payment === "overdue" ? r.overdue : true));
  rows.sort((a, b) => b.date.getTime() - a.date.getTime());
  const page = Math.max(1, f.page ?? 1);
  const sum = (pick: (r: ExpenseRow) => Decimal) => rows.reduce((a, r) => a.plus(pick(r).times(r.isReturn ? -1 : 1)), new Decimal(0));
  return { rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), totals: { total: sum((r) => r.total), remaining: sum((r) => r.remaining) } };
}
