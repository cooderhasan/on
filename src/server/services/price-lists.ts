import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { parseMoneyInput } from "@/lib/money";
import { CURRENCIES } from "@/lib/units";
import { optText } from "@/lib/validation";
import { isUniqueViolation } from "@/server/prisma-errors";

/** Fiyat listesi: müşteriye bağlanır; satış faturası / teklifte ürün seçilince birim fiyat listeden gelir (vergiler hariç). */

export const priceListSchema = z.object({
  name: z.string().trim().min(1, "Liste adını girin.").max(100, "En fazla 100 karakter."),
  currency: z.enum(CURRENCIES).default("TRY"),
  notes: optText(500),
});

export async function listPriceLists(user: CurrentUser, opts: { archived?: boolean } = {}) {
  assertCan(user, "stock.read");
  return db.priceList.findMany({
    where: { isArchived: Boolean(opts.archived) },
    orderBy: { name: "asc" },
    include: { _count: { select: { items: true, contacts: true } } },
  });
}

export async function getPriceList(user: CurrentUser, id: string) {
  assertCan(user, "stock.read");
  const l = await db.priceList.findUnique({
    where: { id },
    include: {
      items: { include: { product: { select: { id: true, name: true, code: true, unit: true, sellPrice: true, sellCurrency: true } } } },
      contacts: { where: { isArchived: false }, select: { id: true, title: true }, orderBy: { title: "asc" } },
    },
  });
  if (!l) throw new AppError("NOT_FOUND", "Fiyat listesi bulunamadı.");
  return { ...l, items: l.items.sort((a, b) => a.product.name.localeCompare(b.product.name, "tr")) };
}

const conflict = () => new AppError("CONFLICT", "Bu isimde bir fiyat listesi var.", { name: "İsim kullanımda" });

export async function savePriceList(user: CurrentUser, id: string | null, input: z.infer<typeof priceListSchema>) {
  assertCan(user, "stock.write");
  try {
    if (id) {
      const cur = await db.priceList.findUnique({ where: { id }, select: { currency: true, _count: { select: { items: true } } } });
      if (!cur) throw new AppError("NOT_FOUND", "Fiyat listesi bulunamadı.");
      if (cur.currency !== input.currency && cur._count.items > 0) throw new AppError("VALIDATION", "Fiyat girilmiş listenin dövizi değiştirilemez.", { currency: "Fiyatlar var" });
    }
    const l = id ? await db.priceList.update({ where: { id }, data: input }) : await db.priceList.create({ data: input });
    await audit({ userId: user.id, action: id ? "price_list.updated" : "price_list.created", entityType: "PriceList", entityId: l.id });
    return l;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict();
    throw err;
  }
}

/** Fiyatlar formu: price_<productId> alanları; boş bırakılan ürün listeden çıkar */
export async function savePriceListItems(user: CurrentUser, id: string, fd: FormData) {
  assertCan(user, "stock.write");
  const l = await db.priceList.findUnique({ where: { id }, select: { id: true } });
  if (!l) throw new AppError("NOT_FOUND", "Fiyat listesi bulunamadı.");
  const set: Array<{ productId: string; price: string }> = [];
  const clear: string[] = [];
  const errors: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("price_")) continue;
    const productId = k.slice(6);
    const raw = String(v).trim();
    if (!raw) { clear.push(productId); continue; }
    const p = parseMoneyInput(raw);
    if (!p || p.isNegative()) { errors[k] = "Geçersiz fiyat"; continue; }
    set.push({ productId, price: p.toString() });
  }
  if (Object.keys(errors).length) throw new AppError("VALIDATION", "Geçersiz fiyatları düzeltin.", errors);
  const known = new Set((await db.product.findMany({ where: { id: { in: set.map((s) => s.productId) } }, select: { id: true } })).map((p) => p.id));
  await db.$transaction(async (tx) => {
    if (clear.length) await tx.priceListItem.deleteMany({ where: { priceListId: id, productId: { in: clear } } });
    for (const s of set.filter((x) => known.has(x.productId))) {
      await tx.priceListItem.upsert({ where: { priceListId_productId: { priceListId: id, productId: s.productId } }, create: { priceListId: id, ...s }, update: { price: s.price } });
    }
  });
  await audit({ userId: user.id, action: "price_list.items_updated", entityType: "PriceList", entityId: id, metadata: { set: set.length, cleared: clear.length } });
  return set.length;
}

export async function setPriceListArchived(user: CurrentUser, id: string, archived: boolean) {
  assertCan(user, "stock.write");
  const res = await db.priceList.updateMany({ where: { id }, data: { isArchived: archived } });
  if (!res.count) throw new AppError("NOT_FOUND", "Fiyat listesi bulunamadı.");
  await audit({ userId: user.id, action: archived ? "price_list.archived" : "price_list.unarchived", entityType: "PriceList", entityId: id });
}

/** Belge formu için: aktif listeler ve ürün fiyatları */
export async function priceListsForForm() {
  const lists = await db.priceList.findMany({ where: { isArchived: false }, select: { id: true, currency: true, items: { select: { productId: true, price: true } } } });
  return lists.map((l) => ({ id: l.id, currency: l.currency, prices: Object.fromEntries(l.items.map((i) => [i.productId, i.price.toString()])) as Record<string, string> }));
}
