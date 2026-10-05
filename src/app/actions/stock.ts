"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { parseForm, safeAction } from "@/server/safe-action";
import { AppError } from "@/lib/errors";
import {
  adjustmentSchema, adjustStock, createStockTransfer, deleteAdjustment, deleteStockTransfer, parseTransferLines, saveWarehouse, setDefaultWarehouse,
  setWarehouseArchived, transferHeaderSchema, warehouseSchema,
} from "@/server/services/stock";
import { deleteWaybill, parseWaybillLines, saveWaybill, waybillHeaderSchema } from "@/server/services/waybills";
import { priceListSchema, savePriceList, savePriceListItems, setPriceListArchived } from "@/server/services/price-lists";
import { chequeAction, chequeActionSchema, chequeSchema, createCheque, deleteCheque, revertCheque } from "@/server/services/cheques";
import type { ActionState } from "@/lib/action-state";

const WAYBILL_BASE = { SALE: "/giden-irsaliyeler", PURCHASE: "/gelen-irsaliyeler" } as const;

// ── Depolar ────────────────────────────────────────────────
export async function saveWarehouseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id") ?? "") || null;
    const w = await saveWarehouse(user, id, parseForm(warehouseSchema, fd));
    revalidatePath("/depolar");
    target = `/depolar/${w.id}`;
  });
  if (target) redirect(target);
  return res;
}

export async function warehouseStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const op = String(fd.get("op"));
    if (op === "default") await setDefaultWarehouse(user, id);
    else await setWarehouseArchived(user, id, op === "archive");
    revalidatePath("/depolar");
    revalidatePath(`/depolar/${id}`);
    return { ok: true, message: op === "default" ? "Varsayılan depo değişti." : op === "archive" ? "Depo arşivlendi." : "Depo arşivden çıkarıldı." };
  });
}

// ── Sayım / düzeltme ───────────────────────────────────────
export async function adjustStockAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const input = parseForm(adjustmentSchema, fd);
    const delta = await adjustStock(user, input);
    revalidatePath(`/hizmet-ve-urunler/${input.productId}`);
    revalidatePath("/hizmet-ve-urunler");
    return { ok: true, message: `Stok ${delta.isNegative() ? "" : "+"}${delta.toString().replace(".", ",")} güncellendi.` };
  });
}

export async function deleteAdjustmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const productId = await deleteAdjustment(user, String(fd.get("id")));
    revalidatePath(`/hizmet-ve-urunler/${productId}`);
    revalidatePath("/stok-hareketleri");
  });
}

// ── Depolar arası transfer ─────────────────────────────────
export async function createTransferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const header = parseForm(transferHeaderSchema, fd);
    const { lines, error } = parseTransferLines(fd);
    if (error) throw new AppError("VALIDATION", error);
    const id = await createStockTransfer(user, header, lines);
    revalidatePath("/depolar-arasi-transfer");
    target = `/depolar-arasi-transfer/${id}`;
  });
  if (target) redirect(target);
  return res;
}

export async function deleteTransferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let ok = false;
  const res = await safeAction(async () => {
    const user = await requireUser();
    await deleteStockTransfer(user, String(fd.get("id")));
    revalidatePath("/depolar-arasi-transfer");
    ok = true;
  });
  if (ok) redirect("/depolar-arasi-transfer");
  return res;
}

// ── İrsaliyeler ────────────────────────────────────────────
export async function saveWaybillAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const direction = fd.get("direction") === "PURCHASE" ? "PURCHASE" : "SALE";
    const id = String(fd.get("id") ?? "") || null;
    const header = parseForm(waybillHeaderSchema, fd);
    const { lines, error } = parseWaybillLines(fd);
    if (error) throw new AppError("VALIDATION", error);
    const wid = await saveWaybill(user, direction, id, header, lines);
    revalidatePath(WAYBILL_BASE[direction]);
    target = `${WAYBILL_BASE[direction]}/${wid}`;
  });
  if (target) redirect(target);
  return res;
}

export async function deleteWaybillAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const direction = await deleteWaybill(user, String(fd.get("id")));
    revalidatePath(WAYBILL_BASE[direction]);
    target = WAYBILL_BASE[direction];
  });
  if (target) redirect(target);
  return res;
}

// ── Fiyat listeleri ────────────────────────────────────────
export async function savePriceListAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id") ?? "") || null;
    const l = await savePriceList(user, id, parseForm(priceListSchema, fd));
    revalidatePath("/fiyat-listeleri");
    target = `/fiyat-listeleri/${l.id}`;
  });
  if (target) redirect(target);
  return res;
}

export async function savePriceListItemsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const n = await savePriceListItems(user, id, fd);
    revalidatePath(`/fiyat-listeleri/${id}`);
    revalidatePath("/fiyat-listeleri");
    return { ok: true, message: `Fiyatlar kaydedildi (${n} ürün).` };
  });
}

export async function archivePriceListAction(fd: FormData) {
  const user = await requireUser();
  const archived = fd.get("archived") === "1";
  await setPriceListArchived(user, String(fd.get("id")), archived);
  revalidatePath("/fiyat-listeleri");
  redirect(archived ? "/fiyat-listeleri" : `/fiyat-listeleri/${fd.get("id")}`);
}

// ── Çekler ─────────────────────────────────────────────────
export async function createChequeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const id = await createCheque(user, parseForm(chequeSchema, fd));
    revalidatePath("/cekler");
    target = `/cekler/${id}`;
  });
  if (target) redirect(target);
  return res;
}

export async function chequeStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id"));
    if (fd.get("action") === "revert") await revertCheque(user, id);
    else await chequeAction(user, id, parseForm(chequeActionSchema, fd));
    revalidatePath("/cekler");
    revalidatePath(`/cekler/${id}`);
    return { ok: true, message: "Çek güncellendi." };
  });
}

export async function deleteChequeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let ok = false;
  const res = await safeAction(async () => {
    const user = await requireUser();
    await deleteCheque(user, String(fd.get("id")));
    revalidatePath("/cekler");
    ok = true;
  });
  if (ok) redirect("/cekler");
  return res;
}
