"use client";

import { Banknote, CalendarDays, Coins, Hash, Landmark, MapPin } from "lucide-react";
import { saveAccountAction } from "@/app/actions/records";
import { ActionForm, FormMessage } from "./forms";
import { FormHeader } from "./record-forms";
import { FormRow, Input, Select } from "./ui";
import { CURRENCIES } from "@/lib/units";

export interface AccountFormValues {
  id?: string;
  type: "CASH" | "BANK";
  name: string;
  currency: string;
  bankName: string | null;
  branch: string | null;
  accountNo: string | null;
  iban: string | null;
  openingBalance: string;
  openingDate: string | null;
}

export function AccountForm({ values, cancelHref }: { values: AccountFormValues; cancelHref: string }) {
  const bank = values.type === "BANK";
  return (
    <ActionForm action={saveAccountAction} className="gap-0">
      {(s) => (
        <>
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <input type="hidden" name="type" value={values.type} />
          <FormHeader cancelHref={cancelHref}>
            <FormRow label="Hesap ismi" htmlFor="name" icon={bank ? <Landmark /> : <Banknote />} error={s.fieldErrors?.name}>
              <Input id="name" name="name" required maxLength={120} defaultValue={values.name} placeholder={bank ? "ör. Ziraat TL hesabı" : "ör. Kasa Hesabı"} />
            </FormRow>
          </FormHeader>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          <div className="py-2">
            <FormRow label="Döviz cinsi" htmlFor="currency" icon={<Coins />} hint={values.id ? undefined : "Hesap açıldıktan sonra hareket varsa değiştirilmemelidir."}>
              <Select id="currency" name="currency" defaultValue={values.currency} className="max-w-40">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </FormRow>
            {bank && (
              <>
                <FormRow label="Banka adı" htmlFor="bankName" icon={<Landmark />} error={s.fieldErrors?.bankName}>
                  <Input id="bankName" name="bankName" maxLength={100} defaultValue={values.bankName ?? ""} />
                </FormRow>
                <FormRow label="Şube" htmlFor="branch" icon={<MapPin />}>
                  <Input id="branch" name="branch" maxLength={100} defaultValue={values.branch ?? ""} />
                </FormRow>
                <FormRow label="Hesap no" htmlFor="accountNo" icon={<Hash />}>
                  <Input id="accountNo" name="accountNo" maxLength={40} defaultValue={values.accountNo ?? ""} />
                </FormRow>
                <FormRow label="IBAN" htmlFor="iban" icon={<Hash />} error={s.fieldErrors?.iban}>
                  <Input id="iban" name="iban" defaultValue={values.iban ?? ""} placeholder="TR00 0000 0000 0000 0000 0000 00" className="font-mono" />
                </FormRow>
              </>
            )}
          </div>
          <div className="border-t border-border py-2">
            <FormRow label="Açılış bakiyesi" htmlFor="openingBalance" icon={<Coins />} error={s.fieldErrors?.openingBalance} hint="Hesabın bu programa geçtiğiniz tarihteki bakiyesi. Eksi olabilir (ör. kredili mevduat).">
              <Input id="openingBalance" name="openingBalance" inputMode="decimal" defaultValue={values.openingBalance === "0" ? "" : values.openingBalance.replace(".", ",")} placeholder="0,00" className="max-w-60 font-mono" />
            </FormRow>
            <FormRow label="Açılış tarihi" htmlFor="openingDate" icon={<CalendarDays />} error={s.fieldErrors?.openingDate}>
              <Input id="openingDate" name="openingDate" type="date" defaultValue={values.openingDate ?? ""} className="max-w-60" />
            </FormRow>
          </div>
        </>
      )}
    </ActionForm>
  );
}
