"use client";

import { useState } from "react";
import { Briefcase, Building2, FileText, Globe, Hash, Landmark, Mail, MapPin, Phone } from "lucide-react";
import { saveCompanyAction } from "@/app/actions/records";
import { ActionForm, FormMessage, SubmitButton } from "./forms";
import { FormRow, Input, LinkButton, Select, Textarea } from "./ui";
import { CITIES } from "@/lib/turkey";

/** Paraşüt form başlık çubuğu: solda başlık alanı, sağda Vazgeç / Kaydet */
export function FormHeader({ cancelHref, children }: { cancelHref: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 [&>div]:px-4">{children}</div>
      <div className="flex gap-2 self-end px-4 sm:self-auto">
        <LinkButton href={cancelHref} variant="secondary">Vazgeç</LinkButton>
        <SubmitButton pendingText="Kaydediliyor…">Kaydet</SubmitButton>
      </div>
    </div>
  );
}

export function CitySelect({ name, defaultValue, id }: { name: string; defaultValue?: string | null; id?: string }) {
  return (
    <Select id={id} name={name} defaultValue={defaultValue ?? ""}>
      <option value="">İl seçin</option>
      {CITIES.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
      {defaultValue && !(CITIES as readonly string[]).includes(defaultValue) && <option value={defaultValue}>{defaultValue}</option>}
    </Select>
  );
}

export type CompanyValues = {
  title: string; taxNumber: string | null; taxOffice: string | null; address: string | null; district: string | null; city: string | null;
  postalCode: string | null; phone: string | null; email: string | null; website: string | null; sector: string | null; mersisNo: string | null; tradeRegNo: string | null;
} | null;

export function CompanyForm({ company }: { company: CompanyValues }) {
  return (
    <ActionForm action={saveCompanyAction} className="gap-0">
      {(s) => (
        <>
          <FormHeader cancelHref="/firma-bilgileri">
            <span className="flex items-center gap-3 text-lg text-text"><Building2 className="size-7 text-text-3" /> Firma Bilgileri</span>
          </FormHeader>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          <div className="py-2">
            <FormRow label="Ticari unvan" htmlFor="title" icon={<Building2 />} error={s.fieldErrors?.title} hint="Faturalarda satıcı adı olarak görünür.">
              <Input id="title" name="title" defaultValue={company?.title} required maxLength={250} />
            </FormRow>
            <FormRow label="VKN / TCKN" htmlFor="taxNumber" icon={<Hash />} error={s.fieldErrors?.taxNumber} hint="Şahıs şirketinde 11 haneli TCKN.">
              <Input id="taxNumber" name="taxNumber" inputMode="numeric" defaultValue={company?.taxNumber ?? ""} maxLength={11} />
            </FormRow>
            <FormRow label="Vergi dairesi" htmlFor="taxOffice" icon={<Landmark />} error={s.fieldErrors?.taxOffice}>
              <Input id="taxOffice" name="taxOffice" defaultValue={company?.taxOffice ?? ""} />
            </FormRow>
            <FormRow label="Sektör" htmlFor="sector" icon={<Briefcase />}>
              <Input id="sector" name="sector" defaultValue={company?.sector ?? ""} />
            </FormRow>
            <FormRow label="Mersis no" htmlFor="mersisNo" icon={<FileText />}>
              <Input id="mersisNo" name="mersisNo" defaultValue={company?.mersisNo ?? ""} />
            </FormRow>
            <FormRow label="Ticaret sicil no" htmlFor="tradeRegNo" icon={<FileText />}>
              <Input id="tradeRegNo" name="tradeRegNo" defaultValue={company?.tradeRegNo ?? ""} />
            </FormRow>
          </div>
          <div className="border-t border-border py-2">
            <FormRow label="Açık adres" htmlFor="address" icon={<MapPin />} error={s.fieldErrors?.address}>
              <Textarea id="address" name="address" rows={2} defaultValue={company?.address ?? ""} />
            </FormRow>
            <FormRow label="İlçe, il" htmlFor="district" icon={<MapPin />}>
              <div className="grid grid-cols-2 gap-2">
                <Input id="district" name="district" placeholder="İlçe" defaultValue={company?.district ?? ""} />
                <CitySelect name="city" defaultValue={company?.city} />
              </div>
            </FormRow>
            <FormRow label="Posta kodu" htmlFor="postalCode" icon={<MapPin />}>
              <Input id="postalCode" name="postalCode" inputMode="numeric" defaultValue={company?.postalCode ?? ""} className="max-w-40" />
            </FormRow>
            <FormRow label="Telefon" htmlFor="phone" icon={<Phone />} error={s.fieldErrors?.phone}>
              <Input id="phone" name="phone" type="tel" defaultValue={company?.phone ?? ""} />
            </FormRow>
            <FormRow label="E-posta" htmlFor="email" icon={<Mail />} error={s.fieldErrors?.email}>
              <Input id="email" name="email" type="email" defaultValue={company?.email ?? ""} />
            </FormRow>
            <FormRow label="Web sitesi" htmlFor="website" icon={<Globe />}>
              <Input id="website" name="website" defaultValue={company?.website ?? ""} />
            </FormRow>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Tekrarlanan satır listesi (IBAN, yetkili kişi) — boş satır eklenip silinebilir */
export function useRepeater<T>(initial: T[], empty: T) {
  const [rows, setRows] = useState<Array<T & { _k: number }>>(() => initial.map((r, i) => ({ ...r, _k: i })));
  const [next, setNext] = useState(initial.length);
  return {
    rows,
    add: () => {
      setRows((r) => [...r, { ...empty, _k: next }]);
      setNext((n) => n + 1);
    },
    remove: (k: number) => setRows((r) => r.filter((x) => x._k !== k)),
  };
}
