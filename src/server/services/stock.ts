import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { StockMoveSource } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/auth/permissions";
import type { CurrentUser } from "@/server/auth/session";
import { AppError } from "@/lib/errors";
import { parseMoneyInput } from "@/lib/money";
import { optText } from "@/lib/validation";
import { isUniqueViolation } from "@/server/prisma-errors";

/**
 * Stok kuralları (tek yer):
 *  - Her hareket bir depoya yazılır; ürünün güncel stoğu (Product.stockQuantity) tüm hareketlerin toplamıdır.
 *  - Kaynaklar: açılış (ürün kartı), fatura, irsaliye, depolar arası transfer, sayım / düzeltme.
 *  - Yalnızca stok takipli ürünler hareket görür.
 */

type Tx = Prisma.TransactionClient;
const D = (v: { toString(): string } | null | undefined) => new Decimal(v?.toString() ?? 0);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih girin.");
export const MOVES_PAGE_SIZE = 50;

export const SOURCE_LABELS: Record<StockMoveSource, string> = {
  OPENING: "Açılış",
  INVOICE: "Fatura",
  WAYBILL: "İrsaliye",
  TRANSFER: "Transfer",
  ADJUSTMENT: "Sayım / düzeltme",
};

export interface MoveInput {
  productId: string;
  warehouseId: string;
  /** + giriş, − çıkış */
  quantity: Decimal;
  date: Date;
  source: StockMoveSource;
  invoiceId?: string | null;
  waybillId?: string | null;
  transferId?: string | null;
  note?: string | null;
  createdById?: string | null;
}

/** Hareketleri yazar ve ürünlerin güncel stoğunu günceller (aynı işlem içinde) */
export async function applyMoves(tx: Tx, moves: MoveInput[]) {
  const real = moves.filter((m) => !m.quantity.isZero());
  if (!real.length) return;
  await tx.stockMovement.createMany({ data: real.map((m) => ({ ...m, quantity: m.quantity.toString() })) });
  for (const m of real) await tx.product.update({ where: { id: m.productId }, data: { stockQuantity: { increment: m.quantity.toString() } } });
}

/** Belgeye bağlı hareketleri geri alır (düzenleme / silme öncesi) */
export async function revertMoves(tx: Tx, where: Prisma.StockMovementWhereInput) {
  const moves = await tx.stockMovement.findMany({ where, select: { productId: true, quantity: true } });
  for (const m of moves) await tx.product.update({ where: { id: m.productId }, data: { stockQuantity: { decrement: m.quantity } } });
  await tx.stockMovement.deleteMany({ where });
}

/** Varsayılan depo; hiç yoksa (ilk kurulum) "Ana Depo" oluşturulur */
export async function defaultWarehouseId(tx: Tx | typeof db = db): Promise<string> {
  const w = await tx.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (w) return w.id;
  const created = await tx.warehouse.upsert({ where: { name: "Ana Depo" }, create: { name: "Ana Depo", isDefault: true }, update: { isDefault: true, isArchived: false } });
  return created.id;
}

/** Seçilen depo geçerli mi (boşsa varsayılan) */
export async function resolveWarehouse(tx: Tx | typeof db, warehouseId: string | null | undefined): Promise<string> {
  if (!warehouseId) return defaultWarehouseId(tx);
  const w = await tx.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, isArchived: true } });
  if (!w || w.isArchived) throw new AppError("VALIDATION", "Depo bulunamadı.", { warehouseId: "Depo seçin" });
  return w.id;
}

/** Ürün × depo stok miktarları */
export async function stockByWarehouse(where: { productIds?: string[]; warehouseId?: string } = {}) {
  const rows = await db.stockMovement.groupBy({
    by: ["productId", "warehouseId"],
    where: { ...(where.productIds ? { productId: { in: where.productIds } } : {}), ...(where.warehouseId ? { warehouseId: where.warehouseId } : {}) },
    _sum: { quantity: true },
  });
  return rows.map((r) => ({ productId: r.productId, warehouseId: r.warehouseId, quantity: D(r._sum.quantity) }));
}

