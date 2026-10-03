"use client";

import { useState } from "react";
import { Building2, CalendarDays, Coins, Hash, Landmark, List, Mail, MapPin, Phone, Plus, Printer, RotateCcw, Tag, Trash2, User } from "lucide-react";
import { saveContactAction } from "@/app/actions/records";
import { ActionForm, FormMessage } from "./forms";
import { CitySelect, FormHeader, useRepeater } from "./record-forms";
import { Button, FormRow, Input, Select, Textarea } from "./ui";
import { CURRENCIES } from "@/lib/units";
import { cn } from "@/lib/cn";

export interface ContactFormValues {
  id?: string;
  kind: "CUSTOMER" | "SUPPLIER";
  personType: "LEGAL" | "NATURAL";
  title: string;
  shortName: string | null;
  taxNumber: string | null;
  taxOffice: string | null;
  categoryId: string | null;
  email: string | null;
  phone: string | null;
  fax: string | null;
  address: string | null;
  isAbroad: boolean;
  postalCode: string | null;
  district: string | null;
  city: string | null;
  country: string | null;
  currency: string;
  rateType: "BUYING" | "SELLING";
  openingBalance: string | null;
  openingBalanceSide: "DEBIT" | "CREDIT" | null;
  openingBalanceDate: string | null;
  notes: string | null;
  ibans: string[];
  people: Array<{ name: string; email: string | null; phone: string | null; notes: string | null }>;
}

/** İki seçenekli Paraşüt düğmesi (Tüzel / Gerçek kişi, Alış / Satış) */
function Segmented<T extends string>({ name, value, onChange, options }: { name: string; value: T; onChange?: (v: T) => void; options: Array<[T, string]> }) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-sm border border-[#d6d6d6] text-sm">
      {options.map(([v, label], i) => (
        <label key={v} className={cn("flex cursor-pointer items-center gap-2 px-3 py-2", i > 0 && "border-l border-[#d6d6d6]", value === v ? "bg-white font-medium" : "bg-card-muted text-text-2")}>
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange?.(v)} className="accent-accent" />
          {label}
        </label>
      ))}
    </div>
  );
}

