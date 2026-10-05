import "server-only";
import type { z } from "zod";
import type { ContactKind } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan, type Permission } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { money } from "@/lib/money";
import { contactBalance, contactBalances } from "./ledger";
import type { contactSchema, parseRepeated } from "@/lib/validation";

export const PAGE_SIZE = 25;

/** Müşteri satışa, tedarikçi gidere bağlı yetki ister */
const writePerm = (kind: ContactKind): Permission => (kind === "CUSTOMER" ? "sales.write" : "expenses.write");
const readPerm = (kind: ContactKind): Permission => (kind === "CUSTOMER" ? "sales.read" : "expenses.read");

export const KIND_LABELS: Record<ContactKind, { plural: string; single: string; path: string }> = {
  CUSTOMER: { plural: "Müşteriler", single: "Müşteri", path: "/musteriler" },
  SUPPLIER: { plural: "Tedarikçiler", single: "Tedarikçi", path: "/tedarikciler" },
};

export interface ContactFilter {
  q?: string;
  archived?: boolean;
  categoryId?: string;
  sort?: "title" | "new";
  page?: number;
}

export async function listContacts(user: CurrentUser, kind: ContactKind, f: ContactFilter = {}) {
  assertCan(user, readPerm(kind));
  const where: Prisma.ContactWhereInput = { kind, isArchived: Boolean(f.archived) };
  if (f.categoryId) where.categoryId = f.categoryId;
  if (f.q?.trim()) {
    const q = f.q.trim();
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { shortName: { contains: q, mode: "insensitive" } },
      { taxNumber: { contains: q.replace(/\s/g, "") } },
      { phone: { contains: q } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.contact.findMany({
      where,
      orderBy: f.sort === "new" ? { createdAt: "desc" } : { title: "asc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: { category: { select: { name: true, color: true } } },
    }),
    db.contact.count({ where }),
  ]);
  const balances = await contactBalances(rows.map((r) => r.id));
  return { rows: rows.map((r) => ({ ...r, balance: balances.get(r.id)! })), total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}


export async function getContact(user: CurrentUser, id: string) {
  const c = await db.contact.findUnique({
    where: { id },
    include: { category: true, ibans: true, people: { orderBy: { name: "asc" } } },
  });
  if (!c) throw new AppError("NOT_FOUND", "Kayıt bulunamadı.");
  assertCan(user, readPerm(c.kind));
  return { ...c, balance: await contactBalance(c.id) };
}

type ContactInput = z.infer<typeof contactSchema>;
type Repeated = ReturnType<typeof parseRepeated>;

function toData(input: ContactInput) {
  const { hasOpeningBalance, openingBalance, openingBalanceSide, openingBalanceDate, kind: _kind, ...rest } = input;
  void _kind;
  return {
    ...rest,
    // Yurt dışı cari için il / ilçe yerine ülke
    country: input.isAbroad ? input.country : null,
    // Fiyat listesi yalnızca müşteride
    priceListId: input.kind === "CUSTOMER" ? input.priceListId : null,
    openingBalance: hasOpeningBalance ? openingBalance : null,
    openingBalanceSide: hasOpeningBalance ? (openingBalanceSide ?? "DEBIT") : null,
    openingBalanceDate: hasOpeningBalance && openingBalanceDate ? new Date(openingBalanceDate) : null,
  };
}

async function assertPriceList(priceListId: string | null) {
  if (!priceListId) return;
  const l = await db.priceList.findUnique({ where: { id: priceListId }, select: { isArchived: true } });
  if (!l) throw new AppError("VALIDATION", "Fiyat listesi bulunamadı.", { priceListId: "Geçersiz" });
}

async function assertCategory(categoryId: string | null) {
  if (!categoryId) return;
  const c = await db.category.findUnique({ where: { id: categoryId }, select: { type: true } });
  if (!c || c.type !== "CONTACT") throw new AppError("VALIDATION", "Kategori geçersiz.", { categoryId: "Geçersiz kategori" });
}

/** Aynı VKN/TCKN ile ikinci kayıt engellenir (genel nihai tüketici numaraları hariç). */
async function assertUniqueTaxNumber(kind: ContactKind, taxNumber: string | null, exceptId?: string) {
  if (!taxNumber || taxNumber === "11111111111" || taxNumber === "2222222222") return;
  const dup = await db.contact.findFirst({ where: { kind, taxNumber, id: exceptId ? { not: exceptId } : undefined }, select: { id: true, title: true } });
  if (dup) throw new AppError("CONFLICT", `Bu VKN/TCKN ile kayıtlı bir cari var: ${dup.title}`, { taxNumber: "Bu numara zaten kayıtlı" });
}

export async function createContact(user: CurrentUser, input: ContactInput, rep: Repeated) {
  assertCan(user, writePerm(input.kind));
  await assertCategory(input.categoryId);
  await assertPriceList(input.priceListId);
  await assertUniqueTaxNumber(input.kind, input.taxNumber);
  const c = await db.contact.create({
    data: {
      kind: input.kind,
      ...toData(input),
      ibans: { create: rep.ibans.map((iban) => ({ iban })) },
      people: { create: rep.people },
    },
  });
  await audit({ userId: user.id, action: "contact.created", entityType: "Contact", entityId: c.id, metadata: { kind: c.kind } });
  return c;
}

export async function updateContact(user: CurrentUser, id: string, input: ContactInput, rep: Repeated) {
  const existing = await db.contact.findUnique({ where: { id }, select: { kind: true } });
  if (!existing) throw new AppError("NOT_FOUND", "Kayıt bulunamadı.");
  // Tür formdan değiştirilemez (müşteri listesinden gelen kayıt tedarikçiye dönmesin)
  if (existing.kind !== input.kind) throw new AppError("VALIDATION", "Kayıt türü değiştirilemez.");
  assertCan(user, writePerm(existing.kind));
  await assertCategory(input.categoryId);
  await assertPriceList(input.priceListId);
  await assertUniqueTaxNumber(existing.kind, input.taxNumber, id);
  // IBAN ve yetkililer formdaki listeyle değiştirilir (tek işlem)
  const c = await db.$transaction(async (tx) => {
    await tx.contactIban.deleteMany({ where: { contactId: id } });
    await tx.contactPerson.deleteMany({ where: { contactId: id } });
    return tx.contact.update({
      where: { id },
      data: { ...toData(input), ibans: { create: rep.ibans.map((iban) => ({ iban })) }, people: { create: rep.people } },
    });
  });
  await audit({ userId: user.id, action: "contact.updated", entityType: "Contact", entityId: id });
  return c;
}

/** Arşivleme: kayıt silinmez, listeden kalkar (faturası olan cari silinemez — Faz 2 ile zorunlu olacak). */
export async function setContactArchived(user: CurrentUser, id: string, archived: boolean) {
  const c = await db.contact.findUnique({ where: { id }, select: { kind: true } });
  if (!c) throw new AppError("NOT_FOUND", "Kayıt bulunamadı.");
  assertCan(user, writePerm(c.kind));
  await db.contact.update({ where: { id }, data: { isArchived: archived } });
  await audit({ userId: user.id, action: archived ? "contact.archived" : "contact.unarchived", entityType: "Contact", entityId: id });
  return c.kind;
}

/** Liste altı toplamları (Paraşüt: tahsil edilecek / ödenecek) */
export async function contactTotals(kind: ContactKind) {
  const ids = (await db.contact.findMany({ where: { kind, isArchived: false }, select: { id: true } })).map((c) => c.id);
  const balances = await contactBalances(ids);
  let receivable = money(0);
  let payable = money(0);
  for (const b of balances.values()) {
    if (b.greaterThan(0)) receivable = receivable.plus(b);
    else if (b.lessThan(0)) payable = payable.plus(b.abs());
  }
  return { receivable, payable };
}