/** Ürün kartındaki başlangıç stoku ↔ açılış hareketi (varsayılan depoda) */
export async function syncOpeningMove(tx: Tx, productId: string, initialStock: Decimal, productCreatedAt: Date) {
  const existing = await tx.stockMovement.findFirst({ where: { productId, source: "OPENING" }, select: { id: true } });
  if (initialStock.isZero()) {
    if (existing) await tx.stockMovement.delete({ where: { id: existing.id } });
    return;
  }
  if (existing) await tx.stockMovement.update({ where: { id: existing.id }, data: { quantity: initialStock.toString() } });
  else {
    const day = productCreatedAt.toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
    await tx.stockMovement.create({ data: { productId, warehouseId: await defaultWarehouseId(tx), quantity: initialStock.toString(), date: new Date(day), source: "OPENING", note: "Başlangıç stoku" } });
  }
}

// ── Depolar ────────────────────────────────────────────────

export const warehouseSchema = z.object({
  name: z.string().trim().min(1, "Depo adını girin.").max(100, "En fazla 100 karakter."),
  address: optText(500),
});

export async function listWarehouses(user: CurrentUser, opts: { archived?: boolean } = {}) {
  assertCan(user, "stock.read");
  await defaultWarehouseId();
  const rows = await db.warehouse.findMany({ where: { isArchived: Boolean(opts.archived) }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  const stock = await stockByWarehouse();
  return rows.map((w) => {
    const mine = stock.filter((s) => s.warehouseId === w.id && !s.quantity.isZero());
    return { ...w, productCount: mine.length };
  });
}

export async function activeWarehouses() {
  await defaultWarehouseId();
  return db.warehouse.findMany({ where: { isArchived: false }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } });
}

export async function getWarehouse(user: CurrentUser, id: string) {
  assertCan(user, "stock.read");
  const w = await db.warehouse.findUnique({ where: { id } });
  if (!w) throw new AppError("NOT_FOUND", "Depo bulunamadı.");
  const stock = (await stockByWarehouse({ warehouseId: id })).filter((s) => !s.quantity.isZero());
  const products = await db.product.findMany({ where: { id: { in: stock.map((s) => s.productId) } }, select: { id: true, name: true, code: true, unit: true } });
  const items = stock
    .map((s) => ({ ...products.find((p) => p.id === s.productId)!, quantity: s.quantity }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  return { ...w, items };
}

const nameConflict = () => new AppError("CONFLICT", "Bu isimde bir depo var.", { name: "İsim kullanımda" });

export async function saveWarehouse(user: CurrentUser, id: string | null, input: z.infer<typeof warehouseSchema>) {
  assertCan(user, "stock.write");
  try {
    const w = id ? await db.warehouse.update({ where: { id }, data: input }) : await db.warehouse.create({ data: input });
    await audit({ userId: user.id, action: id ? "warehouse.updated" : "warehouse.created", entityType: "Warehouse", entityId: w.id });
    return w;
  } catch (err) {
    if (isUniqueViolation(err)) throw nameConflict();
    throw err;
  }
}

export async function setDefaultWarehouse(user: CurrentUser, id: string) {
  assertCan(user, "stock.write");
  await db.$transaction(async (tx) => {
    const w = await tx.warehouse.findUnique({ where: { id }, select: { isArchived: true } });
    if (!w || w.isArchived) throw new AppError("NOT_FOUND", "Depo bulunamadı.");
    await tx.warehouse.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    await tx.warehouse.update({ where: { id }, data: { isDefault: true } });
  });
  await audit({ userId: user.id, action: "warehouse.default", entityType: "Warehouse", entityId: id });
}

export async function setWarehouseArchived(user: CurrentUser, id: string, archived: boolean) {
  assertCan(user, "stock.write");
  const w = await db.warehouse.findUnique({ where: { id }, select: { isDefault: true } });
  if (!w) throw new AppError("NOT_FOUND", "Depo bulunamadı.");
  if (archived) {
    if (w.isDefault) throw new AppError("CONFLICT", "Varsayılan depo arşivlenemez. Önce başka bir depoyu varsayılan yapın.");
    const left = (await stockByWarehouse({ warehouseId: id })).filter((s) => !s.quantity.isZero());
    if (left.length) throw new AppError("CONFLICT", `Depoda ${left.length} ürünün stoğu var. Önce başka depoya transfer edin.`);
  }
  await db.warehouse.update({ where: { id }, data: { isArchived: archived } });
  await audit({ userId: user.id, action: archived ? "warehouse.archived" : "warehouse.unarchived", entityType: "Warehouse", entityId: id });
}

// ── Sayım / elle düzeltme ──────────────────────────────────

export const adjustmentSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1, "Depo seçin."),
  date,
  /** SET: sayılan miktar; DELTA: +/− fark */
  mode: z.enum(["SET", "DELTA"]),
  quantity: z.string().trim().min(1, "Miktar girin."),
  note: optText(300),
});

