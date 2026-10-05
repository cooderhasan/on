"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { cashMoveAction, deleteTransactionAction, settlementAction, transferAction } from "@/app/actions/sales";
import { ActionForm, FormMessage, SubmitButton } from "./forms";
import { Button, Input, Select } from "./ui";
import type { ActionState } from "@/lib/action-state";

type Account = { id: string; name: string; currency: string };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });

/** Faturaya veya cariye tahsilat / ödeme */
export function SettlementForm({ invoiceId, contactId, expenseId, employeeId, accounts, docCurrency, defaultAmount, label }: { invoiceId?: string; contactId?: string; expenseId?: string; employeeId?: string; accounts: Account[]; docCurrency: string; defaultAmount?: string; label: string }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const acc = accounts.find((a) => a.id === accountId);
  if (accounts.length === 0) return <p className="text-xs text-text-3">Önce Kasa ve Bankalar&apos;dan bir hesap ekleyin.</p>;
  return (
    <ActionForm action={settlementAction} resetOnSuccess className="gap-2">
      {(s) => (
        <>
          {invoiceId && <input type="hidden" name="invoiceId" value={invoiceId} />}
          {contactId && <input type="hidden" name="contactId" value={contactId} />}
          {expenseId && <input type="hidden" name="expenseId" value={expenseId} />}
          {employeeId && <input type="hidden" name="employeeId" value={employeeId} />}
          <Select name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Hesap">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input name="date" type="date" defaultValue={today()} aria-label="Tarih" />
            <Input name="amount" inputMode="decimal" defaultValue={defaultAmount?.replace(".", ",")} placeholder={`Tutar (${acc?.currency ?? ""})`} aria-label="Tutar" className="font-mono" />
          </div>
          {acc && acc.currency !== docCurrency && (
            <Input name="appliedAmount" inputMode="decimal" placeholder={`Cariye yansıyan (${docCurrency})`} aria-label="Cariye yansıyan tutar" className="font-mono" />
          )}
          <Input name="description" maxLength={300} placeholder="Açıklama (isteğe bağlı)" aria-label="Açıklama" />
          {s.fieldErrors && Object.values(s.fieldErrors)[0] ? <p className="text-xs text-danger">{Object.values(s.fieldErrors)[0]}</p> : null}
          <FormMessage state={s} />
          <SubmitButton variant="accent" pendingText="Kaydediliyor…">{label}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

/** Kasa / banka detayı: para girişi, çıkışı, virman */
export function CashForms({ account, accounts }: { account: Account; accounts: Account[] }) {
  const [tab, setTab] = useState<"in" | "out" | "transfer">("in");
  const others = accounts.filter((a) => a.id !== account.id);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const targetAcc = others.find((a) => a.id === target);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 overflow-hidden rounded-sm border border-border text-[11px] font-semibold uppercase">
        {([["in", "Para girişi"], ["out", "Para çıkışı"], ["transfer", "Virman"]] as const).map(([k, l], i) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`py-2 ${i > 0 ? "border-l border-border" : ""} ${tab === k ? "bg-white text-text" : "bg-card-muted text-text-2"}`}>{l}</button>
        ))}
      </div>
      {tab !== "transfer" ? (
        <ActionForm key={tab} action={cashMoveAction} resetOnSuccess className="gap-2">
          {(s) => (
            <>
              <input type="hidden" name="type" value={tab === "in" ? "DEPOSIT" : "WITHDRAWAL"} />
              <input type="hidden" name="accountId" value={account.id} />
              <div className="grid grid-cols-2 gap-2">
                <Input name="date" type="date" defaultValue={today()} aria-label="Tarih" />
                <Input name="amount" inputMode="decimal" placeholder={`Tutar (${account.currency})`} aria-label="Tutar" className="font-mono" />
              </div>
              <Input name="description" maxLength={300} placeholder={tab === "in" ? "Açıklama (ör. ortak sermaye)" : "Açıklama (ör. banka masrafı)"} aria-label="Açıklama" />
              {s.fieldErrors && Object.values(s.fieldErrors)[0] ? <p className="text-xs text-danger">{Object.values(s.fieldErrors)[0]}</p> : null}
              <FormMessage state={s} />
              <SubmitButton variant="accent" pendingText="Kaydediliyor…">Kaydet</SubmitButton>
            </>
          )}
        </ActionForm>
      ) : others.length === 0 ? (
        <p className="text-xs text-text-3">Virman için ikinci bir hesap ekleyin.</p>
      ) : (
        <ActionForm action={transferAction} resetOnSuccess className="gap-2">
          {(s) => (
            <>
              <input type="hidden" name="accountId" value={account.id} />
              <Select name="targetAccountId" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Giriş hesabı">
                {others.map((a) => <option key={a.id} value={a.id}>→ {a.name} ({a.currency})</option>)}
              </Select>
              <div className="grid grid-cols-2 gap-2">
                <Input name="date" type="date" defaultValue={today()} aria-label="Tarih" />
                <Input name="amount" inputMode="decimal" placeholder={`Çıkan (${account.currency})`} aria-label="Tutar" className="font-mono" />
              </div>
              {targetAcc && targetAcc.currency !== account.currency && <Input name="targetAmount" inputMode="decimal" placeholder={`Giren (${targetAcc.currency})`} aria-label="Giriş tutarı" className="font-mono" />}
              <Input name="description" maxLength={300} placeholder="Açıklama (isteğe bağlı)" aria-label="Açıklama" />
              {s.fieldErrors && Object.values(s.fieldErrors)[0] ? <p className="text-xs text-danger">{Object.values(s.fieldErrors)[0]}</p> : null}
              <FormMessage state={s} />
              <SubmitButton variant="accent" pendingText="Kaydediliyor…">Virman yap</SubmitButton>
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}

/** İki adımlı silme: önce "Sil", sonra "Evet, sil" (tarayıcı onay penceresi kullanılmaz) */
export function ConfirmDelete({ action, id, label = "Sil", confirmText = "Silinsin mi?", compact }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; id: string; label?: string; confirmText?: string; compact?: boolean }) {
  const [ask, setAsk] = useState(false);
  if (!ask) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setAsk(true)} aria-label={label} title={label}>
        <Trash2 className="size-3.5" /> {!compact && label}
      </Button>
    );
  }
  return (
    <ActionForm action={action} className="gap-1">
      {(s) => (
        <>
          <input type="hidden" name="id" value={id} />
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-text-2">{confirmText}</span>
            <SubmitButton variant="danger" pendingText="Siliniyor…">Evet, sil</SubmitButton>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAsk(false)}>Vazgeç</Button>
          </span>
          <FormMessage state={s} />
        </>
      )}
    </ActionForm>
  );
}

export function DeleteTransactionButton({ id }: { id: string }) {
  return <ConfirmDelete action={deleteTransactionAction} id={id} compact label="Hareketi sil" confirmText="Hareket silinsin mi?" />;
}
