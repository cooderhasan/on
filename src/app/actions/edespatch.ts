"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { parseForm, safeAction } from "@/server/safe-action";
import {
  prepareDespatch, processDespatchSchema, processIncomingDespatch, refreshDespatch, sendDespatch, setIncomingDespatchIgnored, syncIncomingDespatches,
} from "@/server/services/edespatch";
import type { ActionState } from "@/lib/action-state";

export async function prepareDespatchAction(id: string) {
  try {
    const user = await requireUser();
    return { ok: true as const, ...(await prepareDespatch(user, id)) };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false as const, error: err instanceof Error ? err.message : "Ön kontrol yapılamadı." };
  }
}

export async function sendDespatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const r = await sendDespatch(user, id);
    revalidatePath(`/giden-irsaliyeler/${id}`);
    revalidatePath("/giden-irsaliyeler");
    return { ok: true, message: `e-İrsaliye gönderildi${r.documentNumber ? ` · No ${r.documentNumber}` : ""}.` };
  });
}

export async function refreshDespatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const r = await refreshDespatch(user, id);
    revalidatePath(`/giden-irsaliyeler/${id}`);
    revalidatePath("/giden-irsaliyeler");
    const label = { SENT: "Gönderildi, alıcıya ulaşması bekleniyor", ACCEPTED: "Alıcıya ulaştı", REJECTED: "Reddedildi", FAILED: "Hata", CANCELLED: "İptal" }[r.status];
    return { ok: true, message: `Durum: ${label}.` };
  });
}

export async function syncIncomingDespatchAction(): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const r = await syncIncomingDespatches(user);
    revalidatePath("/gelen-e-irsaliyeler");
    return { ok: true, message: r.created ? `${r.created} yeni e-İrsaliye içeri alındı.` : "Yeni e-İrsaliye yok." };
  });
}

export async function processIncomingDespatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const r = await processIncomingDespatch(user, String(fd.get("id")), parseForm(processDespatchSchema, fd));
    revalidatePath("/gelen-e-irsaliyeler");
    revalidatePath("/gelen-irsaliyeler");
    target = `/gelen-irsaliyeler/${r.waybillId}`;
  });
  if (target) redirect(target);
  return res;
}

export async function ignoreIncomingDespatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    await setIncomingDespatchIgnored(user, String(fd.get("id")), fd.get("ignored") === "1");
    revalidatePath("/gelen-e-irsaliyeler");
  });
}
