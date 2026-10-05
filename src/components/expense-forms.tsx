"use client";

import { useState } from "react";
import Decimal from "decimal.js";
import { Calendar, CircleCheck, CircleX, CreditCard, FileText, Hash, Landmark, Mail, Percent, Phone, Tag, Truck, User, Wallet } from "lucide-react";
import { answerIncomingAction, ignoreIncomingAction, processIncomingAction, saveEmployeeAction, saveExpenseAction, syncIncomingAction } from "@/app/actions/expenses";
import { ActionForm, FormMessage, SubmitButton } from "./forms";
import { FormHeader } from "./record-forms";
import { Button, FormRow, Input, Select, Textarea } from "./ui";
import { Money } from "./money";
import { VAT_RATES } from "@/lib/units";
import { parseMoneyInput } from "@/lib/money";

type Opt = { id: string; name: string };

export interface ExpenseFormValues {
  id?: string;
  kind: "RECEIPT" | "SALARY" | "TAX" | "BANK_FEE";
  description: string;
  date: string;
  dueDate: string;
  categoryId: string | null;
  contactId: string | null;
  employeeId: string | null;
  totalAmount: string;
  vatRate: number;
  receiptNo: string | null;
}

const KIND_TITLE = { RECEIPT: "Fiş / fatura", SALARY: "Maaş / prim", TAX: "Vergi / SGK primi", BANK_FEE: "Banka gideri" } as const;

