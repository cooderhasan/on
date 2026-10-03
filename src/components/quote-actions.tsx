"use client";

import { convertQuoteAction, quoteStatusAction } from "@/app/actions/sales";
import { ActionForm, FormMessage, SubmitButton } from "./forms";
import { Card } from "./ui";

/** Teklif durum düğmeleri + faturaya dönüştür */
export function QuoteActions({ id, status }: { id: string; status: "OPEN" | "ACCEPTED" | "REJECTED" | "INVOICED" }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <ActionForm action={convertQuoteAction} className="gap-2">
        {(s) => (
          <>
            <input type="hidden" name="id" value={id} />
            <SubmitButton variant="accent" pendingText="Oluşturuluyor…">Faturaya dönüştür</SubmitButton>
            <p className="text-[11px] text-text-3">Bugün tarihli satış faturası oluşur; satırlar birebir aktarılır, stok çıkışı yapılır.</p>
            <FormMessage state={s} />
          </>
        )}
      </ActionForm>
      <div className="border-t border-border pt-3">
        <p className="mb-2 text-[11px] font-semibold uppercase text-text-2">Durum</p>
        <div className="flex flex-wrap gap-2">
          {([["ACCEPTED", "Kabul edildi"], ["REJECTED", "Reddedildi"], ["OPEN", "Açık"]] as const)
            .filter(([s]) => s !== status)
            .map(([s, label]) => (
              <ActionForm key={s} action={quoteStatusAction} className="gap-1">
                {(st) => (
                  <>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="status" value={s} />
                    <SubmitButton variant={s === "REJECTED" ? "danger" : "primary"}>{label}</SubmitButton>
                    <FormMessage state={st} />
                  </>
                )}
              </ActionForm>
            ))}
        </div>
      </div>
    </Card>
  );
}
