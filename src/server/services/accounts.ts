import "server-only";
import type { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { money } from "@/lib/money";
import { accountBalances } from "./ledger";
import type { accountSchema } from "@/lib/validation";

/** Hesaplar ve bakiyeleri (açılış + hareketler; bkz. ledger.ts) */
export async function listAccounts(user: CurrentUser, opts: { archived?: boolean } = {}) {
  assertCan(user, "cash.read");
  const rows = await db.account.findMany({ where: { isArchived: Boolean(opts.archived) }, orderBy: [{ type: "asc" }, { name: "asc" }] });
  const balances = await accountBalances(rows.map((a) => a.id));
  const rowsWithBalance = rows.map((a) => ({ ...a, balance: balances.get(a.id)! }));
  // Para birimi bazında net toplam (farklı dövizler toplanmaz)
  const totals = new Map<string, ReturnType<typeof money>>();
  for (const a of rowsWithBalance) totals.set(a.currency, (totals.get(a.currency) ?? money(0)).plus(a.balance));
  return { rows: rowsWithBalance, totals: [...totals].map(([currency, total]) => ({ currency, total })) };
}

export async function getAccount(user: CurrentUser, id: string) {
  assertCan(user, "cash.read");
  const a = await db.account.findUnique({ where: { id } });
  if (!a) throw new AppError("NOT_FOUND", "Hesap bulunamadı.");
  return { ...a, balance: (await accountBalances([a.id])).get(a.id)! };
}

type AccountInput = z.infer<typeof accountSchema>;

function toData(input: AccountInput) {
  return {
    ...input,
    // Kasa hesabında banka alanları tutulmaz
    bankName: input.type === "BANK" ? input.bankName : null,
    branch: input.type === "BANK" ? input.branch : null,
    accountNo: input.type === "BANK" ? input.accountNo : null,
    iban: input.type === "BANK" ? input.iban : null,
    openingBalance: input.openingBalance ?? "0",
    openingDate: input.openingDate ? new Date(input.openingDate) : null,
  };
}

export async function createAccount(user: CurrentUser, input: AccountInput) {
  assertCan(user, "cash.write");
  const a = await db.account.create({ data: toData(input) });
  await audit({ userId: user.id, action: "account.created", entityType: "Account", entityId: a.id });
  return a;
}

export async function updateAccount(user: CurrentUser, id: string, input: AccountInput) {
  assertCan(user, "cash.write");
  const existing = await db.account.findUnique({ where: { id }, select: { type: true, currency: true } });
  if (!existing) throw new AppError("NOT_FOUND", "Hesap bulunamadı.");
  if (existing.type !== input.type) throw new AppError("VALIDATION", "Hesap türü (kasa / banka) değiştirilemez.");
  const a = await db.account.update({ where: { id }, data: toData(input) });
  await audit({ userId: user.id, action: "account.updated", entityType: "Account", entityId: id });
  return a;
}

export async function setAccountArchived(user: CurrentUser, id: string, archived: boolean) {
  assertCan(user, "cash.write");
  const res = await db.account.updateMany({ where: { id }, data: { isArchived: archived } });
  if (!res.count) throw new AppError("NOT_FOUND", "Hesap bulunamadı.");
  await audit({ userId: user.id, action: archived ? "account.archived" : "account.unarchived", entityType: "Account", entityId: id });
}
