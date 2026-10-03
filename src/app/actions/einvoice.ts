"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { parseForm, safeAction } from "@/server/safe-action";
import { cancelArchiveInvoice, lookupTaxpayer, prepareSend, refreshStatus, saveEInvoiceSettings, sendInvoice, sendSchema, settingsSchema, testConnection } from "@/server/services/einvoice";
import type { ActionState } from "@/lib/action-state";

export async function saveEInvoiceSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    await saveEInvoiceSettings(user, parseForm(settingsSchema, fd));
    revalidatePath("/e-fatura-ayarlari");
    return { ok: true, message: "e-Fatura ayarları kaydedildi." };
  });
}

export async function testConnectionAction(): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const r = await testConnection(user);
    revalidatePath("/e-fatura-ayarlari");
    return {
      ok: true,
      message: `Bağlantı başarılı (${r.env} ortamı).${r.isEInvoiceUser ? ` Firma e-Fatura mükellefi: ${r.title?.replace(/\.$/, "")}.` : " Firma VKN'si e-Fatura mükellefi olarak görünmüyor — yalnızca e-Arşiv kesebilirsiniz."}${r.senderAliases.length ? ` Gönderici etiketi: ${r.senderAliases[0]}` : ""}`,
    };
  });
}

/** Mükellef sorgusu sonucu forma döner (unvan doldurma için) */
export async function lookupTaxpayerAction(taxNumber: string): Promise<ActionState & { title?: string | null; isEInvoiceUser?: boolean }> {
  try {
    const user = await requireUser();
    const r = await lookupTaxpayer(user, taxNumber.replace(/\s/g, ""));
    return { ok: true, title: r.title, isEInvoiceUser: r.isEInvoiceUser, message: r.isEInvoiceUser ? `e-Fatura mükellefi: ${r.title}` : "e-Fatura mükellefi değil — faturası e-Arşiv olarak kesilir." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Sorgulanamadı." };
  }
}

export async function prepareSendAction(invoiceId: string) {
  try {
    const user = await requireUser();
    return { ok: true as const, ...(await prepareSend(user, invoiceId)) };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Ön kontrol yapılamadı." };
  }
}

export async function sendInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const r = await sendInvoice(user, id, parseForm(sendSchema, fd));
    revalidatePath(`/satislar/${id}`);
    revalidatePath("/satislar");
    return { ok: true, message: `Gönderildi${r.documentNumber ? ` · Fatura no ${r.documentNumber}` : ""}.` };
  });
}

export async function refreshStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const r = await refreshStatus(user, id);
    revalidatePath(`/satislar/${id}`);
    revalidatePath("/satislar");
    const label = { SENT: "Gönderildi, alıcıya ulaşması bekleniyor", ACCEPTED: "Resmileşti", REJECTED: "Alıcı reddetti", FAILED: "Hata", CANCELLED: "İptal edildi" }[r.status];
    return { ok: true, message: `Durum: ${label}.` };
  });
}

export async function cancelArchiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id"));
    await cancelArchiveInvoice(user, id);
    revalidatePath(`/satislar/${id}`);
    revalidatePath("/satislar");
    return { ok: true, message: "e-Arşiv fatura iptal edildi." };
  });
}
