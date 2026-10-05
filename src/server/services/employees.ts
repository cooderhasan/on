import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { optText } from "@/lib/validation";
import { checkTaxId } from "@/lib/tax-id";
import { isValidIban, normalizeIban } from "@/lib/iban";
import { employeeBalances } from "./ledger";

const D = (v: { toString(): string } | null | undefined) => new Decimal(v?.toString() ?? 0);

export const employeeSchema = z.object({
  name: z.string().trim().min(2, "Ad soyad girin.").max(150),
  tckn: z
    .string()
    .optional()
    .transform((v) => v?.replace(/\s/g, "") || null)
    .superRefine((v, ctx) => {
      if (v === null) return;
      const r = checkTaxId(v);
      if (!r.ok || r.kind !== "TCKN") ctx.addIssue({ code: "custom", message: r.ok ? "11 haneli T.C. kimlik no girin." : r.message });
    }),
  email: optText(150),
  phone: optText(30),
  iban: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? normalizeIban(v) : null))
    .refine((v) => v === null || isValidIban(v), "IBAN geçersiz."),
  categoryId: optText(50),
  startDate: z.string().optional().transform((v) => v?.trim() || null),
  notes: optText(1000),
});

export async function listEmployees(user: CurrentUser, opts: { archived?: boolean; q?: string } = {}) {
  assertCan(user, "expenses.read");
  const rows = await db.employee.findMany({
    where: { isArchived: Boolean(opts.archived), ...(opts.q?.trim() ? { name: { contains: opts.q.trim(), mode: "insensitive" as const } } : {}) },
    orderBy: { name: "asc" },
    include: { category: { select: { name: true, color: true } } },
  });
  const balances = await employeeBalances(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, balance: balances.get(r.id)! }));
}

export async function getEmployee(user: CurrentUser, id: string) {
  assertCan(user, "expenses.read");
  const e = await db.employee.findUnique({
    where: { id },
    include: {
      category: true,
      expenses: { orderBy: { date: "desc" }, select: { id: true, date: true, description: true, totalAmount: true } },
      transactions: { orderBy: { date: "desc" }, select: { id: true, date: true, appliedAmount: true, description: true, expenseId: true, account: { select: { name: true } } } },
    },
  });
  if (!e) throw new AppError("NOT_FOUND", "Çalışan bulunamadı.");
  const balance = (await employeeBalances([id])).get(id)!;
  // Hareketler: tahakkuk (−) ve ödeme (+), en yeni üstte
  const movements = [
    ...e.expenses.map((x) => ({ id: x.id, date: x.date, label: x.description, href: `/giderler/kayit/${x.id}`, amount: D(x.totalAmount).negated(), kind: "Tahakkuk" as const })),
    ...e.transactions.map((t) => ({ id: t.id, date: t.date, label: [t.account.name, t.description].filter(Boolean).join(" · "), href: null, amount: D(t.appliedAmount), kind: t.expenseId ? ("Ödeme" as const) : ("Avans / ödeme" as const) })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
  return { ...e, balance, movements };
}

async function assertCategory(categoryId: string | null) {
  if (!categoryId) return;
  const c = await db.category.findUnique({ where: { id: categoryId }, select: { type: true } });
  if (!c || c.type !== "EMPLOYEE") throw new AppError("VALIDATION", "Kategori geçersiz.", { categoryId: "Geçersiz" });
}

export async function saveEmployee(user: CurrentUser, id: string | null, input: z.infer<typeof employeeSchema>) {
  assertCan(user, "expenses.write");
  await assertCategory(input.categoryId);
  const data = { ...input, startDate: input.startDate ? new Date(input.startDate) : null };
  const e = id ? await db.employee.update({ where: { id }, data }) : await db.employee.create({ data });
  await audit({ userId: user.id, action: id ? "employee.updated" : "employee.created", entityType: "Employee", entityId: e.id });
  return e;
}

export async function setEmployeeArchived(user: CurrentUser, id: string, archived: boolean) {
  assertCan(user, "expenses.write");
  const res = await db.employee.updateMany({ where: { id }, data: { isArchived: archived } });
  if (!res.count) throw new AppError("NOT_FOUND", "Çalışan bulunamadı.");
  await audit({ userId: user.id, action: archived ? "employee.archived" : "employee.unarchived", entityType: "Employee", entityId: id });
}
