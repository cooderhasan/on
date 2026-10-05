"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { parseForm, safeAction } from "@/server/safe-action";
import { deleteExpense, expenseSchema, saveExpense } from "@/server/services/expenses";
import { employeeSchema, saveEmployee, setEmployeeArchived } from "@/server/services/employees";
import { answerIncoming, answerSchema, processIncoming, processSchema, setIncomingIgnored, syncIncoming } from "@/server/services/incoming";
import type { ActionState } from "@/lib/action-state";

// ── Fatura dışı giderler ───────────────────────────────────
export async function saveExpenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id") ?? "") || null;
    const e = await saveExpense(user, id, parseForm(expenseSchema, fd));
    revalidatePath("/giderler");
    target = `/giderler/kayit/${e.id}`;
  });
  if (target) redirect(target);
  return res;
}

export async function deleteExpenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let ok = false;
  const res = await safeAction(async () => {
    const user = await requireUser();
    await deleteExpense(user, String(fd.get("id")));
    revalidatePath("/giderler");
    ok = true;
  });
  if (ok) redirect("/giderler");
  return res;
}

// ── Çalışanlar ─────────────────────────────────────────────
export async function saveEmployeeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id") ?? "") || null;
    const e = await saveEmployee(user, id, parseForm(employeeSchema, fd));
    revalidatePath("/calisanlar");
    target = `/calisanlar/${e.id}`;
  });
  if (target) redirect(target);
  return res;
}

export async function archiveEmployeeAction(fd: FormData) {
  const user = await requireUser();
  const archived = fd.get("archived") === "1";
  await setEmployeeArchived(user, String(fd.get("id")), archived);
  revalidatePath("/calisanlar");
  redirect(archived ? "/calisanlar" : `/calisanlar/${fd.get("id")}`);
}

// ── Gelen e-faturalar ──────────────────────────────────────
export async function syncIncomingAction(): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const r = await syncIncoming(user);
    revalidatePath("/gelen-e-faturalar");
    return { ok: true, message: r.created ? `${r.created} yeni fatura içeri alındı.` : "Yeni fatura yok." };
  });
}

export async function answerIncomingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const input = parseForm(answerSchema, fd);
    await answerIncoming(user, String(fd.get("id")), input);
    revalidatePath("/gelen-e-faturalar");
    return { ok: true, message: input.answer === "KABUL" ? "Kabul yanıtı gönderildi." : "Ret yanıtı gönderildi." };
  });
}

export async function processIncomingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const r = await processIncoming(user, String(fd.get("id")), parseForm(processSchema, fd));
    revalidatePath("/gelen-e-faturalar");
    revalidatePath("/giderler");
    target = `/giderler/${r.invoiceId}${r.warnings.length ? `?uyari=${encodeURIComponent(r.warnings.join(" "))}` : ""}`;
  });
  if (target) redirect(target);
  return res;
}

export async function ignoreIncomingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    await setIncomingIgnored(user, String(fd.get("id")), fd.get("ignored") === "1");
    revalidatePath("/gelen-e-faturalar");
  });
}