export async function adjustStock(user: CurrentUser, input: z.infer<typeof adjustmentSchema>) {
  assertCan(user, "stock.write");
  const qty = parseMoneyInput(input.quantity.replace(/^\+/, ""));
  if (!qty) throw new AppError("VALIDATION", "Geçerli bir miktar girin.", { quantity: "Geçersiz" });
  if (input.mode === "SET" && qty.isNegative()) throw new AppError("VALIDATION", "Sayılan miktar negatif olamaz.", { quantity: "Geçersiz" });
  const p = await db.product.findUnique({ where: { id: input.productId }, select: { trackStock: true } });
  if (!p) throw new AppError("NOT_FOUND", "Ürün bulunamadı.");
  if (!p.trackStock) throw new AppError("VALIDATION", "Bu ürün için stok takibi yapılmıyor.");
  const delta = await db.$transaction(async (tx) => {
    const warehouseId = await resolveWarehouse(tx, input.warehouseId);
    let d = qty;
    if (input.mode === "SET") {
      const cur = await tx.stockMovement.aggregate({ where: { productId: input.productId, warehouseId }, _sum: { quantity: true } });
      d = qty.minus(D(cur._sum.quantity));
    }
    if (d.isZero()) throw new AppError("VALIDATION", "Stok zaten bu miktarda.", { quantity: "Değişiklik yok" });
    await applyMoves(tx, [{ productId: input.productId, warehouseId, quantity: d, date: new Date(input.date), source: "ADJUSTMENT", note: input.note ?? (input.mode === "SET" ? "Sayım" : null), createdById: user.id }]);
    return d;
  });
  await audit({ userId: user.id, action: "stock.adjusted", entityType: "Product", entityId: input.productId, metadata: { delta: delta.toString(), warehouseId: input.warehouseId } });
  return delta;
}

/** Yalnızca elle girilen düzeltme silinebilir (belgeden gelen hareket belgesiyle değişir) */
export async function deleteAdjustment(user: CurrentUser, id: string) {
  assertCan(user, "stock.write");
  const m = await db.stockMovement.findUnique({ where: { id }, select: { source: true, productId: true } });
  if (!m) throw new AppError("NOT_FOUND", "Hareket bulunamadı.");
  if (m.source !== "ADJUSTMENT") throw new AppError("CONFLICT", "Bu hareket bir belgeye bağlı; belgeyi düzenleyin.");
  await db.$transaction((tx) => revertMoves(tx, { id }));
  await audit({ userId: user.id, action: "stock.adjustment_deleted", entityType: "Product", entityId: m.productId });
  return m.productId;
}

// ── Stok geçmişi ───────────────────────────────────────────

export interface MovementFilter {
  productId?: string;
  warehouseId?: string;
  source?: StockMoveSource;
  from?: string;
  to?: string;
  page?: number;
}

