"use client";

import { Plus } from "lucide-react";
import { createCategoryAction, createTagAction } from "@/app/actions/records";
import { ActionForm, FormMessage, SubmitButton } from "./forms";
import { Input } from "./ui";

const COLORS = ["#9e9e9e", "#e2685a", "#f0a33a", "#3cb878", "#29b6c6", "#2a9fd6", "#7e57c2", "#8a6d5a"];

export function CategoryForm({ type }: { type: string }) {
  return (
    <ActionForm action={createCategoryAction} resetOnSuccess className="gap-2">
      {(s) => (
        <>
          <input type="hidden" name="type" value={type} />
          <div className="flex flex-wrap items-center gap-2">
            <Input name="name" placeholder="Yeni kategori adı" maxLength={60} className="max-w-64" aria-label="Kategori adı" />
            <div className="flex gap-1" role="radiogroup" aria-label="Renk">
              {COLORS.map((c, i) => (
                <label key={c} className="cursor-pointer">
                  <input type="radio" name="color" value={c} defaultChecked={i === 0} className="peer sr-only" />
                  <span className="block size-6 rounded-sm ring-offset-1 peer-checked:ring-2 peer-checked:ring-text" style={{ background: c }} title={c} />
                </label>
              ))}
            </div>
            <SubmitButton pendingText="Ekleniyor…"><Plus className="size-3.5" /> Ekle</SubmitButton>
          </div>
          {s.fieldErrors?.name ? <p className="text-xs text-danger">{s.fieldErrors.name}</p> : <FormMessage state={s} />}
        </>
      )}
    </ActionForm>
  );
}

export function TagForm() {
  return (
    <ActionForm action={createTagAction} resetOnSuccess className="gap-2">
      {(s) => (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input name="name" placeholder="Yeni etiket" maxLength={40} className="max-w-64" aria-label="Etiket adı" />
            <SubmitButton pendingText="Ekleniyor…"><Plus className="size-3.5" /> Ekle</SubmitButton>
          </div>
          {s.fieldErrors?.name ? <p className="text-xs text-danger">{s.fieldErrors.name}</p> : <FormMessage state={s} />}
        </>
      )}
    </ActionForm>
  );
}
