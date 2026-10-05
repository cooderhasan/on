"use client";

import { useState } from "react";
import { Calendar, Coins, FileText, Hash, Landmark, MapPin, Pencil, Plus, Truck, User, Warehouse, X } from "lucide-react";
import {
  adjustStockAction, chequeStatusAction, createChequeAction, createTransferAction, savePriceListAction, savePriceListItemsAction, saveWarehouseAction, saveWaybillAction,
  warehouseStatusAction,
} from "@/app/actions/stock";
import { ActionForm, FormMessage, SubmitButton } from "./forms";
import { FormHeader } from "./record-forms";
import { Button, FormRow, Input, Select, Textarea } from "./ui";
import { CURRENCIES, UNITS } from "@/lib/units";
import { cn } from "@/lib/cn";

type Opt = { id: string; name: string };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
const firstError = (f?: Record<string, string>) => (f ? Object.values(f)[0] : undefined);

// ── Depo ───────────────────────────────────────────────────

export function WarehouseForm({ values, cancelHref }: { values: { id?: string; name: string; address: string | null }; cancelHref: string }) {
  return (
    <ActionForm action={saveWarehouseAction} className="gap-0">
      {(s) => (
        <>
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <FormHeader cancelHref={cancelHref}>
            <FormRow label="Depo adı" htmlFor="name" icon={<Warehouse />} error={s.fieldErrors?.name}>
              <Input id="name" name="name" required maxLength={100} defaultValue={values.name} placeholder="ör. Sanayi deposu" />
            </FormRow>
          </FormHeader>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          <div className="py-2">
            <FormRow label="Adres" htmlFor="address" icon={<MapPin />}>
              <Textarea id="address" name="address" rows={2} maxLength={500} defaultValue={values.address ?? ""} />
            </FormRow>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Varsayılan yap / arşivle / arşivden çıkar */
export function WarehouseStatusButton({ id, op, label }: { id: string; op: "default" | "archive" | "unarchive"; label: string }) {
  return (
    <ActionForm action={warehouseStatusAction} className="gap-1">
      {(s) => (
        <>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="op" value={op} />
          <SubmitButton variant={op === "default" ? "primary" : "danger"} pendingText="…">{label}</SubmitButton>
          {s.error && <FormMessage state={s} />}
        </>
      )}
    </ActionForm>
  );
}

// ── Sayım / stok düzeltme (ürün detayı) ────────────────────

export function AdjustStockForm({ productId, warehouses, unitLabel }: { productId: string; warehouses: Array<Opt & { isDefault: boolean }>; unitLabel: string }) {
  const [mode, setMode] = useState<"SET" | "DELTA">("SET");
  return (
    <ActionForm action={adjustStockAction} resetOnSuccess className="gap-2">
      {(s) => (
        <>
          <input type="hidden" name="productId" value={productId} />
          <div className="grid grid-cols-2 overflow-hidden rounded-sm border border-border text-[11px] font-semibold uppercase">
            {([["SET", "Sayım"], ["DELTA", "Giriş / çıkış"]] as const).map(([k, l], i) => (
              <label key={k} className={cn("flex cursor-pointer items-center justify-center gap-1.5 py-2", i > 0 && "border-l border-border", mode === k ? "bg-white text-text" : "bg-card-muted text-text-2")}>
                <input type="radio" name="mode" value={k} checked={mode === k} onChange={() => setMode(k)} className="sr-only" />
                {l}
              </label>
            ))}
          </div>
          {warehouses.length > 1 ? (
            <Select name="warehouseId" defaultValue={warehouses.find((w) => w.isDefault)?.id} aria-label="Depo">
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          ) : (
            <input type="hidden" name="warehouseId" value={warehouses[0]?.id ?? ""} />
          )}
          <div className="grid grid-cols-2 gap-2">
            <Input name="date" type="date" defaultValue={today()} aria-label="Tarih" />
            <Input name="quantity" inputMode="decimal" placeholder={mode === "SET" ? `Sayılan (${unitLabel})` : `+5 / −2 (${unitLabel})`} aria-label="Miktar" className="font-mono" />
          </div>
          <Input name="note" maxLength={300} placeholder={mode === "SET" ? "Not (ör. yıl sonu sayımı)" : "Not (ör. fire, numune)"} aria-label="Not" />
          {firstError(s.fieldErrors) && <p className="text-xs text-danger">{firstError(s.fieldErrors)}</p>}
          <FormMessage state={s} />
          <SubmitButton variant="accent" pendingText="Kaydediliyor…">Stoğu güncelle</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

// ── Depolar arası transfer ─────────────────────────────────

export function TransferForm({ warehouses, products, stock, cancelHref }: {
  warehouses: Array<Opt & { isDefault: boolean }>;
  products: Array<Opt & { code: string | null; unit: string }>;
  /** `${productId}:${warehouseId}` → miktar */
  stock: Record<string, string>;
  cancelHref: string;
}) {
  const [from, setFrom] = useState(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "");
  const [rows, setRows] = useState([{ key: 0, productId: "" }]);
  const [next, setNext] = useState(1);
  const available = (pid: string) => stock[`${pid}:${from}`] ?? "0";
  const inFrom = products.filter((p) => Number(available(p.id)) > 0);
  return (
    <ActionForm action={createTransferAction} className="gap-0">
      {(s) => (
        <>
          <FormHeader cancelHref={cancelHref}>
            <FormRow label="Açıklama" htmlFor="description" icon={<FileText />}>
              <Input id="description" name="description" maxLength={300} placeholder="Depolar arası transfer" />
            </FormRow>
          </FormHeader>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          <div className="py-2">
            <FormRow label="Çıkış deposu" htmlFor="fromWarehouseId" icon={<Warehouse />} error={s.fieldErrors?.fromWarehouseId}>
              <Select id="fromWarehouseId" name="fromWarehouseId" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-72">
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </FormRow>
            <FormRow label="Giriş deposu" htmlFor="toWarehouseId" icon={<Warehouse />} error={s.fieldErrors?.toWarehouseId}>
              <Select id="toWarehouseId" name="toWarehouseId" defaultValue={warehouses.find((w) => w.id !== from)?.id} className="max-w-72">
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </FormRow>
            <FormRow label="Tarih" htmlFor="date" icon={<Calendar />} error={s.fieldErrors?.date}>
              <Input id="date" name="date" type="date" defaultValue={today()} className="max-w-60" />
            </FormRow>
          </div>
          <div className="border-t border-border px-4 py-3">
            <p className="mb-2 text-[11px] font-semibold uppercase text-text-2">Ürünler</p>
            {inFrom.length === 0 ? (
              <p className="text-sm text-text-3">Çıkış deposunda stoğu olan ürün yok.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {rows.map((r) => (
                  <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2">
                    <Select name="line_productId" value={r.productId} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, productId: e.target.value } : x)))} aria-label="Ürün">
                      <option value="">Ürün seçin…</option>
                      {inFrom.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ""} — mevcut {available(p.id).replace(".", ",")}</option>)}
                    </Select>
                    <Input name="line_qty" inputMode="decimal" placeholder="Miktar" aria-label="Miktar" className="font-mono" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))} aria-label="Satırı sil"><X className="size-4" /></Button>
                  </div>
                ))}
                <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => { setRows((rs) => [...rs, { key: next, productId: "" }]); setNext((n) => n + 1); }}>
                  <Plus className="size-3.5" /> Satır ekle
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </ActionForm>
  );
}

// ── İrsaliye ───────────────────────────────────────────────

export interface WaybillFormValues {
  id?: string;
  direction: "SALE" | "PURCHASE";
  contactId: string;
  warehouseId: string | null;
  waybillNo: string | null;
  issueDate: string;
  dispatchDate: string;
  deliveryAddress: string | null;
  notes: string | null;
  lines: Array<{ productId: string; name: string; quantity: string; unit: string }>;
}

export function WaybillForm({ values, contacts, products, warehouses, cancelHref }: {
  values: WaybillFormValues;
  contacts: Array<Opt & { address: string | null }>;
  products: Array<Opt & { code: string | null; unit: string }>;
  warehouses: Array<Opt & { isDefault: boolean }>;
  cancelHref: string;
}) {
  const sale = values.direction === "SALE";
  const [lines, setLines] = useState(() => (values.lines.length ? values.lines : [{ productId: "", name: "", quantity: "1", unit: "C62" }]).map((l, i) => ({ ...l, key: i })));
  const [next, setNext] = useState(lines.length);
  const update = (key: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const onName = (key: number, name: string) => {
    const p = products.find((x) => x.name.toLocaleLowerCase("tr") === name.trim().toLocaleLowerCase("tr"));
    update(key, p ? { name: p.name, productId: p.id, unit: p.unit } : { name, productId: "" });
  };
  const [address, setAddress] = useState(values.deliveryAddress ?? "");
  return (
    <ActionForm action={saveWaybillAction} className="gap-0">
      {(s) => (
        <>
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <input type="hidden" name="direction" value={values.direction} />
          <FormHeader cancelHref={cancelHref}>
            <FormRow label="İrsaliye no" htmlFor="waybillNo" icon={<Hash />} hint={sale ? "Boş bırakabilirsiniz." : "Tedarikçinin irsaliye numarası."}>
              <Input id="waybillNo" name="waybillNo" maxLength={40} defaultValue={values.waybillNo ?? ""} className="max-w-60 font-mono" />
            </FormRow>
          </FormHeader>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          <div className="py-2">
            <FormRow label={sale ? "Müşteri" : "Tedarikçi"} htmlFor="contactId" icon={sale ? <User /> : <Truck />} error={s.fieldErrors?.contactId}>
              <Select
                id="contactId"
                name="contactId"
                defaultValue={values.contactId}
                onChange={(e) => {
                  const c = contacts.find((x) => x.id === e.target.value);
                  if (sale && c?.address && !address) setAddress(c.address);
                }}
              >
                <option value="">{sale ? "Müşteri" : "Tedarikçi"} seçin…</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormRow>
            {warehouses.length > 1 ? (
              <FormRow label="Depo" htmlFor="warehouseId" icon={<Warehouse />}>
                <Select id="warehouseId" name="warehouseId" defaultValue={values.warehouseId ?? warehouses.find((w) => w.isDefault)?.id} className="max-w-72">
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </FormRow>
            ) : (
              <input type="hidden" name="warehouseId" value={warehouses[0]?.id ?? ""} />
            )}
            <FormRow label="Düzenleme tarihi" htmlFor="issueDate" icon={<Calendar />} error={s.fieldErrors?.issueDate}>
              <Input id="issueDate" name="issueDate" type="date" defaultValue={values.issueDate} className="max-w-60" />
            </FormRow>
            <FormRow label={sale ? "Sevk tarihi" : "Teslim alma tarihi"} htmlFor="dispatchDate" icon={<Truck />} error={s.fieldErrors?.dispatchDate}>
              <Input id="dispatchDate" name="dispatchDate" type="date" defaultValue={values.dispatchDate} className="max-w-60" />
            </FormRow>
            {sale && (
              <FormRow label="Teslimat adresi" htmlFor="deliveryAddress" icon={<MapPin />}>
                <Textarea id="deliveryAddress" name="deliveryAddress" rows={2} maxLength={500} value={address} onChange={(e) => setAddress(e.target.value)} />
              </FormRow>
            )}
            <FormRow label="Not" htmlFor="notes" icon={<Pencil />}>
              <Textarea id="notes" name="notes" rows={2} maxLength={1000} defaultValue={values.notes ?? ""} />
            </FormRow>
          </div>
          <div className="border-t border-border px-4 py-3">
            <datalist id="waybill-products">{products.map((p) => <option key={p.id} value={p.name}>{p.code ?? ""}</option>)}</datalist>
            <div className="hidden grid-cols-[minmax(0,1fr)_110px_130px_auto] gap-2 pb-1 text-[11px] font-semibold uppercase text-text-2 sm:grid">
              <span>Hizmet / ürün</span><span>Miktar</span><span>Birim</span><span />
            </div>
            <div className="flex flex-col gap-2">
              {lines.map((l) => (
                <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_110px_130px_auto]">
                  <input type="hidden" name="line_productId" value={l.productId} />
                  <Input name="line_name" list="waybill-products" value={l.name} onChange={(e) => onName(l.key, e.target.value)} placeholder="Ürün adı" aria-label="Ürün" className="col-span-2 sm:col-span-1" />
                  <Input name="line_qty" inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} aria-label="Miktar" className="font-mono" />
                  <Select name="line_unit" value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} aria-label="Birim">
                    {UNITS.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
                  </Select>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))} aria-label="Satırı sil"><X className="size-4" /></Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => { setLines((ls) => [...ls, { key: next, productId: "", name: "", quantity: "1", unit: "C62" }]); setNext((n) => n + 1); }}>
              <Plus className="size-3.5" /> Satır ekle
            </Button>
            <p className="mt-2 text-[11px] text-text-3">Listedeki ürün seçilirse ve stok takibi yapılıyorsa {sale ? "stok çıkışı" : "stok girişi"} irsaliye ile yapılır.</p>
          </div>
        </>
      )}
    </ActionForm>
  );
}

