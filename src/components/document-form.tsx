"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import { Bell, Building2, Calendar, CircleHelp, FileText, Pencil, Plus, Tag, Tags, Warehouse, X } from "lucide-react";
import { saveInvoiceAction, saveQuoteAction } from "@/app/actions/sales";
import { ActionForm, FormMessage } from "./forms";
import { FormHeader } from "./record-forms";
import { Button, FormRow, Input, Select, Textarea } from "./ui";
import { Money } from "./money";
import { calculateDocument, WITHHOLDING_RATES } from "@/lib/invoice-calc";
import { parseMoneyInput } from "@/lib/money";
import { CURRENCIES, UNITS, VAT_RATES } from "@/lib/units";
import { cn } from "@/lib/cn";

export interface LineValue {
  key: number;
  productId: string;
  name: string;
  description: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountType: "PERCENT" | "AMOUNT" | "";
  discountValue: string;
  vatRate: number;
  otvRate: string;
  withholdingRate: string;
  withholdingCode: string;
  /** Hangi ek alanlar açık */
  show: { desc?: boolean; disc?: boolean; otv?: boolean; wh?: boolean };
}

export interface DocumentFormValues {
  id?: string;
  kind: "INVOICE" | "RETURN";
  name: string | null;
  docNo: string | null;
  contactId: string;
  issueDate: string;
  dueDate: string;
  validUntil?: string | null;
  currency: string;
  exchangeRate: string | null;
  categoryId: string | null;
  notes: string | null;
  orderNo: string | null;
  orderDate: string | null;
  stockMode: "WITH_INVOICE" | "NONE";
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: string | null;
  tagIds: string[];
  lines: Array<Omit<LineValue, "key" | "show">>;
}

export interface FormContact { id: string; title: string; currency: string; taxNumber: string | null; address: string | null; district: string | null; city: string | null }
export interface FormProduct { id: string; name: string; code: string | null; unit: string; sellPrice: string | null; vatRate: number }

const tr = (v: string) => v.replace(".", ",");
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dec = (s: string) => parseMoneyInput(s) ?? new Decimal(0);

