"use client";

import { useState } from "react";
import Decimal from "decimal.js";
import { AlertCircle, Barcode, Boxes, Hash, Minus, Package, Percent, Plus, Ruler, Tag, Truck } from "lucide-react";
import { saveProductAction } from "@/app/actions/records";
import { ActionForm, FormMessage } from "./forms";
import { FormHeader } from "./record-forms";
import { FormRow, Input, Select } from "./ui";
import { CURRENCIES, UNITS, VAT_RATES } from "@/lib/units";
import { parseMoneyInput } from "@/lib/money";
import { cn } from "@/lib/cn";

export interface ProductFormValues {
  id?: string;
  name: string;
  code: string | null;
  barcode: string | null;
  categoryId: string | null;
  unit: string;
  gtipCode: string | null;
  trackStock: boolean;
  initialStock: string;
  criticalStock: string | null;
  buyPrice: string | null;
  buyCurrency: string;
  sellPrice: string | null;
  sellCurrency: string;
  vatRate: number;
}

/** "3800.5" → "3.800,50" giriş kutusu için (Türkçe) */
const show = (v: Decimal | null, dp = 2) => (v === null ? "" : v.toFixed(dp).replace(".", ","));
const withVat = (v: Decimal, rate: number) => v.times(new Decimal(100 + rate)).dividedBy(100);
const withoutVat = (v: Decimal, rate: number) => v.times(100).dividedBy(100 + rate);

/** Vergiler hariç / dahil fiyat çifti: biri yazılınca diğeri KDV'ye göre hesaplanır. Sunucuya yalnızca hariç fiyat gider. */
function usePricePair({ label, name, currencyName, initial, currency, vatRate }: { label: string; name: string; currencyName: string; initial: string | null; currency: string; vatRate: number }) {
  const [excl, setExcl] = useState(() => (initial ? show(new Decimal(initial), 4).replace(/,?0+$/, "").replace(/,$/, "") : ""));
  const [cur, setCur] = useState(currency);
  const exclDec = parseMoneyInput(excl);
  const incl = exclDec ? show(withVat(exclDec, vatRate)) : "";
  return { excl, setExcl, incl, cur, setCur, exclDec, label, name, currencyName, vatRate };
}

