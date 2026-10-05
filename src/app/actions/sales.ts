"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { parseForm, safeAction } from "@/server/safe-action";
import { deleteInvoice, getInvoice, saveInvoice } from "@/server/services/invoices";
import { convertQuoteToInvoice, deleteQuote, saveQuote, setQuoteStatus } from "@/server/services/quotes";
import { recurSchema, runRecurring, setRecurring, stopRecurring } from "@/server/services/recurring";
import { cashMoveSchema, createCashMove, createSettlement, createTransfer, deleteTransaction, settlementSchema, transferSchema } from "@/server/services/transactions";
import { documentHeaderSchema, parseDocDiscount, parseLines } from "@/lib/document-form";
import { AppError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";

const BASE = { SALE: "/satislar", PURCHASE: "/giderler" } as const;

/** Başlık + satırlar + genel indirim; satır hataları tek mesajda */
function parseDocument(fd: FormData) {
  const header = parseForm(documentHeaderSchema, fd);
  const { lines, errors } = parseLines(fd);
  const rows = Object.entries(errors);
  if (rows.length) throw new AppError("VALIDATION", rows.map(([n, m]) => `${n}. satır: ${m}`).join(" "));
  const disc = parseDocDiscount(String(fd.get("docDiscountType") ?? ""), String(fd.get("docDiscountValue") ?? ""));
  if ("error" in disc) throw new AppError("VALIDATION", disc.error!, { docDiscountValue: disc.error! });
  return { header, lines, discount: { discountType: disc.discountType, discountValue: disc.discountValue } };
}

// ── Fatura ─────────────────────────────────────────────────
export async function saveInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const direction = fd.get("direction") === "PURCHASE" ? "PURCHASE" : "SALE";
    const id = String(fd.get("id") ?? "") || null;
    const doc = parseDocument(fd);
    const tagIds = fd.getAll("tagId").map(String).filter(Boolean);
    const settle = !id && fd.get("settled") === "yes";
    const settleAccountId = String(fd.get("settleAccountId") ?? "");
    if (settle && !settleAccountId) throw new AppError("VALIDATION", "Tahsilatın girdiği kasa / banka hesabını seçin.", { settleAccountId: "Seçin" });
    const invoiceId = await saveInvoice(user, id, { direction, ...doc, tagIds });
    let warn = "";
    // Yeni faturada "Tahsil edildi" seçildiyse tamamı için tahsilat. Fatura artık kayıtlı: tahsilat hata verse de
    // kullanıcı faturaya yönlenir (formda kalıp tekrar kaydederse fatura ikinci kez oluşurdu).
    if (settle) {
      try {
        const inv = await getInvoice(user, invoiceId);
        await createSettlement(user, settlementSchema.parse({ invoiceId, accountId: settleAccountId, date: String(fd.get("settleDate") || doc.header.issueDate), amount: inv.payableTotal.toString() }));
      } catch (err) {
        console.error("[invoice] otomatik tahsilat", err);
        warn = "?uyari=tahsilat";
      }
    }
    revalidatePath(BASE[direction]);
    target = `${BASE[direction]}/${invoiceId}${warn}`;
  });
  if (target) redirect(target);
  return res;
}

export async function deleteInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const direction = await deleteInvoice(user, String(fd.get("id")));
    revalidatePath(BASE[direction]);
    target = BASE[direction];
  });
  if (target) redirect(target);
  return res;
}

// ── Tahsilat / ödeme / kasa ────────────────────────────────
export async function settlementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const input = parseForm(settlementSchema, fd);
    const tx = await createSettlement(user, input);
    revalidatePath("/", "layout");
    return { ok: true, message: tx.type === "COLLECTION" ? "Tahsilat kaydedildi." : "Ödeme kaydedildi." };
  });
}

export async function deleteTransactionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    await deleteTransaction(user, String(fd.get("id")));
    revalidatePath("/", "layout");
    return { ok: true, message: "Hareket silindi." };
  });
}

export async function transferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    await createTransfer(user, parseForm(transferSchema, fd));
    revalidatePath("/kasa-ve-bankalar", "layout");
    return { ok: true, message: "Virman kaydedildi." };
  });
}

export async function cashMoveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const input = parseForm(cashMoveSchema, fd);
    await createCashMove(user, input);
    revalidatePath("/kasa-ve-bankalar", "layout");
    return { ok: true, message: input.type === "DEPOSIT" ? "Para girişi kaydedildi." : "Para çıkışı kaydedildi." };
  });
}

// ── Teklif ─────────────────────────────────────────────────
export async function saveQuoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("id") ?? "") || null;
    const doc = parseDocument(fd);
    const validUntil = String(fd.get("validUntil") ?? "").trim() || null;
    const q = await saveQuote(user, id, { ...doc, validUntil });
    revalidatePath("/teklifler");
    target = `/teklifler/${q.id}`;
  });
  if (target) redirect(target);
  return res;
}

export async function quoteStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const status = String(fd.get("status"));
    if (status !== "OPEN" && status !== "ACCEPTED" && status !== "REJECTED") throw new AppError("VALIDATION", "Durum geçersiz.");
    await setQuoteStatus(user, String(fd.get("id")), status);
    revalidatePath("/teklifler", "layout");
  });
}

export async function convertQuoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const invoiceId = await convertQuoteToInvoice(user, String(fd.get("id")));
    revalidatePath("/teklifler", "layout");
    revalidatePath("/satislar");
    target = `/satislar/${invoiceId}`;
  });
  if (target) redirect(target);
  return res;
}

export async function deleteQuoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let ok = false;
  const res = await safeAction(async () => {
    const user = await requireUser();
    await deleteQuote(user, String(fd.get("id")));
    revalidatePath("/teklifler");
    ok = true;
  });
  if (ok) redirect("/teklifler");
  return res;
}

// ── Tekrarlayan fatura ─────────────────────────────────────
export async function setRecurringAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("invoiceId"));
    await setRecurring(user, id, parseForm(recurSchema, fd));
    // Bugün veya geçmiş bir tarih seçildiyse ilk kopya hemen oluşur
    await runRecurring();
    revalidatePath(`/satislar/${id}`);
    revalidatePath("/satislar");
    return { ok: true, message: "Tekrarlayan fatura kaydedildi." };
  });
}

export async function stopRecurringAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    const id = String(fd.get("invoiceId"));
    await stopRecurring(user, id);
    revalidatePath(`/satislar/${id}`);
    return { ok: true, message: "Tekrarlama durduruldu." };
  });
}