export function DocumentForm({
  mode, values, contacts, products, categories, tags, accounts, cancelHref,
}: {
  mode: "invoice" | "quote";
  values: DocumentFormValues;
  contacts: FormContact[];
  products: FormProduct[];
  categories: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string; currency: string }>;
  cancelHref: string;
}) {
  const isQuote = mode === "quote";
  const [contactId, setContactId] = useState(values.contactId);
  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const [currency, setCurrency] = useState(values.currency);
  const [showCurrency, setShowCurrency] = useState(values.currency !== "TRY");
  const [showNo, setShowNo] = useState(Boolean(values.docNo));
  const [showOrder, setShowOrder] = useState(Boolean(values.orderNo || values.orderDate));
  const [issueDate, setIssueDate] = useState(values.issueDate);
  const [dueDate, setDueDate] = useState(values.dueDate);
  const [settled, setSettled] = useState<"no" | "yes">("no");
  const [discType, setDiscType] = useState<"PERCENT" | "AMOUNT" | "">(values.discountType ?? "");
  const [discValue, setDiscValue] = useState(values.discountValue ? tr(values.discountValue) : "");
  const [showDocDisc, setShowDocDisc] = useState(Boolean(values.discountValue));
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [lines, setLines] = useState<LineValue[]>(() => {
    const init = values.lines.length ? values.lines : [{ productId: "", name: "", description: null, quantity: "1", unit: "C62", unitPrice: "", discountType: "" as const, discountValue: "", vatRate: 20, otvRate: "", withholdingRate: "", withholdingCode: "" }];
    return init.map((l, i) => ({ ...l, key: i, show: { desc: Boolean(l.description), disc: Boolean(l.discountValue), otv: Boolean(l.otvRate), wh: Boolean(l.withholdingRate) } }));
  });
  const [nextKey, setNextKey] = useState(lines.length);

  const update = (key: number, patch: Partial<LineValue>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    setLines((ls) => [...ls, { key: nextKey, productId: "", name: "", description: null, quantity: "1", unit: "C62", unitPrice: "", discountType: "", discountValue: "", vatRate: 20, otvRate: "", withholdingRate: "", withholdingCode: "", show: {} }]);
    setNextKey((k) => k + 1);
  };
  const removeLine = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  /** Ürün adı yazılınca listedeki ürünle eşleşirse birim / fiyat / KDV doldurulur */
  const onName = (l: LineValue, name: string) => {
    const p = products.find((x) => x.name.toLocaleLowerCase("tr") === name.trim().toLocaleLowerCase("tr"));
    if (p && p.id !== l.productId) update(l.key, { name: p.name, productId: p.id, unit: p.unit, vatRate: p.vatRate, unitPrice: p.sellPrice ? tr(new Decimal(p.sellPrice).toDecimalPlaces(4).toString()) : l.unitPrice });
    else update(l.key, { name, productId: p ? p.id : "" });
  };

  // Canlı toplamlar — sunucudaki motorla aynı
  const calc = useMemo(
    () =>
      calculateDocument(
        lines.map((l) => ({
          quantity: dec(l.quantity || "0"),
          unitPrice: dec(l.unitPrice || "0"),
          // Tür seçilmemişse ekranda "%" görünür ve sunucuya "%" gider → hesap da yüzde
          discountType: l.show.disc && l.discountValue ? l.discountType || "PERCENT" : null,
          discountValue: l.show.disc && l.discountValue ? dec(l.discountValue) : null,
          vatRate: l.vatRate,
          otvRate: l.show.otv && l.otvRate ? dec(l.otvRate) : null,
          withholdingRate: l.show.wh && l.withholdingRate ? Number(l.withholdingRate) : null,
        })),
        { discountType: showDocDisc && discValue ? discType || "PERCENT" : null, discountValue: showDocDisc && discValue ? dec(discValue) : null },
      ),
    [lines, showDocDisc, discType, discValue],
  );

  const action = isQuote ? saveQuoteAction : saveInvoiceAction;
  const title = isQuote ? "Teklif" : values.kind === "RETURN" ? "İade Faturası" : "Satış Faturası";

  return (
    <ActionForm action={action} className="gap-0">
      {(s) => (
        <>
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <input type="hidden" name="direction" value="SALE" />
          <input type="hidden" name="kind" value={values.kind} />
          <FormHeader cancelHref={cancelHref}>
            <FormRow label={isQuote ? "Teklif ismi" : "Fatura ismi"} htmlFor="name" icon={<FileText />}>
              <Input id="name" name="name" maxLength={150} defaultValue={values.name ?? ""} placeholder={title} />
            </FormRow>
          </FormHeader>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}

          <div className="grid gap-4 py-2 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <FormRow label="Müşteri" htmlFor="contactId" icon={<Building2 />} error={s.fieldErrors?.contactId}>
                <Select
                  id="contactId"
                  name="contactId"
                  value={contactId}
                  onChange={(e) => {
                    setContactId(e.target.value);
                    const c = contacts.find((x) => x.id === e.target.value);
                    if (c) {
                      setCurrency(c.currency);
                      setShowCurrency(c.currency !== "TRY");
                    }
                  }}
                >
                  <option value="">Müşteri seçin…</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </Select>
                <p className="mt-1 text-[11px] italic text-text-3">
                  Listede yoksa <Link href="/musteriler/yeni" className="text-accent hover:underline" target="_blank">yeni müşteri oluşturun</Link> ve sayfayı yenileyin.
                </p>
              </FormRow>
              <FormRow label="Müşteri bilgileri">
                <p className="pt-2 text-sm text-text-2">
                  {contact ? [contact.address, [contact.district, contact.city].filter(Boolean).join(" / "), contact.taxNumber && `${contact.taxNumber.length === 11 ? "TCKN" : "VKN"} ${contact.taxNumber}`].filter(Boolean).join(" · ") || "—" : "—"}
                </p>
              </FormRow>

              {!isQuote && !values.id && (
                <FormRow label={values.kind === "RETURN" ? "Ödeme durumu" : "Tahsilat durumu"} icon={<CircleHelp />} error={s.fieldErrors?.settleAccountId}>
                  <div className="grid grid-cols-2 overflow-hidden rounded-sm border border-[#d6d6d6] text-sm">
                    {([["no", values.kind === "RETURN" ? "Ödenecek" : "Tahsil edilecek"], ["yes", values.kind === "RETURN" ? "Ödendi" : "Tahsil edildi"]] as const).map(([v, label], i) => (
                      <label key={v} className={cn("flex cursor-pointer items-center gap-2 px-3 py-2 font-medium uppercase", i > 0 && "border-l border-[#d6d6d6]", settled === v ? "bg-white" : "bg-card-muted text-text-2")}>
                        <input type="radio" name="settled" value={v} checked={settled === v} onChange={() => setSettled(v)} className="accent-accent" />
                        {label}
                      </label>
                    ))}
                  </div>
                  {settled === "yes" && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Select name="settleAccountId" defaultValue="" aria-label="Hesap">
                        <option value="">Kasa / banka seçin…</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                      </Select>
                      <Input name="settleDate" type="date" defaultValue={issueDate} aria-label="Tahsilat tarihi" />
                    </div>
                  )}
                </FormRow>
              )}

              <FormRow label="Düzenleme tarihi" htmlFor="issueDate" icon={<Calendar />} error={s.fieldErrors?.issueDate}>
                <Input id="issueDate" name="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />
              </FormRow>
              {isQuote ? (
                <FormRow label="Geçerlilik tarihi" htmlFor="validUntil" icon={<Bell />} error={s.fieldErrors?.validUntil}>
                  <Input id="validUntil" name="validUntil" type="date" defaultValue={values.validUntil ?? ""} />
                </FormRow>
              ) : (
                <FormRow label="Vade tarihi" htmlFor="dueDate" icon={<Bell />} error={s.fieldErrors?.dueDate}>
                  <div className="mb-2 grid grid-cols-5 overflow-hidden rounded-sm border border-[#d6d6d6] text-[11px] font-semibold uppercase">
                    {[0, 7, 14, 30, 60].map((n, i) => {
                      const active = dueDate === addDays(issueDate, n);
                      return (
                        <button key={n} type="button" onClick={() => setDueDate(addDays(issueDate, n))} className={cn("py-2", i > 0 && "border-l border-[#d6d6d6]", active ? "bg-white text-text" : "bg-card-muted text-text-2 hover:bg-white")}>
                          {n === 0 ? "Aynı gün" : `${n} gün`}
                        </button>
                      );
                    })}
                  </div>
                  <Input id="dueDate" name="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </FormRow>
              )}
              <FormRow label="">
                <div className="flex flex-wrap gap-2">
                  {!showNo && <Button type="button" variant="secondary" size="sm" onClick={() => setShowNo(true)}><Plus className="size-3" /> {isQuote ? "Teklif no ekle" : "Fatura no ekle"}</Button>}
                  {!showCurrency && <Button type="button" variant="secondary" size="sm" onClick={() => setShowCurrency(true)}>₺ Döviz değiştir</Button>}
                  {!isQuote && !showOrder && <Button type="button" variant="secondary" size="sm" onClick={() => setShowOrder(true)}><Plus className="size-3" /> Sipariş bilgisi ekle</Button>}
                </div>
              </FormRow>
              {showNo && (
                <FormRow label={isQuote ? "Teklif no" : "Fatura no"} htmlFor="docNo" hint={isQuote ? undefined : "e-Fatura / e-Arşiv'de numara NES tarafından verilir; boş bırakabilirsiniz."}>
                  <Input id="docNo" name="docNo" maxLength={40} defaultValue={values.docNo ?? ""} className="max-w-60" />
                </FormRow>
              )}
              {showCurrency ? (
                <FormRow label="Döviz" htmlFor="currency" error={s.fieldErrors?.currency ?? s.fieldErrors?.exchangeRate} hint="Belge, carinin izlendiği dövizde olmalı.">
                  <div className="flex flex-wrap gap-2">
                    <Select id="currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-28">
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                    {currency !== "TRY" && <Input name="exchangeRate" inputMode="decimal" placeholder="Kur (1 birim = ? TL)" defaultValue={values.exchangeRate && values.exchangeRate !== "1" ? tr(values.exchangeRate) : ""} className="w-48 font-mono" />}
                  </div>
                </FormRow>
              ) : (
                <input type="hidden" name="currency" value={currency} />
              )}
              {showOrder && (
                <FormRow label="Sipariş no / tarihi">
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="orderNo" maxLength={40} defaultValue={values.orderNo ?? ""} placeholder="Sipariş no" />
                    <Input name="orderDate" type="date" defaultValue={values.orderDate ?? ""} aria-label="Sipariş tarihi" />
                  </div>
                </FormRow>
              )}
              <FormRow label={isQuote ? "Teklif notu" : "Fatura notu"} htmlFor="notes" icon={<Pencil />}>
                <Textarea id="notes" name="notes" rows={2} defaultValue={values.notes ?? ""} />
              </FormRow>
              {!isQuote && (
                <FormRow label="Stok takibi" icon={<Warehouse />}>
                  <div className="grid grid-cols-2 overflow-hidden rounded-sm border border-[#d6d6d6] text-sm">
                    {([["WITH_INVOICE", values.kind === "RETURN" ? "Stok girişi yapılsın" : "Stok çıkışı yapılsın"], ["NONE", values.kind === "RETURN" ? "Stok girişi yapılmasın" : "Stok çıkışı yapılmasın"]] as const).map(([v, label], i) => (
                      <label key={v} className={cn("flex cursor-pointer items-start gap-2 px-3 py-2 text-xs font-medium uppercase", i > 0 && "border-l border-[#d6d6d6]")}>
                        <input type="radio" name="stockMode" value={v} defaultChecked={values.stockMode === v} className="mt-0.5 accent-accent" />
                        {label}
                      </label>
                    ))}
                  </div>
                </FormRow>
              )}
            </div>

            <aside className="mx-4 flex flex-col gap-4 self-start rounded bg-card-muted p-4 xl:mx-0 xl:mr-4">
              {!isQuote && (
                <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-2">
                  <span className="flex items-center gap-1.5"><Tag className="size-3.5" /> {isQuote ? "" : "Fatura kategorisi"}</span>
                  <Select name="categoryId" defaultValue={values.categoryId ?? ""} className="normal-case">
                    <option value="">Kategorisiz</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                  <span className="text-[11px] font-normal normal-case italic tracking-normal text-text-3">Faturaların kategorilere göre dağılımı satışlar raporunda izlenir.</span>
                </label>
              )}
              {!isQuote && (
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-2"><Tags className="size-3.5" /> Etiketleri</legend>
                  {tags.length === 0 ? (
                    <p className="text-xs text-text-3">Etiket yok. <Link href="/kategori-ve-etiketler" className="text-accent hover:underline">Ekleyin</Link></p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((t) => (
                        <label key={t.id} className="flex cursor-pointer items-center gap-1 rounded-sm border border-dashed border-text-3 px-1.5 py-0.5 text-[11px] uppercase text-text-2 has-[:checked]:border-solid has-[:checked]:border-accent has-[:checked]:text-accent">
                          <input type="checkbox" name="tagId" value={t.id} defaultChecked={values.tagIds.includes(t.id)} className="sr-only" />
                          {t.name}
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              )}
              {isQuote && <p className="text-xs text-text-3">Teklif kabul edilince detay sayfasından tek tıkla faturaya dönüştürebilirsiniz.</p>}
            </aside>
          </div>

          {/* Satırlar */}
          <div className="border-t border-border">
            <div className="hidden grid-cols-[minmax(0,3fr)_90px_100px_130px_110px_130px_64px] gap-2 bg-card-muted px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-3 lg:grid">
              <span>Hizmet / ürün</span><span>Miktar</span><span>Birim</span><span>Br. fiyat</span><span>Vergi</span><span className="text-right">Toplam</span><span />
            </div>
            <datalist id="urunler">
              {products.map((p) => <option key={p.id} value={p.name}>{p.code ?? ""}</option>)}
            </datalist>
            <div className="divide-y divide-border">
              {lines.map((l, idx) => (
                <div key={l.key} className="px-4 py-3">
                  {/* Sunucuya giden değerler (gösterilmeyen ek alanlar boş gider) */}
                  <input type="hidden" name="line_productId" value={l.productId} />
                  <input type="hidden" name="line_discType" value={l.show.disc ? l.discountType || "PERCENT" : ""} />
                  <input type="hidden" name="line_discValue" value={l.show.disc ? l.discountValue : ""} />
                  <input type="hidden" name="line_otv" value={l.show.otv ? l.otvRate : ""} />
                  <input type="hidden" name="line_whRate" value={l.show.wh ? l.withholdingRate : ""} />
                  <input type="hidden" name="line_whCode" value={l.show.wh ? l.withholdingCode : ""} />
                  <input type="hidden" name="line_desc" value={l.show.desc ? (l.description ?? "") : ""} />
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,3fr)_90px_100px_130px_110px_130px_64px] lg:items-center">
                    <Input name="line_name" list="urunler" value={l.name} onChange={(e) => onName(l, e.target.value)} placeholder="Hizmet / ürün adı (listeden seçin veya yazın)" aria-label={`${idx + 1}. satır ürün`} className="col-span-2 lg:col-span-1" />
                    <Input name="line_qty" inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} aria-label="Miktar" className="font-mono" />
                    <Select name="line_unit" value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} aria-label="Birim">
                      {UNITS.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
                    </Select>
                    <Input name="line_price" inputMode="decimal" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} placeholder="0,00" aria-label="Birim fiyat (KDV hariç)" className="font-mono" />
                    <Select name="line_vat" value={l.vatRate} onChange={(e) => update(l.key, { vatRate: Number(e.target.value) })} aria-label="KDV">
                      {VAT_RATES.map((r) => <option key={r} value={r}>KDV %{r}</option>)}
                    </Select>
                    <div className="flex items-center justify-end text-right text-sm"><Money value={calc.lines[idx]?.totalAmount ?? 0} currency={currency} /></div>
                    <div className="relative flex justify-end gap-1">
                      <button type="button" onClick={() => setMenuFor(menuFor === l.key ? null : l.key)} className="grid size-8 place-items-center rounded-sm border border-border text-text-2 hover:bg-card-muted" aria-label="Satıra ek alan ekle" aria-expanded={menuFor === l.key}>
                        <Plus className="size-4" />
                      </button>
                      <button type="button" onClick={() => removeLine(l.key)} disabled={lines.length === 1} className="grid size-8 place-items-center rounded-sm bg-[#bdbdbd] text-white hover:bg-danger disabled:opacity-40" aria-label="Satırı sil">
                        <X className="size-4" />
                      </button>
                      {menuFor === l.key && (
                        <ul className="absolute right-0 top-9 z-10 w-48 rounded border border-border bg-white py-1 text-xs font-semibold uppercase text-text-2 shadow-lg">
                          {([["desc", "Açıklama ekle"], ["disc", "İndirim ekle"], ["otv", "ÖTV ekle"], ["wh", "Tevkifat ekle"]] as const).map(([k, label]) => (
                            <li key={k}>
                              <button type="button" disabled={l.show[k]} onClick={() => { update(l.key, { show: { ...l.show, [k]: true } }); setMenuFor(null); }} className="w-full px-3 py-2 text-left hover:bg-card-muted disabled:text-text-3">{label}</button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  {(l.show.desc || l.show.disc || l.show.otv || l.show.wh) && (
                    <div className="mt-2 flex flex-wrap items-center gap-3 rounded bg-card-muted px-3 py-2 text-xs">
                      {l.show.desc && (
                        <ExtraField label="Açıklama" onRemove={() => update(l.key, { show: { ...l.show, desc: false } })}>
                          <Input value={l.description ?? ""} onChange={(e) => update(l.key, { description: e.target.value })} maxLength={500} className="h-8 w-64" aria-label="Açıklama" />
                        </ExtraField>
                      )}
                      {l.show.disc && (
                        <ExtraField label="İndirim" onRemove={() => update(l.key, { show: { ...l.show, disc: false } })}>
                          <Select value={l.discountType || "PERCENT"} onChange={(e) => update(l.key, { discountType: e.target.value as "PERCENT" | "AMOUNT" })} className="h-8 w-16" aria-label="İndirim türü">
                            <option value="PERCENT">%</option>
                            <option value="AMOUNT">Tutar</option>
                          </Select>
                          <Input value={l.discountValue} onChange={(e) => update(l.key, { discountValue: e.target.value })} inputMode="decimal" className="h-8 w-24 font-mono" aria-label="İndirim" />
                        </ExtraField>
                      )}
                      {l.show.otv && (
                        <ExtraField label="ÖTV %" onRemove={() => update(l.key, { show: { ...l.show, otv: false } })}>
                          <Input value={l.otvRate} onChange={(e) => update(l.key, { otvRate: e.target.value })} inputMode="decimal" className="h-8 w-20 font-mono" aria-label="ÖTV oranı" />
                        </ExtraField>
                      )}
                      {l.show.wh && (
                        <ExtraField label="Tevkifat" onRemove={() => update(l.key, { show: { ...l.show, wh: false } })}>
                          <Select value={l.withholdingRate} onChange={(e) => update(l.key, { withholdingRate: e.target.value })} className="h-8 w-20" aria-label="Tevkifat oranı">
                            <option value="">Oran</option>
                            {WITHHOLDING_RATES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </Select>
                          <Input value={l.withholdingCode} onChange={(e) => update(l.key, { withholdingCode: e.target.value })} maxLength={10} placeholder="GİB kodu" className="h-8 w-24" aria-label="Tevkifat kodu" />
                        </ExtraField>
                      )}
                      {(l.show.disc || l.show.wh || l.show.otv) && calc.lines[idx] && (
                        <span className="ml-auto text-text-3">
                          Matrah <Money value={calc.lines[idx]!.netAmount} currency={currency} /> · KDV <Money value={calc.lines[idx]!.vatAmount} currency={currency} />
                          {calc.lines[idx]!.withholdingAmount.greaterThan(0) && <> · Tevkifat <Money value={calc.lines[idx]!.withholdingAmount} currency={currency} /></>}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="px-4 py-3">
              <Button type="button" variant="secondary" size="sm" onClick={addLine}><Plus className="size-3" /> Yeni satır ekle</Button>
            </div>
          </div>

          {/* Toplamlar */}
          <div className="flex justify-end border-t border-border px-4 py-4">
            <dl className="w-full max-w-sm divide-y divide-border text-sm">
              <TotalRow label="Ara toplam" value={calc.totals.grossTotal} currency={currency}>
                {!showDocDisc && <button type="button" onClick={() => setShowDocDisc(true)} className="grid size-6 place-items-center rounded-sm border border-border text-text-2" aria-label="Genel indirim ekle" title="Genel indirim ekle"><Plus className="size-3" /></button>}
              </TotalRow>
              {showDocDisc && (
                <div className="flex items-center justify-between gap-2 py-2">
                  <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase text-text-2">
                    Genel indirim
                    <button type="button" onClick={() => { setShowDocDisc(false); setDiscValue(""); }} className="text-text-3 hover:text-danger" aria-label="Genel indirimi kaldır"><X className="size-3" /></button>
                  </dt>
                  <dd className="flex gap-1">
                    <Select name="docDiscountType" value={discType || "PERCENT"} onChange={(e) => setDiscType(e.target.value as "PERCENT" | "AMOUNT")} className="h-8 w-16" aria-label="Genel indirim türü">
                      <option value="PERCENT">%</option>
                      <option value="AMOUNT">Tutar</option>
                    </Select>
                    <Input name="docDiscountValue" value={discValue} onChange={(e) => { setDiscValue(e.target.value); if (!discType) setDiscType("PERCENT"); }} inputMode="decimal" className="h-8 w-24 font-mono" aria-label="Genel indirim" />
                  </dd>
                </div>
              )}
              {calc.totals.discountTotal.greaterThan(0) && <TotalRow label="Toplam indirim" value={calc.totals.discountTotal.negated()} currency={currency} />}
              {calc.totals.otvTotal.greaterThan(0) && <TotalRow label="Toplam ÖTV" value={calc.totals.otvTotal} currency={currency} />}
              {calc.totals.vatBreakdown.filter((v) => v.vat.greaterThan(0)).length > 1
                ? calc.totals.vatBreakdown.filter((v) => v.vat.greaterThan(0)).map((v) => <TotalRow key={v.rate} label={`KDV %${v.rate}`} value={v.vat} currency={currency} />)
                : <TotalRow label="Toplam KDV" value={calc.totals.vatTotal} currency={currency} />}
              <TotalRow label="Genel toplam" value={calc.totals.grandTotal} currency={currency} strong />
              {calc.totals.withholdingTotal.greaterThan(0) && (
                <>
                  <TotalRow label="Tevkifat" value={calc.totals.withholdingTotal.negated()} currency={currency} />
                  <TotalRow label="Ödenecek tutar" value={calc.totals.payableTotal} currency={currency} strong />
                </>
              )}
            </dl>
          </div>
        </>
      )}
    </ActionForm>
  );
}

function ExtraField({ label, onRemove, children }: { label: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-semibold uppercase text-text-2">{label}</span>
      {children}
      <button type="button" onClick={onRemove} className="text-text-3 hover:text-danger" aria-label={`${label} kaldır`}><X className="size-3.5" /></button>
    </span>
  );
}

function TotalRow({ label, value, currency, strong, children }: { label: string; value: Decimal; currency: string; strong?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-2">{label}</dt>
      <dd className="flex items-center gap-2">
        <Money value={value} currency={currency} className={strong ? "text-lg text-teal" : "text-text-2"} />
        {children}
      </dd>
    </div>
  );
}