export async function listMovements(user: CurrentUser, f: MovementFilter = {}) {
  assertCan(user, "stock.read");
  const where: Prisma.StockMovementWhereInput = {};
  if (f.productId) where.productId = f.productId;
  if (f.warehouseId) where.warehouseId = f.warehouseId;
  if (f.source) where.source = f.source;
  if (f.from || f.to) where.date = { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(f.to) } : {}) };
  const page = Math.max(1, f.page ?? 1);
  const [total, rows] = await Promise.all([
    db.stockMovement.count({ where }),
    db.stockMovement.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * MOVES_PAGE_SIZE,
      take: MOVES_PAGE_SIZE,
      include: {
        product: { select: { id: true, name: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
        invoice: { select: { id: true, direction: true, kind: true, invoiceNo: true, name: true, contact: { select: { title: true } } } },
        waybill: { select: { id: true, direction: true, waybillNo: true, contact: { select: { title: true } } } },
        transfer: { select: { id: true, fromWarehouse: { select: { name: true } }, toWarehouse: { select: { name: true } } } },
      },
    }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / MOVES_PAGE_SIZE)) };
}

export type MovementListRow = Awaited<ReturnType<typeof listMovements>>["rows"][number];

/** Hareketin kaynağına bağlantı ve açıklama */
export function movementSource(m: MovementListRow): { label: string; href?: string } {
  if (m.invoice) {
    const base = m.invoice.direction === "SALE" ? "/satislar" : "/giderler";
    const kind = m.invoice.direction === "SALE" ? (m.invoice.kind === "RETURN" ? "Satış iadesi" : "Satış faturası") : m.invoice.kind === "RETURN" ? "Alış iadesi" : "Alış faturası";
    return { label: [kind, m.invoice.invoiceNo, m.invoice.contact.title].filter(Boolean).join(" · "), href: `${base}/${m.invoice.id}` };
  }
  if (m.waybill) {
    const base = m.waybill.direction === "SALE" ? "/giden-irsaliyeler" : "/gelen-irsaliyeler";
    return { label: [m.waybill.direction === "SALE" ? "Giden irsaliye" : "Gelen irsaliye", m.waybill.waybillNo, m.waybill.contact.title].filter(Boolean).join(" · "), href: `${base}/${m.waybill.id}` };
  }
  if (m.transfer) return { label: `Transfer · ${m.transfer.fromWarehouse.name} → ${m.transfer.toWarehouse.name}`, href: `/depolar-arasi-transfer/${m.transfer.id}` };
  return { label: [SOURCE_LABELS[m.source], m.note].filter(Boolean).join(" · ") };
}

// ── Depolar arası transfer ─────────────────────────────────

export const transferHeaderSchema = z.object({
  fromWarehouseId: z.string().min(1, "Çıkış deposunu seçin."),
  toWarehouseId: z.string().min(1, "Giriş deposunu seçin."),
  date,
  description: optText(300),
});

export interface TransferLineInput { productId: string; quantity: Decimal }

/** Formdaki line_productId[] / line_qty[] satırları; boş satırlar atlanır, aynı ürün birleştirilir */
export function parseTransferLines(fd: FormData): { lines: TransferLineInput[]; error: string | null } {
  const ids = fd.getAll("line_productId").map(String);
  const qtys = fd.getAll("line_qty").map(String);
  const map = new Map<string, Decimal>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!.trim();
    const raw = qtys[i]?.trim() ?? "";
    if (!id && !raw) continue;
    if (!id) return { lines: [], error: `${i + 1}. satırda ürün seçin.` };
    const q = parseMoneyInput(raw);
    if (!q || !q.greaterThan(0)) return { lines: [], error: `${i + 1}. satırda geçerli bir miktar girin.` };
    map.set(id, (map.get(id) ?? new Decimal(0)).plus(q));
  }
  return { lines: [...map].map(([productId, quantity]) => ({ productId, quantity })), error: null };
}

