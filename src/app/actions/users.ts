"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, hashToken, SESSION_COOKIE } from "@/server/auth/session";
import { parseForm, safeAction } from "@/server/safe-action";
import {
  changeOwnPassword, closeOtherSessions, createUser, ownPasswordSchema, passwordResetSchema, resetPassword, updateOwnName, updateUser, userCreateSchema, userUpdateSchema,
} from "@/server/services/users";
import type { ActionState } from "@/lib/action-state";

const currentTokenHash = async () => {
  const t = (await cookies()).get(SESSION_COOKIE)?.value;
  return t ? hashToken(t) : null;
};

export async function createUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const u = await createUser(user, parseForm(userCreateSchema, fd));
    revalidatePath("/kullanicilar");
    target = `/kullanicilar/${u.id}`;
  });
  if (target) redirect(target);
  return res;
}

export async function updateUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id"));
    await updateUser(user, id, parseForm(userUpdateSchema, fd));
    revalidatePath("/kullanicilar");
    revalidatePath(`/kullanicilar/${id}`);
    return { ok: true, message: "Kullanıcı güncellendi." };
  });
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    await resetPassword(user, String(fd.get("id")), parseForm(passwordResetSchema, fd).password);
    return { ok: true, message: "Şifre değiştirildi; kullanıcının açık oturumları kapatıldı. Yeni şifreyi kendisine güvenli bir yoldan iletin." };
  });
}

export async function changeOwnPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    await changeOwnPassword(user, parseForm(ownPasswordSchema, fd), await currentTokenHash());
    return { ok: true, message: "Şifreniz değiştirildi. Diğer cihazlardaki oturumlar kapatıldı." };
  });
}

export async function updateOwnNameAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    await updateOwnName(user, String(fd.get("name") ?? ""));
    revalidatePath("/", "layout");
    return { ok: true, message: "Adınız güncellendi." };
  });
}

export async function closeOtherSessionsAction(): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const n = await closeOtherSessions(user, await currentTokenHash());
    revalidatePath("/hesabim");
    return { ok: true, message: n ? `${n} oturum kapatıldı.` : "Başka açık oturum yok." };
  });
}
