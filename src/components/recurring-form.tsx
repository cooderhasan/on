"use client";

import { useState } from "react";
import { setRecurringAction, stopRecurringAction } from "@/app/actions/sales";
import { ActionForm, FormMessage, SubmitButton } from "./forms";
import { Button, Input, Select } from "./ui";

export function RecurringForm({ invoiceId, values, active }: { invoiceId: string; values: { period: "MONTHLY" | "YEARLY"; interval: number; nextDate: string; endDate: string | null }; active: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open && active) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>Düzenle</Button>
        <ActionForm action={stopRecurringAction} className="gap-1">
          {(s) => (
            <>
              <input type="hidden" name="invoiceId" value={invoiceId} />
              <SubmitButton variant="danger" pendingText="…">Durdur</SubmitButton>
              <FormMessage state={s} />
            </>
          )}
        </ActionForm>
      </div>
    );
  }
  if (!open) return <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>Tekrarlayan yap</Button>;
  return (
    <ActionForm action={setRecurringAction} className="gap-2">
      {(s) => (
        <>
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-2">
            <Input name="interval" type="number" min={1} max={12} defaultValue={values.interval} aria-label="Aralık" />
            <Select name="period" defaultValue={values.period} aria-label="Dönem">
              <option value="MONTHLY">ayda bir</option>
              <option value="YEARLY">yılda bir</option>
            </Select>
          </div>
          <label className="text-[11px] text-text-2">Sonraki fatura tarihi<Input name="nextDate" type="date" defaultValue={values.nextDate} /></label>
          <label className="text-[11px] text-text-2">Bitiş (isteğe bağlı)<Input name="endDate" type="date" defaultValue={values.endDate ?? ""} /></label>
          {s.fieldErrors && Object.values(s.fieldErrors)[0] && <p className="text-xs text-danger">{Object.values(s.fieldErrors)[0]}</p>}
          <FormMessage state={s} />
          <p className="text-[11px] text-text-3">Kopya taslak olarak oluşur; e-Fatura / e-Arşiv gönderimini siz yaparsınız.</p>
          <div className="flex gap-2">
            <SubmitButton variant="accent" pendingText="Kaydediliyor…">Kaydet</SubmitButton>
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>Vazgeç</Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