/** Hızlı fiş / maaş / vergi / banka gideri formu (Paraşüt: tek tutar, KDV dahil) */
export function ExpenseForm({ values, categories, suppliers, employees, cancelHref }: { values: ExpenseFormValues; categories: Opt[]; suppliers: Opt[]; employees: Opt[]; cancelHref: string }) {
  const [total, setTotal] = useState(values.totalAmount);
  const [vat, setVat] = useState(values.vatRate);
  const t = parseMoneyInput(total);
  const net = t ? t.times(100).dividedBy(100 + vat).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : null;
  const k = values.kind;
  return (
    <ActionForm action={saveExpenseAction} className="gap-0">
      {(s) => (
        <>
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <input type="hidden" name="kind" value={k} />
          <FormHeader cancelHref={cancelHref}>
            <FormRow label="Açıklama" htmlFor="description" icon={<FileText />} error={s.fieldErrors?.description}>
              <Input id="description" name="description" required maxLength={300} defaultValue={values.description} placeholder={KIND_TITLE[k]} />
            </FormRow>
          </FormHeader>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          <div className="py-2">
            {k === "SALARY" && (
              <FormRow label="Çalışan" htmlFor="employeeId" icon={<User />} error={s.fieldErrors?.employeeId}>
                <Select id="employeeId" name="employeeId" defaultValue={values.employeeId ?? ""}>
                  <option value="">Çalışan seçin…</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </Select>
              </FormRow>
            )}
            {k === "RECEIPT" && (
              <FormRow label="Tedarikçi" htmlFor="contactId" icon={<Truck />} hint="İsteğe bağlı. Seçilirse tedarikçinin bakiyesine borç yazılır.">
                <Select id="contactId" name="contactId" defaultValue={values.contactId ?? ""}>
                  <option value="">Tedarikçisiz</option>
                  {suppliers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </FormRow>
            )}
            <FormRow label="Düzenleme tarihi" htmlFor="date" icon={<Calendar />} error={s.fieldErrors?.date}>
              <Input id="date" name="date" type="date" defaultValue={values.date} required className="max-w-60" />
            </FormRow>
            <FormRow label="Ödeme tarihi" htmlFor="dueDate" icon={<Calendar />} error={s.fieldErrors?.dueDate} hint="Ödenmesi gereken tarih (boşsa düzenleme tarihi).">
              <Input id="dueDate" name="dueDate" type="date" defaultValue={values.dueDate} className="max-w-60" />
            </FormRow>
            {k === "RECEIPT" && (
              <FormRow label="Fiş / fatura no" htmlFor="receiptNo" icon={<Hash />}>
                <Input id="receiptNo" name="receiptNo" maxLength={40} defaultValue={values.receiptNo ?? ""} className="max-w-60" />
              </FormRow>
            )}
            <FormRow label="Kategori" htmlFor="categoryId" icon={<Tag />}>
              <Select id="categoryId" name="categoryId" defaultValue={values.categoryId ?? ""}>
                <option value="">Kategorisiz</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormRow>
          </div>
          <div className="border-t border-border py-2">
            <FormRow label={k === "RECEIPT" ? "Toplam tutar (KDV dahil)" : "Tutar"} htmlFor="totalAmount" icon={<Wallet />} error={s.fieldErrors?.totalAmount}>
              <Input id="totalAmount" name="totalAmount" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0,00" className="max-w-60 font-mono" />
            </FormRow>
            {k === "RECEIPT" && (
              <FormRow label="KDV" htmlFor="vatRate" icon={<Percent />} hint={net && t ? undefined : "Fişteki KDV oranı."}>
                <div className="flex flex-wrap items-center gap-3">
                  <Select id="vatRate" name="vatRate" value={vat} onChange={(e) => setVat(Number(e.target.value))} className="w-32">
                    {VAT_RATES.map((r) => <option key={r} value={r}>%{r}</option>)}
                  </Select>
                  {net && t && <span className="text-xs text-text-3">Matrah <Money value={net} /> · KDV <Money value={t.minus(net)} /></span>}
                </div>
              </FormRow>
            )}
          </div>
        </>
      )}
    </ActionForm>
  );
}

export interface EmployeeFormValues { id?: string; name: string; tckn: string | null; email: string | null; phone: string | null; iban: string | null; categoryId: string | null; startDate: string | null; notes: string | null }

export function EmployeeForm({ values, categories, cancelHref }: { values: EmployeeFormValues; categories: Opt[]; cancelHref: string }) {
  return (
    <ActionForm action={saveEmployeeAction} className="gap-0">
      {(s) => (
        <>
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <FormHeader cancelHref={cancelHref}>
            <FormRow label="Ad soyad" htmlFor="name" icon={<User />} error={s.fieldErrors?.name}>
              <Input id="name" name="name" required maxLength={150} defaultValue={values.name} />
            </FormRow>
          </FormHeader>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          <div className="py-2">
            <FormRow label="T.C. kimlik no" htmlFor="tckn" icon={<Hash />} error={s.fieldErrors?.tckn}>
              <Input id="tckn" name="tckn" inputMode="numeric" maxLength={11} defaultValue={values.tckn ?? ""} className="max-w-60 font-mono" />
            </FormRow>
            <FormRow label="E-posta" htmlFor="email" icon={<Mail />}>
              <Input id="email" name="email" type="email" defaultValue={values.email ?? ""} />
            </FormRow>
            <FormRow label="Telefon" htmlFor="phone" icon={<Phone />}>
              <Input id="phone" name="phone" type="tel" defaultValue={values.phone ?? ""} />
            </FormRow>
            <FormRow label="IBAN" htmlFor="iban" icon={<Landmark />} error={s.fieldErrors?.iban}>
              <Input id="iban" name="iban" defaultValue={values.iban ?? ""} placeholder="TR00 0000 0000 0000 0000 0000 00" className="font-mono" />
            </FormRow>
            <FormRow label="İşe başlama" htmlFor="startDate" icon={<Calendar />}>
              <Input id="startDate" name="startDate" type="date" defaultValue={values.startDate ?? ""} className="max-w-60" />
            </FormRow>
            <FormRow label="Kategori" htmlFor="categoryId" icon={<Tag />}>
              <Select id="categoryId" name="categoryId" defaultValue={values.categoryId ?? ""}>
                <option value="">Kategorisiz</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormRow>
            <FormRow label="Notlar" htmlFor="notes" icon={<FileText />}>
              <Textarea id="notes" name="notes" rows={2} defaultValue={values.notes ?? ""} />
            </FormRow>
          </div>
        </>
      )}
    </ActionForm>
  );
}

// ── Gelen e-faturalar ──────────────────────────────────────

export function SyncIncomingButton() {
  return (
    <ActionForm action={syncIncomingAction} className="flex-row items-center gap-2">
      {(s) => (
        <>
          <SubmitButton pendingText="İçeri alınıyor…">Faturaları içeri al</SubmitButton>
          <FormMessage state={s} />
        </>
      )}
    </ActionForm>
  );
}

/** Satır işlemleri: gidere işle (kategori + stok), kabul / ret (ticari), yok say */
export function IncomingActions({ id, status, canAnswer, categories }: { id: string; status: "NEW" | "PROCESSED" | "IGNORED"; canAnswer: boolean; categories: Opt[] }) {
  const [mode, setMode] = useState<null | "process" | "reject">(null);
  if (status === "IGNORED") {
    return (
      <ActionForm action={ignoreIncomingAction} className="gap-1">
        {(s) => (
          <>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="ignored" value="0" />
            <SubmitButton variant="primary" pendingText="…">Geri al</SubmitButton>
            <FormMessage state={s} />
          </>
        )}
      </ActionForm>
    );
  }
  if (mode === "process") {
    return (
      <ActionForm action={processIncomingAction} className="gap-2">
        {(s) => (
          <>
            <input type="hidden" name="id" value={id} />
            <Select name="categoryId" defaultValue="" aria-label="Gider kategorisi" className="h-8 text-xs">
              <option value="">Kategorisiz</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select name="stockMode" defaultValue="WITH_INVOICE" aria-label="Stok" className="h-8 text-xs">
              <option value="WITH_INVOICE">Stok girişi yapılsın</option>
              <option value="NONE">Stok girişi yapılmasın</option>
            </Select>
            <div className="flex gap-2">
              <SubmitButton variant="accent" pendingText="İşleniyor…">Gidere işle</SubmitButton>
              <Button type="button" variant="secondary" size="sm" onClick={() => setMode(null)}>Vazgeç</Button>
            </div>
            <FormMessage state={s} />
          </>
        )}
      </ActionForm>
    );
  }
  if (mode === "reject") {
    return (
      <ActionForm action={answerIncomingAction} className="gap-2">
        {(s) => (
          <>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="answer" value="RED" />
            <Input name="note" placeholder="Ret gerekçesi" maxLength={500} className="h-8 text-xs" aria-label="Ret gerekçesi" />
            <div className="flex gap-2">
              <SubmitButton variant="danger" pendingText="Gönderiliyor…">Reddet</SubmitButton>
              <Button type="button" variant="secondary" size="sm" onClick={() => setMode(null)}>Vazgeç</Button>
            </div>
            <FormMessage state={s} />
          </>
        )}
      </ActionForm>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {status === "NEW" && <Button type="button" variant="accent" size="sm" onClick={() => setMode("process")}><CreditCard className="size-3.5" /> Gidere işle</Button>}
      {canAnswer && (
        <>
          <ActionForm action={answerIncomingAction} className="gap-1">
            {(s) => (
              <>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="answer" value="KABUL" />
                <SubmitButton variant="success" pendingText="…"><CircleCheck className="size-3.5" /> Kabul</SubmitButton>
                <FormMessage state={s} />
              </>
            )}
          </ActionForm>
          {status === "NEW" && <Button type="button" variant="secondary" size="sm" onClick={() => setMode("reject")}><CircleX className="size-3.5" /> Ret</Button>}
        </>
      )}
      {status === "NEW" && (
        <ActionForm action={ignoreIncomingAction} className="gap-1">
          {(s) => (
            <>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="ignored" value="1" />
              <SubmitButton variant="primary" pendingText="…">Yok say</SubmitButton>
              <FormMessage state={s} />
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}