export async function createStockTransfer(user: CurrentUser, header: z.infer<typeof transferHeaderSchema>, lines: TransferLineInput[]) {
  assertCan(user, "stock.write");
  if (header.fromWarehouseId === header.toWarehouseId) throw new AppError("VALIDATION", "Çıkış ve giriş deposu aynı olamaz.", { toWarehouseId: "Farklı depo seçin" });
  if (!lines.length) throw new AppError("VALIDATION", "En az bir ürün satırı ekleyin.");
  const id = await db.$transaction(async (tx) => {
    const from = await resolveWarehouse(tx, header.fromWarehouseId);
    const to = await resolveWarehouse(tx, header.toWarehouseId);
    const products = await tx.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } }, select: { id: true, name: true, trackStock: true } });
    for (const l of lines) {
      const p = products.find((x) => x.id === l.productId);
      if (!p) throw new AppError("VALIDATION", "Ürün bulunamadı.");
      if (!p.trackStock) throw new AppError("VALIDATION", `${p.name}: stok takibi yapılmıyor.`);
      const cur = await tx.stockMovement.aggregate({ where: { productId: p.id, warehouseId: from }, _sum: { quantity: true } });
      const available = D(cur._sum.quantity);
      if (available.lessThan(l.quantity)) throw new AppError("VALIDATION", `${p.name}: çıkış deposunda ${available.toString().replace(".", ",")} var, ${l.quantity.toString().replace(".", ",")} transfer edilemez.`);
    }
    const t = await tx.stockTransfer.create({
      data: { date: new Date(header.date), fromWarehouseId: from, toWarehouseId: to, description: header.description, createdById: user.id, lines: { create: lines.map((l) => ({ productId: l.productId, quantity: l.quantity.toString() })) } },
    });
    const day = new Date(header.date);
    await applyMoves(tx, lines.flatMap((l) => [
      { productId: l.productId, warehouseId: from, quantity: l.quantity.negated(), date: day, source: "TRANSFER" as const, transferId: t.id, createdById: user.id },
      { productId: l.productId, warehouseId: to, quantity: l.quantity, date: day, source: "TRANSFER" as const, transferId: t.id, createdById: user.id },
    ]));
    return t.id;
  });
  await audit({ userId: user.id, action: "stock.transfer_created", entityType: "StockTransfer", entityId: id });
  return id;
}

export async function listStockTransfers(user: CurrentUser, page = 1) {
  assertCan(user, "stock.read");
  const [total, rows] = await Promise.all([
    db.stockTransfer.count(),
    db.stockTransfer.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * MOVES_PAGE_SIZE,
      take: MOVES_PAGE_SIZE,
      include: { fromWarehouse: { select: { name: true } }, toWarehouse: { select: { name: true } }, _count: { select: { lines: true } } },
    }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / MOVES_PAGE_SIZE)) };
}

export async function getStockTransfer(user: CurrentUser, id: string) {
  assertCan(user, "stock.read");
  const t = await db.stockTransfer.findUnique({
    where: { id },
    include: { fromWarehouse: { select: { id: true, name: true } }, toWarehouse: { select: { id: true, name: true } }, lines: { include: { product: { select: { id: true, name: true, unit: true } } } } },
  });
  if (!t) throw new AppError("NOT_FOUND", "Transfer bulunamadı.");
  return t;
}

/** Transfer geri alınır: giriş deposunda yeterli stok kalmadıysa engellenir */
export async function deleteStockTransfer(user: CurrentUser, id: string) {
  assertCan(user, "stock.write");
  await db.$transaction(async (tx) => {
    const t = await tx.stockTransfer.findUnique({ where: { id }, include: { lines: { include: { product: { select: { name: true } } } } } });
    if (!t) throw new AppError("NOT_FOUND", "Transfer bulunamadı.");
    for (const l of t.lines) {
      const cur = await tx.stockMovement.aggregate({ where: { productId: l.productId, warehouseId: t.toWarehouseId }, _sum: { quantity: true } });
      if (D(cur._sum.quantity).lessThan(D(l.quantity))) throw new AppError("CONFLICT", `${l.product.name}: giriş deposunda transfer edilen miktar kalmamış; transfer geri alınamaz.`);
    }
    await revertMoves(tx, { transferId: id });
    await tx.stockTransfer.delete({ where: { id } });
  });
  await audit({ userId: user.id, action: "stock.transfer_deleted", entityType: "StockTransfer", entityId: id });
}