// ── Fiyat listesi ──────────────────────────────────────────

export function PriceListForm({ values, cancelHref }: { values: { id?: string; name: string; currency: string; notes: string | null }; cancelHref: string }) {
  return (
    <ActionForm action={savePriceListAction} className="gap-0">
      {(s) => (
        <>
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <FormHeader cancelHref={cancelHref}>
            <FormRow label="Liste adı" htmlFor="name" icon={<FileText />} error={s.fieldErrors?.name}>
              <Input id="name" name="name" required maxLength={100} defaultValue={values.name} placeholder="ör. Bayi fiyatları" />
            </FormRow>
          </FormHeader>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          <div className="py-2">
            <FormRow label="Döviz" htmlFor="currency" icon={<Coins />} error={s.fieldErrors?.currency} hint="Liste, yalnızca aynı dövizdeki belgelerde uygulanır.">
              <Select id="currency" name="currency" defaultValue={values.currency} className="max-w-40">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </FormRow>
            <FormRow label="Not" htmlFor="notes" icon={<Pencil />}>
              <Textarea id="notes" name="notes" rows={2} maxLength={500} defaultValue={values.notes ?? ""} />
            </FormRow>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Tüm ürünler tek tabloda; boş fiyat = listede yok (ürün kartındaki fiyat geçerli) */
export function PriceListItemsForm({ id, currency, products }: { id: string; currency: string; products: Array<{ id: string; name: string; code: string | null; sellPrice: string | null; sellCurrency: string; price: string | null }> }) {
  const [q, setQ] = useState("");
  const shown = q.trim() ? products.filter((p) => `${p.name} ${p.code ?? ""}`.toLocaleLowerCase("tr").includes(q.trim().toLocaleLowerCase("tr"))) : products;
  return (
    <ActionForm action={savePriceListItemsAction} className="gap-0">
      {(s) => (
        <>
          <input type="hidden" name="id" value={id} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün ara…" aria-label="Ürün ara" className="max-w-64" />
            <SubmitButton variant="accent" pendingText="Kaydediliyor…">Fiyatları kaydet</SubmitButton>
          </div>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          {products.length === 0 ? (
            <p className="px-4 py-4 text-sm text-text-3">Önce Hizmet ve Ürünler&apos;den ürün ekleyin.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="border-b border-border"><tr><th className="px-4 py-2 text-left text-[11px] font-semibold uppercase text-text-2">Ürün</th><th className="px-4 py-2 text-right text-[11px] font-semibold uppercase text-text-2">Kart fiyatı</th><th className="w-44 px-4 py-2 text-right text-[11px] font-semibold uppercase text-text-2">Liste fiyatı ({currency})</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {products.map((p) => (
                    // Gizlenen satırlar da gönderilir (arama yalnızca görünümü daraltır)
                    <tr key={p.id} className={shown.includes(p) ? undefined : "hidden"}>
                      <td className="px-4 py-1.5">{p.name}{p.code && <span className="ml-2 font-mono text-xs text-text-3">{p.code}</span>}</td>
                      <td className="px-4 py-1.5 text-right font-mono text-xs text-text-3">{p.sellPrice ? `${p.sellPrice.replace(".", ",")} ${p.sellCurrency}` : "—"}</td>
                      <td className="px-4 py-1.5">
                        <Input name={`price_${p.id}`} inputMode="decimal" defaultValue={p.price?.replace(".", ",") ?? ""} aria-label={`${p.name} liste fiyatı`} className={cn("text-right font-mono", s.fieldErrors?.[`price_${p.id}`] && "border-danger")} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </ActionForm>
  );
}

// ── Çek ────────────────────────────────────────────────────

export function ChequeForm({ direction, contacts, invoices, preset, cancelHref }: {
  direction: "RECEIVED" | "ISSUED";
  contacts: Array<Opt & { currency: string }>;
  /** Cari seçilince filtrelenen açık faturalar */
  invoices: Array<{ id: string; contactId: string; label: string; remaining: string }>;
  preset: { contactId: string; invoiceId: string | null; amount: string };
  cancelHref: string;
}) {
  const received = direction === "RECEIVED";
  const [contactId, setContactId] = useState(preset.contactId);
  const contact = contacts.find((c) => c.id === contactId);
  const mine = invoices.filter((i) => i.contactId === contactId);
  return (
    <ActionForm action={createChequeAction} className="gap-0">
      {(s) => (
        <>
          <input type="hidden" name="direction" value={direction} />
          <FormHeader cancelHref={cancelHref}>
            <FormRow label="Çek no" htmlFor="chequeNo" icon={<Hash />} error={s.fieldErrors?.chequeNo}>
              <Input id="chequeNo" name="chequeNo" required maxLength={40} className="max-w-60 font-mono" />
            </FormRow>
          </FormHeader>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          <div className="py-2">
            <FormRow label={received ? "Müşteri" : "Tedarikçi"} htmlFor="contactId" icon={received ? <User /> : <Truck />} error={s.fieldErrors?.contactId}>
              <Select id="contactId" name="contactId" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">{received ? "Müşteri" : "Tedarikçi"} seçin…</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormRow>
            <FormRow label="Fatura" htmlFor="invoiceId" icon={<FileText />} error={s.fieldErrors?.invoiceId} hint="İsteğe bağlı. Seçilirse çek o faturanın tahsilatı / ödemesi sayılır.">
              <Select id="invoiceId" name="invoiceId" defaultValue={preset.invoiceId ?? ""} key={contactId}>
                <option value="">Faturaya bağlama (cari hesaba)</option>
                {mine.map((i) => <option key={i.id} value={i.id}>{i.label} — kalan {i.remaining.replace(".", ",")}</option>)}
              </Select>
            </FormRow>
            <FormRow label={`Tutar${contact ? ` (${contact.currency})` : ""}`} htmlFor="amount" icon={<Coins />} error={s.fieldErrors?.amount}>
              <Input id="amount" name="amount" inputMode="decimal" defaultValue={preset.amount.replace(".", ",")} className="max-w-48 font-mono" />
            </FormRow>
            <FormRow label="Düzenleme tarihi" htmlFor="issueDate" icon={<Calendar />} error={s.fieldErrors?.issueDate}>
              <Input id="issueDate" name="issueDate" type="date" defaultValue={today()} className="max-w-60" />
            </FormRow>
            <FormRow label="Vade tarihi" htmlFor="dueDate" icon={<Calendar />} error={s.fieldErrors?.dueDate}>
              <Input id="dueDate" name="dueDate" type="date" className="max-w-60" />
            </FormRow>
            <FormRow label="Banka / şube" htmlFor="bankName" icon={<Landmark />}>
              <div className="grid grid-cols-2 gap-2">
                <Input id="bankName" name="bankName" maxLength={100} placeholder="Banka" />
                <Input name="branch" maxLength={100} placeholder="Şube" aria-label="Şube" />
              </div>
            </FormRow>
            {received && (
              <FormRow label="Düzenleyen" htmlFor="drawer" icon={<User />} hint="Çeki düzenleyen (keşideci) müşteriden farklıysa.">
                <Input id="drawer" name="drawer" maxLength={200} />
              </FormRow>
            )}
            <FormRow label="Not" htmlFor="notes" icon={<Pencil />}>
              <Textarea id="notes" name="notes" rows={2} maxLength={500} />
            </FormRow>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Çek durum işlemleri: tahsil / ciro / karşılıksız (alınan), ödendi (verilen), geri al */
export function ChequeActions({ id, direction, status, currency, accounts, suppliers, supplierInvoices }: {
  id: string;
  direction: "RECEIVED" | "ISSUED";
  status: string;
  currency: string;
  accounts: Array<Opt & { currency: string }>;
  suppliers: Array<Opt & { currency: string }>;
  supplierInvoices: Array<{ id: string; contactId: string; label: string; remaining: string }>;
}) {
  const initial = direction === "RECEIVED" ? status === "PORTFOLIO" : status === "PENDING";
  const ops = direction === "RECEIVED" ? ([["collect", "Tahsil et"], ["endorse", "Ciro et"], ["bounce", "Karşılıksız"]] as const) : ([["pay", "Ödendi"]] as const);
  const [op, setOp] = useState<string>(ops[0][0]);
  const [supplier, setSupplier] = useState("");
  const accs = accounts.filter((a) => a.currency === currency);
  const sups = suppliers.filter((x) => x.currency === currency);
  if (!initial) {
    return (
      <ActionForm action={chequeStatusAction} className="gap-2">
        {(s) => (
          <>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="action" value="revert" />
            <SubmitButton variant="danger" pendingText="Geri alınıyor…">Son işlemi geri al</SubmitButton>
            <FormMessage state={s} />
          </>
        )}
      </ActionForm>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {ops.length > 1 && (
        <div className={cn("grid overflow-hidden rounded-sm border border-border text-[11px] font-semibold uppercase", ops.length === 3 ? "grid-cols-3" : "grid-cols-1")}>
          {ops.map(([k, l], i) => (
            <button key={k} type="button" onClick={() => setOp(k)} className={cn("py-2", i > 0 && "border-l border-border", op === k ? "bg-white text-text" : "bg-card-muted text-text-2")}>{l}</button>
          ))}
        </div>
      )}
      <ActionForm key={op} action={chequeStatusAction} className="gap-2">
        {(s) => (
          <>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="action" value={op} />
            {(op === "collect" || op === "pay") && (accs.length ? (
              <Select name="accountId" aria-label="Hesap">
                {accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            ) : <p className="text-xs text-text-3">{currency} hesabı yok. Kasa ve Bankalar&apos;dan ekleyin.</p>)}
            {op === "endorse" && (
              <>
                <Select name="contactId" value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Tedarikçi">
                  <option value="">Tedarikçi seçin…</option>
                  {sups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
                <Select name="invoiceId" defaultValue="" aria-label="Alış faturası" key={supplier}>
                  <option value="">Faturaya bağlama</option>
                  {supplierInvoices.filter((i) => i.contactId === supplier).map((i) => <option key={i.id} value={i.id}>{i.label} — kalan {i.remaining.replace(".", ",")}</option>)}
                </Select>
              </>
            )}
            {op === "bounce" && <p className="text-xs text-text-3">Müşteri yeniden borçlanır; çek bir faturaya bağlıysa fatura yeniden açık olur.</p>}
            <Input name="date" type="date" defaultValue={today()} aria-label="Tarih" />
            {firstError(s.fieldErrors) && <p className="text-xs text-danger">{firstError(s.fieldErrors)}</p>}
            <FormMessage state={s} />
            <SubmitButton variant={op === "bounce" ? "danger" : "accent"} pendingText="Kaydediliyor…">{ops.find(([k]) => k === op)?.[1]}</SubmitButton>
          </>
        )}
      </ActionForm>
    </div>
  );
}
