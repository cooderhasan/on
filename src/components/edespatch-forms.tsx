"use client";

import { useState, useTransition } from "react";
import { FileDown, FileText, RefreshCw, Send } from "lucide-react";
import {
  ignoreIncomingDespatchAction, prepareDespatchAction, processIncomingDespatchAction, refreshDespatchAction, sendDespatchAction, syncIncomingDespatchAction,
} from "@/app/actions/edespatch";
import { ActionForm, FormMessage, SubmitButton } from "./forms";
import { Alert, Button, Select } from "./ui";
import { cn } from "@/lib/cn";

type Prep = Awaited<ReturnType<typeof prepareDespatchAction>>;
const linkBtn = "inline-flex h-8 items-center gap-1.5 rounded border border-border bg-card px-3 text-[11px] font-semibold uppercase text-text-2 hover:bg-card-muted";

/** Giden irsaliye detayında e-İrsaliye paneli: ön kontrol → gönder; sonrasında durum / görüntü */
export function DespatchPanel({ waybillId, status, canSend, hasError }: { waybillId: string; status: string; canSend: boolean; hasError: boolean }) {
  const [prep, setPrep] = useState<Prep | null>(null);
  const [pending, start] = useTransition();
  const sent = ["QUEUED", "SENT", "ACCEPTED", "REJECTED", "CANCELLED"].includes(status);

  if (sent) {
    return (
      <div className="flex flex-col gap-2">
        {status !== "QUEUED" && (
          <div className="flex flex-wrap gap-2">
            <a href={`/api/edespatch/${waybillId}/html`} target="_blank" rel="noopener" className={linkBtn}><FileText className="size-3.5" /> Görüntüle</a>
            <a href={`/api/edespatch/${waybillId}/pdf`} target="_blank" rel="noopener" className={linkBtn}><FileDown className="size-3.5" /> PDF</a>
          </div>
        )}
        <ActionForm action={refreshDespatchAction} className="gap-1">
          {(st) => (
            <>
              <input type="hidden" name="id" value={waybillId} />
              <SubmitButton pendingText="Sorgulanıyor…"><RefreshCw className="size-3.5" /> Durumu sorgula</SubmitButton>
              <FormMessage state={st} />
            </>
          )}
        </ActionForm>
      </div>
    );
  }
  if (!canSend) return <p className="text-xs text-text-3">e-İrsaliye göndermek için Yönetici veya Muhasebe yetkisi gerekir.</p>;
  if (!prep) {
    return (
      <Button type="button" variant="accent" disabled={pending} onClick={() => start(async () => setPrep(await prepareDespatchAction(waybillId)))}>
        <Send className="size-3.5" /> {pending ? "Kontrol ediliyor…" : hasError ? "Tekrar gönder" : "e-İrsaliye olarak gönder"}
      </Button>
    );
  }
  if (!prep.ok) return <Alert tone="danger">{prep.error} <button type="button" className="ml-1 underline" onClick={() => setPrep(null)}>Kapat</button></Alert>;
  return (
    <ActionForm action={sendDespatchAction} className="gap-2">
      {(st) => (
        <>
          <input type="hidden" name="id" value={waybillId} />
          <p className="text-xs text-text-2">
            {prep.alias ? <>Alıcı <b>e-İrsaliye kullanıcısı</b> ({prep.alias}).</> : <>Alıcı e-İrsaliye kullanıcısı değil.</>}{" "}
            <span className={cn("rounded-sm px-1 text-[10px] font-semibold uppercase text-white", prep.env === "Test" ? "bg-warning" : "bg-danger")}>{prep.env} ortamı</span>
          </p>
          {prep.errors.length > 0 ? (
            <Alert tone="danger">
              <p className="mb-1 font-medium">Göndermeden önce düzeltin:</p>
              <ul className="list-disc pl-4 text-xs">{prep.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </Alert>
          ) : (
            <p className="text-xs text-text-3">Gönderilen e-İrsaliye resmi belgedir; sonradan değiştirilemez ve silinemez.</p>
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

export function SyncIncomingDespatchButton() {
  return (
    <ActionForm action={syncIncomingDespatchAction} className="items-end gap-1">
      {(s) => (
        <>
          <SubmitButton pendingText="Alınıyor…"><RefreshCw className="size-3.5" /> e-İrsaliyeleri içeri al</SubmitButton>
          <FormMessage state={s} />
        </>
      )}
    </ActionForm>
  );
}

/** Gelen e-İrsaliye: gelen irsaliyeye işle (depo seçimi) / yok say / geri al */
export function IncomingDespatchActions({ id, status, warehouses }: { id: string; status: string; warehouses: Array<{ id: string; name: string; isDefault: boolean }> }) {
  const [open, setOpen] = useState(false);
  if (status === "IGNORED") {
    return (
      <ActionForm action={ignoreIncomingDespatchAction} className="gap-1">
        {(s) => (<><input type="hidden" name="id" value={id} /><input type="hidden" name="ignored" value="0" /><SubmitButton pendingText="…">Geri al</SubmitButton><FormMessage state={s} /></>)}
      </ActionForm>
    );
  }
  if (status !== "NEW") return null;
  return (
    <div className="flex flex-col items-end gap-2">
      {!open ? (
        <div className="flex gap-2">
          <Button type="button" variant="accent" size="sm" onClick={() => setOpen(true)}>Gelen irsaliyeye işle</Button>
          <ActionForm action={ignoreIncomingDespatchAction} className="gap-1">
            {(s) => (<><input type="hidden" name="id" value={id} /><input type="hidden" name="ignored" value="1" /><SubmitButton pendingText="…">Yok say</SubmitButton><FormMessage state={s} /></>)}
          </ActionForm>
        </div>
      ) : (
        <ActionForm action={processIncomingDespatchAction} className="w-60 gap-2">
          {(s) => (
            <>
              <input type="hidden" name="id" value={id} />
              {warehouses.length > 1 && (
                <Select name="warehouseId" defaultValue={warehouses.find((w) => w.isDefault)?.id} aria-label="Depo">
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              )}
              <p className="text-[11px] text-text-3">Adı birebir eşleşen ürünler stoğa girer; tedarikçi yoksa VKN ile açılır.</p>
              <FormMessage state={s} />
              <div className="flex gap-2">
                <SubmitButton variant="accent" pendingText="İşleniyor…">İşle</SubmitButton>
                <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>Vazgeç</Button>
              </div>
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}