export function ContactForm({ values, categories, cancelHref }: { values: ContactFormValues; categories: Array<{ id: string; name: string }>; cancelHref: string }) {
  const [personType, setPersonType] = useState(values.personType);
  const [rateType, setRateType] = useState(values.rateType);
  const [abroad, setAbroad] = useState(values.isAbroad);
  const [opening, setOpening] = useState(Boolean(values.openingBalance));
  const ibans = useRepeater(values.ibans.length ? values.ibans.map((iban) => ({ iban })) : [{ iban: "" }], { iban: "" });
  const people = useRepeater(values.people, { name: "", email: null, phone: null, notes: null });
  const isNatural = personType === "NATURAL";

  return (
    <ActionForm action={saveContactAction} className="gap-0">
      {(s) => (
        <>
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <input type="hidden" name="kind" value={values.kind} />
          <FormHeader cancelHref={cancelHref}>
            <FormRow label="VKN / TCKN" htmlFor="taxNumber" icon={<Hash />} error={s.fieldErrors?.taxNumber} hint="Kontrol hanesi doğrulanır. NES bağlandığında (Faz 3) mükellef bilgileri otomatik doldurulacak.">
              <Input id="taxNumber" name="taxNumber" inputMode="numeric" maxLength={11} defaultValue={values.taxNumber ?? ""} />
            </FormRow>
          </FormHeader>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}

          <div className="py-2">
            <FormRow label="Türü" icon={<Building2 />} hint="Şahıs şirketleri dahil LTD, AŞ vb. tüm şirketler Tüzel Kişi kapsamındadır.">
              <Segmented name="personType" value={personType} onChange={setPersonType} options={[["LEGAL", "Tüzel Kişi"], ["NATURAL", "Gerçek Kişi"]]} />
            </FormRow>
            <FormRow label={isNatural ? "Ad soyad" : "Firma unvanı"} htmlFor="title" icon={isNatural ? <User /> : <Building2 />} error={s.fieldErrors?.title}>
              <Input id="title" name="title" required maxLength={250} defaultValue={values.title} />
            </FormRow>
            <FormRow label="Kısa isim" htmlFor="shortName" icon={<Tag />} hint="Listelerde ve aramada kullanılır.">
              <Input id="shortName" name="shortName" maxLength={100} defaultValue={values.shortName ?? ""} />
            </FormRow>
            <FormRow label="Vergi dairesi" htmlFor="taxOffice" icon={<Landmark />}>
              <Input id="taxOffice" name="taxOffice" maxLength={100} defaultValue={values.taxOffice ?? ""} />
            </FormRow>
            <FormRow label="Kategori" htmlFor="categoryId" icon={<Tag />} error={s.fieldErrors?.categoryId}>
              <Select id="categoryId" name="categoryId" defaultValue={values.categoryId ?? ""}>
                <option value="">Kategorisiz</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </FormRow>
          </div>

          <div className="border-t border-border py-2">
            <FormRow label="E-posta adresi" htmlFor="email" icon={<Mail />} error={s.fieldErrors?.email} hint="e-Arşiv faturalar bu adrese gönderilir.">
              <Input id="email" name="email" type="email" defaultValue={values.email ?? ""} />
            </FormRow>
            <FormRow label="Telefon numarası" htmlFor="phone" icon={<Phone />} error={s.fieldErrors?.phone}>
              <Input id="phone" name="phone" type="tel" defaultValue={values.phone ?? ""} />
            </FormRow>
            <FormRow label="Faks numarası" htmlFor="fax" icon={<Printer />} error={s.fieldErrors?.fax}>
              <Input id="fax" name="fax" type="tel" defaultValue={values.fax ?? ""} />
            </FormRow>
            <FormRow label="Açık adresi" htmlFor="address" icon={<MapPin />}>
              <Textarea id="address" name="address" rows={2} defaultValue={values.address ?? ""} />
              <label className="mt-1.5 flex items-center gap-2 text-sm text-text-2">
                <input type="checkbox" name="isAbroad" checked={abroad} onChange={(e) => setAbroad(e.target.checked)} className="accent-accent" />
                Adres yurt dışında
              </label>
            </FormRow>
            <FormRow label="Posta kodu" htmlFor="postalCode">
              <Input id="postalCode" name="postalCode" maxLength={10} defaultValue={values.postalCode ?? ""} className="max-w-40" />
            </FormRow>
            {abroad ? (
              <FormRow label="Şehir, ülke" htmlFor="city">
                <div className="grid grid-cols-2 gap-2">
                  <Input id="city" name="city" placeholder="Şehir" defaultValue={values.city ?? ""} />
                  <Input name="country" placeholder="Ülke" defaultValue={values.country ?? ""} />
                </div>
              </FormRow>
            ) : (
              <FormRow label="İlçe, il" htmlFor="district">
                <div className="grid grid-cols-2 gap-2">
                  <Input id="district" name="district" placeholder="İlçe" defaultValue={values.district ?? ""} />
                  <CitySelect name="city" defaultValue={values.city} />
                </div>
              </FormRow>
            )}
          </div>

          <div className="border-t border-border py-2">
            <FormRow label="IBAN numarası" icon={<Hash />} error={s.fieldErrors?.iban}>
              <div className="flex flex-col gap-2">
                {ibans.rows.map((r) => (
                  <div key={r._k} className="flex gap-2">
                    <Input name="iban" defaultValue={r.iban} placeholder="TR00 0000 0000 0000 0000 0000 00" className="font-mono" />
                    {ibans.rows.length > 1 && (
                      <button type="button" onClick={() => ibans.remove(r._k)} className="px-2 text-text-3 hover:text-danger" aria-label="IBAN'ı kaldır"><Trash2 className="size-4" /></button>
                    )}
                  </div>
                ))}
                <Button type="button" variant="secondary" size="sm" className="self-start" onClick={ibans.add}><Plus className="size-3.5" /> Yeni IBAN ekle</Button>
              </div>
            </FormRow>
            <FormRow label="Döviz" htmlFor="currency" icon={<Coins />} hint="Cari bu dövizle izlenir.">
              <Select id="currency" name="currency" defaultValue={values.currency} className="max-w-40">
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </FormRow>
            <FormRow label="Döviz kuru" icon={<Coins />} hint="Bakiye hesaplanırken kullanılır.">
              <Segmented name="rateType" value={rateType} onChange={setRateType} options={[["BUYING", "Alış"], ["SELLING", "Satış"]]} />
            </FormRow>
            <FormRow label="Açılış bakiyesi" icon={<RotateCcw />} error={s.fieldErrors?.openingBalance}>
              <label className="flex items-center gap-2 rounded-sm border border-[#d6d6d6] px-3 py-2 text-sm">
                <input type="checkbox" name="hasOpeningBalance" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="accent-accent" />
                Açılış bakiyesi var
              </label>
              {opening && (
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <Input name="openingBalance" inputMode="decimal" placeholder="Tutar" defaultValue={values.openingBalance ?? ""} aria-label="Açılış bakiyesi tutarı" />
                  <Select name="openingBalanceSide" defaultValue={values.openingBalanceSide ?? "DEBIT"} aria-label="Bakiye yönü">
                    <option value="DEBIT">{values.kind === "CUSTOMER" ? "Bize borçlu (alacağımız)" : "Bize borçlu"}</option>
                    <option value="CREDIT">{values.kind === "SUPPLIER" ? "Biz borçluyuz (ödenecek)" : "Biz borçluyuz"}</option>
                  </Select>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-text-3" />
                    <Input name="openingBalanceDate" type="date" defaultValue={values.openingBalanceDate ?? ""} aria-label="Açılış tarihi" />
                  </div>
                </div>
              )}
            </FormRow>
            <FormRow label="Notlar" htmlFor="notes" icon={<List />}>
              <Textarea id="notes" name="notes" rows={2} defaultValue={values.notes ?? ""} />
            </FormRow>
          </div>

          {/* Yetkili kişiler */}
          <div className="border-t border-border">
            <div className="hidden grid-cols-[1fr_1fr_1fr_1fr_32px] gap-2 bg-card-muted px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-3 md:grid">
              <span>Yetkili kişinin adı</span><span>E-posta</span><span>Telefon</span><span>Notlar</span><span />
            </div>
            <div className="flex flex-col gap-2 p-4">
              {people.rows.map((p) => (
                <div key={p._k} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_32px]">
                  <Input name="person_name" placeholder="Ad soyad" defaultValue={p.name} aria-label="Yetkili adı" />
                  <Input name="person_email" type="email" placeholder="E-posta" defaultValue={p.email ?? ""} aria-label="Yetkili e-postası" />
                  <Input name="person_phone" type="tel" placeholder="Telefon" defaultValue={p.phone ?? ""} aria-label="Yetkili telefonu" />
                  <Input name="person_notes" placeholder="Not" defaultValue={p.notes ?? ""} aria-label="Not" />
                  <button type="button" onClick={() => people.remove(p._k)} className="text-text-3 hover:text-danger" aria-label="Yetkiliyi kaldır"><Trash2 className="size-4" /></button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" className="self-start" onClick={people.add}><User className="size-3.5" /> Bir yetkili ekle</Button>
            </div>
          </div>
        </>
      )}
    </ActionForm>
  );
}
