"use client";

import { Landmark, PenLine, Pencil, Scale, Type } from "lucide-react";
import { savePrintSettingsAction } from "@/app/actions/records";
import { ActionForm, FormMessage, SubmitButton } from "./forms";
import { FormRow, Textarea } from "./ui";

export interface PrintSettingsValues {
  footerNote: string | null;
  bankAccountIds: string[];
  showAmountInWords: boolean;
  showSignature: boolean;
  showContactBalance: boolean;
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 rounded-sm border border-[#d6d6d6] px-3 py-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="accent-accent" /> {label}
    </label>
  );
}

export function PrintSettingsForm({ values, banks }: { values: PrintSettingsValues; banks: Array<{ id: string; name: string; iban: string | null; currency: string }> }) {
  return (
    <ActionForm action={savePrintSettingsAction} className="gap-0">
      {(s) => (
        <>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          <div className="py-2">
            <FormRow label="Banka hesapları" icon={<Landmark />} hint="Seçilen hesapların IBAN'ı belgenin altına yazılır.">
              {banks.length === 0 ? (
                <p className="pt-2 text-sm text-text-3">IBAN&apos;ı girilmiş banka hesabı yok.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {banks.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="bankAccountId" value={b.id} defaultChecked={values.bankAccountIds.includes(b.id)} disabled={!b.iban} className="accent-accent" />
                      {b.name} <span className="font-mono text-xs text-text-3">{b.iban ?? "IBAN yok"} · {b.currency}</span>
                    </label>
                  ))}
                </div>
              )}
            </FormRow>
            <FormRow label="Yazıyla tutar" icon={<Type />}>
              <Check name="showAmountInWords" label="&quot;YALNIZ … TL&quot; satırını göster" defaultChecked={values.showAmountInWords} />
            </FormRow>
            <FormRow label="Müşteri bakiyesi" icon={<Scale />}>
              <Check name="showContactBalance" label="Faturada müşterinin güncel bakiyesini göster" defaultChecked={values.showContactBalance} />
            </FormRow>
            <FormRow label="İmza alanı" icon={<PenLine />}>
              <Check name="showSignature" label="Teslim eden / teslim alan imza alanı" defaultChecked={values.showSignature} />
            </FormRow>
            <FormRow label="Alt not" htmlFor="footerNote" icon={<Pencil />} hint="Her belgenin altına yazılır (ör. ödeme koşulları, teşekkür).">
              <Textarea id="footerNote" name="footerNote" rows={3} maxLength={1000} defaultValue={values.footerNote ?? ""} />
            </FormRow>
          </div>
          <div className="flex justify-end border-t border-border px-4 py-3">
            <SubmitButton variant="accent" pendingText="Kaydediliyor…">Kaydet</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
