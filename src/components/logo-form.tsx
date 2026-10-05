"use client";

import { deleteLogoAction, saveLogoAction } from "@/app/actions/records";
import { ActionForm, FormMessage, SubmitButton } from "./forms";

/** Firma logosu yükle / kaldır (PNG, JPEG, WebP — en fazla 300 KB) */
export function LogoForm({ hasLogo }: { hasLogo: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <ActionForm action={saveLogoAction} resetOnSuccess className="gap-2">
        {(s) => (
          <>
            <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" aria-label="Logo dosyası" className="text-sm file:mr-3 file:rounded-sm file:border-0 file:bg-card-muted file:px-3 file:py-1.5 file:text-xs file:font-semibold file:uppercase" />
            <p className="text-[11px] text-text-3">PNG, JPEG veya WebP · en fazla 300 KB · yatay logo önerilir.</p>
            {s.fieldErrors?.logo && <p className="text-xs text-danger">{s.fieldErrors.logo}</p>}
            <FormMessage state={s} />
            <SubmitButton variant="accent" pendingText="Yükleniyor…" className="self-start">{hasLogo ? "Logoyu değiştir" : "Logo yükle"}</SubmitButton>
          </>
        )}
      </ActionForm>
      {hasLogo && (
        <ActionForm action={deleteLogoAction} className="gap-1">
          {(s) => (
            <>
              <SubmitButton variant="danger" pendingText="…" className="self-start">Logoyu kaldır</SubmitButton>
              <FormMessage state={s} />
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}
