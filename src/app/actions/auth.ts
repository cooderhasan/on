"use server";

import { redirect } from "next/navigation";
import { parseForm, safeAction } from "@/server/safe-action";
import { authenticate, createFirstAdmin, loginSchema, setupSchema } from "@/server/auth/service";
import { createSession, destroySession, getCurrentUser } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { checkLoginRate } from "@/server/auth/rate-limit";
import type { ActionState } from "@/lib/action-state";

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let ok = false;
  const res = await safeAction(async () => {
    const input = parseForm(loginSchema, fd);
    checkLoginRate(input.email);
    const user = await authenticate(input.email, input.password);
    await createSession(user.id);
    ok = true;
  });
  if (ok) redirect("/");
  return res;
}

export async function setupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let ok = false;
  const res = await safeAction(async () => {
    const input = parseForm(setupSchema, fd);
    const user = await createFirstAdmin(input);
    await createSession(user.id);
    ok = true;
  });
  if (ok) redirect("/firma-bilgileri");
  return res;
}

export async function logoutAction() {
  const user = await getCurrentUser();
  await destroySession();
  if (user) await audit({ userId: user.id, action: "auth.logout" });
  redirect("/giris");
}