export function ProductForm({ values, categories, cancelHref }: { values: ProductFormValues; categories: Array<{ id: string; name: string }>; cancelHref: string }) {
  const [track, setTrack] = useState(values.trackStock);
  const [critical, setCritical] = useState(values.criticalStock !== null);
  const [vat, setVat] = useState(values.vatRate);
  const buy = usePricePair({ label: "alış", name: "buyPrice", currencyName: "buyCurrency", initial: values.buyPrice, currency: values.buyCurrency, vatRate: vat });
  const sell = usePricePair({ label: "satış", name: "sellPrice", currencyName: "sellCurrency", initial: values.sellPrice, currency: values.sellCurrency, vatRate: vat });

  const exclRow = (p: ReturnType<typeof usePricePair>, icon: React.ReactNode, err?: string) => (
    <FormRow label={`Vergiler hariç ${p.label} fiyatı`} htmlFor={p.name} icon={icon} error={err}>
      <div className="flex gap-2">
        <Input id={p.name} name={p.name} inputMode="decimal" value={p.excl} onChange={(e) => p.setExcl(e.target.value)} placeholder="0,00" className="font-mono" />
        <Select name={p.currencyName} value={p.cur} onChange={(e) => p.setCur(e.target.value)} className="w-24" aria-label="Para birimi">
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>
    </FormRow>
  );
  const inclRow = (p: ReturnType<typeof usePricePair>, icon: React.ReactNode) => (
    <FormRow label={`Vergiler dahil ${p.label} fiyatı`} htmlFor={`${p.name}-incl`} icon={icon}>
      <div className="flex gap-2">
        <Input
          id={`${p.name}-incl`}
          inputMode="decimal"
          defaultValue={p.incl}
          key={p.incl}
          placeholder="0,00"
          className="font-mono"
          // KDV dahil fiyattan hariç fiyat geri hesaplanır (4 hane hassasiyet)
          onBlur={(e) => {
            const d = parseMoneyInput(e.target.value);
            p.setExcl(d ? show(withoutVat(d, p.vatRate), 4) : "");
          }}
        />
        <span className="grid w-24 place-items-center text-xs text-text-3">{p.cur}</span>
      </div>
    </FormRow>
  );

  return (
    <ActionForm action={saveProductAction} className="gap-0">
      {(s) => (
        <>
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <FormHeader cancelHref={cancelHref}>
            <FormRow label="Adı" htmlFor="name" icon={<Package />} error={s.fieldErrors?.name}>
              <Input id="name" name="name" required maxLength={250} defaultValue={values.name} />
            </FormRow>
          </FormHeader>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          <div className="py-2">
            <FormRow label="Ürün / stok kodu" htmlFor="code" icon={<Hash />} error={s.fieldErrors?.code}>
              <Input id="code" name="code" maxLength={60} defaultValue={values.code ?? ""} />
            </FormRow>
            <FormRow label="Barkod numarası" htmlFor="barcode" icon={<Barcode />}>
              <Input id="barcode" name="barcode" maxLength={60} defaultValue={values.barcode ?? ""} />
            </FormRow>
            <FormRow label="Kategorisi" htmlFor="categoryId" icon={<Tag />}>
              <Select id="categoryId" name="categoryId" defaultValue={values.categoryId ?? ""}>
                <option value="">Kategorisiz</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormRow>
            <FormRow label="Alış / satış birimi" htmlFor="unit" icon={<Ruler />} hint="Birim değişikliği geriye dönük olarak faturalara yansır.">
              <Select id="unit" name="unit" defaultValue={values.unit}>
                {UNITS.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
              </Select>
            </FormRow>
            <FormRow label="GTİP kodu" htmlFor="gtipCode" icon={<Hash />} hint="İhracat faturalarında gerekir.">
              <Input id="gtipCode" name="gtipCode" maxLength={20} defaultValue={values.gtipCode ?? ""} className="max-w-60" />
            </FormRow>
          </div>
          <div className="border-t border-border py-2">
            <FormRow label="Stok takibi" icon={<Truck />}>
              <div className="grid grid-cols-2 overflow-hidden rounded-sm border border-[#d6d6d6] text-sm">
                {([["yes", "Yapılsın"], ["no", "Yapılmasın"]] as const).map(([v, l], i) => (
                  <label key={v} className={cn("flex cursor-pointer items-center gap-2 px-3 py-2 uppercase", i > 0 && "border-l border-[#d6d6d6]", (v === "yes") === track ? "bg-white font-medium" : "bg-card-muted text-text-2")}>
                    <input type="radio" name="trackStock" value={v} checked={(v === "yes") === track} onChange={() => setTrack(v === "yes")} className="accent-accent" />
                    {l}
                  </label>
                ))}
              </div>
            </FormRow>
            {track && (
              <>
                <FormRow label="Başlangıç stok miktarı" htmlFor="initialStock" icon={<Boxes />} error={s.fieldErrors?.initialStock}>
                  <Input id="initialStock" name="initialStock" inputMode="decimal" defaultValue={values.initialStock.replace(".", ",")} className="font-mono" />
                </FormRow>
                <FormRow label="Kritik stok uyarısı" icon={<AlertCircle />} error={s.fieldErrors?.criticalStock}>
                  <label className="flex items-center gap-2 rounded-sm border border-[#d6d6d6] px-3 py-2 text-sm">
                    <input type="checkbox" name="criticalEnabled" checked={critical} onChange={(e) => setCritical(e.target.checked)} className="accent-accent" />
                    Etkinleştir
                  </label>
                  {critical && <Input name="criticalStock" inputMode="decimal" placeholder="Bu miktarın altına düşünce uyar" defaultValue={values.criticalStock?.replace(".", ",") ?? ""} className="mt-2 font-mono" aria-label="Kritik stok miktarı" />}
                </FormRow>
              </>
            )}
          </div>
          <div className="border-t border-border py-2">
            {exclRow(buy, <Minus />, s.fieldErrors?.buyPrice)}
            {exclRow(sell, <Plus />, s.fieldErrors?.sellPrice)}
          </div>
          <div className="border-t border-border py-2">
            <FormRow label="KDV" htmlFor="vatRate" icon={<Percent />} error={s.fieldErrors?.vatRate}>
              <Select id="vatRate" name="vatRate" value={vat} onChange={(e) => setVat(Number(e.target.value))} className="max-w-40">
                {VAT_RATES.map((r) => <option key={r} value={r}>%{r} KDV</option>)}
              </Select>
            </FormRow>
          </div>
          <div className="border-t border-border py-2">
            {inclRow(buy, <Minus />)}
            {inclRow(sell, <Plus />)}
          </div>
        </>
      )}
    </ActionForm>
  );
}
