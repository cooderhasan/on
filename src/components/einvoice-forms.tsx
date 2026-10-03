"use client";

import { useState, useTransition } from "react";
import { FileDown, FileText, KeyRound, Link2, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { cancelArchiveAction, prepareSendAction, refreshStatusAction, saveEInvoiceSettingsAction, sendInvoiceAction, testConnectionAction } from "@/app/actions/einvoice";
import { ActionForm, FormMessage, SubmitButton } from "./forms";
import { FormHeader } from "./record-forms";
import { Alert, Button, FormRow, Input, Select } from "./ui";
import { ConfirmDelete } from "./money-forms";
import { EINVOICE_PROFILES } from "@/lib/gib-codes";
import { cn } from "@/lib/cn";

export function EInvoiceSettingsForm({ s }: { s: { apiUrl: string; hasKey: boolean; apiKeyLast4: string | null; senderAlias: string | null; eInvoiceSeries: string | null; eArchiveSeries: string | null; defaultProfile: string } }) {
  return (
    <>
      <ActionForm action={saveEInvoiceSettingsAction} className="gap-0">
        {(st) => (
          <>
            <FormHeader cancelHref="/e-fatura-ayarlari">
              <span className="flex items-center gap-3 px-4 text-lg text-text"><ShieldCheck className="size-7 text-text-3" /> NES bağlantısı</span>
            </FormHeader>
            {(st.error || st.message) && <div className="px-4 pt-3"><FormMessage state={st} /></div>}
            <div className="py-2">
              <FormRow label="Ortam" icon={<Link2 />} hint="Geliştirme ve denemede Test ortamını kullanın; canlıda kesilen fatura resmi belgedir.">
                <div className="grid grid-cols-2 overflow-hidden rounded-sm border border-[#d6d6d6] text-sm">
                  {([["https://apitest.nes.com.tr/", "Test"], ["https://api.nes.com.tr/", "Canlı"]] as const).map(([v, l], i) => (
                    <label key={v} className={cn("flex cursor-pointer items-center gap-2 px-3 py-2 font-medium has-[:checked]:bg-white", i > 0 && "border-l border-[#d6d6d6]", "bg-card-muted")}>
                      <input type="radio" name="apiUrl" value={v} defaultChecked={s.apiUrl === v} className="accent-accent" />
                      {l} <span className="hidden text-xs font-normal text-text-3 sm:inline">{v.replace("https://", "")}</span>
                    </label>
                  ))}
                </div>
              </FormRow>
              <FormRow label="API anahtarı" htmlFor="apiKey" icon={<KeyRound />} error={st.fieldErrors?.apiKey} hint={s.hasKey ? `Kayıtlı anahtar: ••••${s.apiKeyLast4}. Değiştirmek için yenisini yazın; boş bırakırsanız mevcut anahtar korunur.` : "NES Portal › API Anahtarı Üretimi'nden alınan Bearer anahtarı. Şifreli saklanır, bir daha gösterilmez."}>
                <Input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder={s.hasKey ? "Değiştirmek için yeni anahtar" : "API anahtarı"} className="font-mono" />
              </FormRow>
              <FormRow label="e-Fatura serisi" htmlFor="eInvoiceSeries" icon={<FileText />} error={st.fieldErrors?.eInvoiceSeries} hint="NES portalında tanımlı 3 karakter (ör. ABC). Fatura numarasını NES verir.">
                <Input id="eInvoiceSeries" name="eInvoiceSeries" maxLength={3} defaultValue={s.eInvoiceSeries ?? ""} className="w-28 font-mono uppercase" />
              </FormRow>
              <FormRow label="e-Arşiv serisi" htmlFor="eArchiveSeries" icon={<FileText />} error={st.fieldErrors?.eArchiveSeries}>
                <Input id="eArchiveSeries" name="eArchiveSeries" maxLength={3} defaultValue={s.eArchiveSeries ?? ""} className="w-28 font-mono uppercase" />
              </FormRow>
              <FormRow label="Varsayılan senaryo" htmlFor="defaultProfile" icon={<Send />} hint="Alıcı e-Fatura mükellefiyse kullanılır; gönderirken değiştirilebilir.">
                <Select id="defaultProfile" name="defaultProfile" defaultValue={s.defaultProfile}>
                  {EINVOICE_PROFILES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
              </FormRow>
              <FormRow label="Gönderici etiketi (GB)" htmlFor="senderAlias" icon={<Link2 />} hint="Boşsa 'Bağlantıyı test et' NES'ten otomatik doldurur.">
                <Input id="senderAlias" name="senderAlias" defaultValue={s.senderAlias ?? ""} placeholder="urn:mail:defaultgb@…" className="font-mono" />
              </FormRow>
            </div>
          </>
        )}
      </ActionForm>
      <div className="border-t border-border px-4 py-4">
        <ActionForm action={testConnectionAction} className="gap-2">
          {(st) => (
            <>
              <SubmitButton variant="accent" pendingText="Bağlanılıyor…" className="self-start"><RefreshCw className="size-3.5" /> Bağlantıyı test et</SubmitButton>
              <FormMessage state={st} />
            </>
          )}
        </ActionForm>
      </div>
    </>
  );
}

type Prep = Awaited<ReturnType<typeof prepareSendAction>>;

/** Fatura detayında e-belge paneli: ön kontrol → senaryo seçimi → gönder; sonrasında durum / PDF / iptal */
export function EDocPanel({ invoiceId, status, profile, canSend, hasError }: { invoiceId: string; status: string; profile: string | null; canSend: boolean; hasError: boolean }) {
  const [prep, setPrep] = useState<Prep | null>(null);
  const [pending, start] = useTransition();
  const sent = ["QUEUED", "SENT", "ACCEPTED", "REJECTED", "CANCELLED"].includes(status);

  if (sent) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {status !== "QUEUED" && (
            <>
              <a href={`/api/einvoice/${invoiceId}/html`} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-card px-3 text-[11px] font-semibold uppercase text-text-2 hover:bg-card-muted"><FileText className="size-3.5" /> Görüntüle</a>
              <a href={`/api/einvoice/${invoiceId}/pdf`} className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-card px-3 text-[11px] font-semibold uppercase text-text-2 hover:bg-card-muted"><FileDown className="size-3.5" /> PDF</a>
            </>
          )}
        </div>
        <ActionForm action={refreshStatusAction} className="gap-1">
          {(st) => (
            <>
              <input type="hidden" name="id" value={invoiceId} />
              <SubmitButton pendingText="Sorgulanıyor…"><RefreshCw className="size-3.5" /> Durumu sorgula</SubmitButton>
              <FormMessage state={st} />
            </>
          )}
        </ActionForm>
        {canSend && profile === "EARSIVFATURA" && (status === "SENT" || status === "ACCEPTED") && (
          <ConfirmDelete action={cancelArchiveAction} id={invoiceId} label="e-Arşiv'i iptal et" confirmText="Fatura GİB'e iptal olarak bildirilecek. Emin misiniz?" />
        )}
      </div>
    );
  }

  if (!canSend) return <p className="text-xs text-text-3">e-Belge göndermek için Yönetici veya Muhasebe yetkisi gerekir.</p>;

  if (!prep) {
    return (
      <Button type="button" variant="accent" disabled={pending} onClick={() => start(async () => setPrep(await prepareSendAction(invoiceId)))}>
        <Send className="size-3.5" /> {pending ? "Kontrol ediliyor…" : hasError ? "Tekrar gönder" : "e-Belge olarak gönder"}
      </Button>
    );
  }
  if (!prep.ok) return <Alert tone="danger">{prep.error} <button type="button" className="ml-1 underline" onClick={() => setPrep(null)}>Kapat</button></Alert>;

  return (
    <ActionForm action={sendInvoiceAction} className="gap-2">
      {(st) => (
        <>
          <input type="hidden" name="id" value={invoiceId} />
          <p className="text-xs text-text-2">
            {prep.isEInvoiceUser ? <>Alıcı <b>e-Fatura mükellefi</b> ({prep.alias}).</> : <>Alıcı e-Fatura mükellefi değil → <b>e-Arşiv</b>.</>}{" "}
            <span className={cn("rounded-sm px-1 text-[10px] font-semibold uppercase text-white", prep.env === "Test" ? "bg-warning" : "bg-danger")}>{prep.env} ortamı</span>
          </p>
          {prep.isEInvoiceUser ? (
            <Select name="profile" defaultValue={prep.profile} aria-label="Senaryo">
              {EINVOICE_PROFILES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          ) : (
            <>
              <input type="hidden" name="profile" value="EARSIVFATURA" />
              <Select name="sendType" defaultValue="ELEKTRONIK" aria-label="Gönderim şekli">
                <option value="ELEKTRONIK">Elektronik (e-posta ile iletilir)</option>
                <option value="KAGIT">Kağıt (çıktısı verilir)</option>
              </Select>
            </>
          )}
          {prep.errors.length > 0 ? (
            <Alert tone="danger">
              <p className="mb-1 font-medium">Göndermeden önce düzeltin:</p>
              <ul className="list-disc pl-4 text-xs">{prep.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </Alert>
          ) : (
            <p className="text-xs text-text-3">Gönderilen fatura resmi belgedir; sonradan değiştirilemez.</p>
          )}
          <div className="flex gap-2">
            <SubmitButton variant="accent" pendingText="Gönderiliyor…" className={prep.errors.length ? "pointer-events-none opacity-50" : undefined}><Send className="size-3.5" /> Gönder</SubmitButton>
            <Button type="button" variant="secondary" onClick={() => setPrep(null)}>Vazgeç</Button>
          </div>
          <FormMessage state={st} />
        </>
      )}
    </ActionForm>
  );
}
