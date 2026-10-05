"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { parseForm, safeAction } from "@/server/safe-action";
import { saveCompany } from "@/server/services/company";
import { createContact, KIND_LABELS, setContactArchived, updateContact } from "@/server/services/contacts";
import { createProduct, setProductArchived, updateProduct } from "@/server/services/products";
import { createAccount, setAccountArchived, updateAccount } from "@/server/services/accounts";
import { createCategory, createTag, deleteCategory, deleteTag } from "@/server/services/categories";
import { printSettingsSchema, savePrintSettings } from "@/server/services/print-settings";
import { accountSchema, categorySchema, companySchema, contactSchema, parseRepeated, productSchema, tagSchema } from "@/lib/validation";
import { AppError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";

// ── Firma ──────────────────────────────────────────────────
export async function saveCompanyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let ok = false;
  const res = await safeAction(async () => {
    const user = await requireUser();
    await saveCompany(user, parseForm(companySchema, fd));
    revalidatePath("/", "layout");
    ok = true;
  });
  if (ok) redirect("/firma-bilgileri");
  return res;
}

// ── Cariler ────────────────────────────────────────────────
function repeatedOrThrow(fd: FormData) {
  const rep = parseRepeated(fd);
  if (rep.invalidIban) throw new AppError("VALIDATION", `IBAN geçersiz: ${rep.invalidIban}`, { iban: "Geçersiz IBAN" });
  if (rep.invalidPersonEmail) throw new AppError("VALIDATION", `Yetkili e-postası geçersiz: ${rep.invalidPersonEmail}`);
  return rep;
}

export async function saveContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const input = parseForm(contactSchema, fd);
    const rep = repeatedOrThrow(fd);
    const id = String(fd.get("id") ?? "");
    const c = id ? await updateContact(user, id, input, rep) : await createContact(user, input, rep);
    const base = KIND_LABELS[c.kind].path;
    revalidatePath(base);
    target = `${base}/${c.id}`;
  });
  if (target) redirect(target);
  return res;
}

export async function archiveContactAction(fd: FormData) {
  const user = await requireUser();
  const archived = fd.get("archived") === "1";
  const kind = await setContactArchived(user, String(fd.get("id")), archived);
  revalidatePath(KIND_LABELS[kind].path);
  redirect(`${KIND_LABELS[kind].path}${archived ? "" : `/${fd.get("id")}`}`);
}

// ── Ürünler ────────────────────────────────────────────────
export async function saveProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const input = parseForm(productSchema, fd);
    const id = String(fd.get("id") ?? "");
    const p = id ? await updateProduct(user, id, input) : await createProduct(user, input);
    revalidatePath("/hizmet-ve-urunler");
    target = `/hizmet-ve-urunler/${p.id}`;
  });
  if (target) redirect(target);
  return res;
}

export async function archiveProductAction(fd: FormData) {
  const user = await requireUser();
  const archived = fd.get("archived") === "1";
  await setProductArchived(user, String(fd.get("id")), archived);
  revalidatePath("/hizmet-ve-urunler");
  redirect(archived ? "/hizmet-ve-urunler" : `/hizmet-ve-urunler/${fd.get("id")}`);
}

// ── Kasa / banka ───────────────────────────────────────────
export async function saveAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await safeAction(async () => {
    const user = await requireUser();
    const input = parseForm(accountSchema, fd);
    const id = String(fd.get("id") ?? "");
    const a = id ? await updateAccount(user, id, input) : await createAccount(user, input);
    revalidatePath("/kasa-ve-bankalar");
    target = `/kasa-ve-bankalar/${a.id}`;
  });
  if (target) redirect(target);
  return res;
}

export async function archiveAccountAction(fd: FormData) {
  const user = await requireUser();
  const archived = fd.get("archived") === "1";
  await setAccountArchived(user, String(fd.get("id")), archived);
  revalidatePath("/kasa-ve-bankalar");
  redirect(archived ? "/kasa-ve-bankalar" : `/kasa-ve-bankalar/${fd.get("id")}`);
}

// ── Kategori / etiket ──────────────────────────────────────
export async function createCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    await createCategory(user, parseForm(categorySchema, fd));
    revalidatePath("/kategori-ve-etiketler");
    return { ok: true, message: "Kategori eklendi." };
  });
}

export async function deleteCategoryAction(fd: FormData) {
  const user = await requireUser();
  await deleteCategory(user, String(fd.get("id")));
  revalidatePath("/kategori-ve-etiketler");
}

export async function createTagAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    await createTag(user, parseForm(tagSchema, fd));
    revalidatePath("/kategori-ve-etiketler");
    return { ok: true, message: "Etiket eklendi." };
  });
}

export async function deleteTagAction(fd: FormData) {
  const user = await requireUser();
  await deleteTag(user, String(fd.get("id")));
  revalidatePath("/kategori-ve-etiketler");
}

// ── Yazdırma şablonu ───────────────────────────────────────
export async function savePrintSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safeAction(async () => {
    const user = await requireUser();
    await savePrintSettings(user, parseForm(printSettingsSchema, fd), fd.getAll("bankAccountId").map(String));
    revalidatePath("/yazdirma-sablonlari");
    return { ok: true, message: "Yazdırma ayarları kaydedildi." };
  });
}
