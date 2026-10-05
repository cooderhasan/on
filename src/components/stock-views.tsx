import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Archive, ArchiveRestore, FileText, MapPin, Printer, Truck, Warehouse } from "lucide-react";
import Decimal from "decimal.js";
import type { InvoiceDirection, StockMoveSource } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { db } from "@/server/db";
import {
  activeWarehouses, getStockTransfer, getWarehouse, listMovements, listStockTransfers, listWarehouses, movementSource, SOURCE_LABELS, stockByWarehouse,
} from "@/server/services/stock";
import { getWaybill, listWaybills } from "@/server/services/waybills";
import { getPriceList, listPriceLists } from "@/server/services/price-lists";
import { orNotFound, pageParam, strParam } from "@/server/page-helpers";
import { archivePriceListAction, deleteTransferAction, deleteWaybillAction } from "@/app/actions/stock";
import { Button, buttonClass, Card, CardHeader, EmptyState, LinkButton, PageHeader, Td, Th } from "./ui";
import { buildHref, InfoRow, ListFooter, ListToolbar } from "./list";
import { ConfirmDelete } from "./money-forms";
import { PriceListForm, PriceListItemsForm, TransferForm, WarehouseForm, WarehouseStatusButton, WaybillForm, type WaybillFormValues } from "./stock-forms";
import { fmtDate } from "./invoice-views";
import { unitLabel } from "@/lib/units";
import { cn } from "@/lib/cn";

type SP = Record<string, string | string[] | undefined>;
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });

/** Miktar: 1.234,5 (4 haneye kadar, gereksiz sıfırsız) */
export function qty(v: { toString(): string }) {
  const d = new Decimal(v.toString());
  const [i, f] = d.abs().toDecimalPlaces(4).toFixed().split(".");
  return `${d.isNegative() ? "−" : ""}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${f ? `,${f}` : ""}`;
}

function Qty({ value, unit, signed, className }: { value: { toString(): string }; unit?: string; signed?: boolean; className?: string }) {
  const d = new Decimal(value.toString());
  return (
    <span className={cn("whitespace-nowrap font-mono", signed && (d.isNegative() ? "text-danger" : "text-success"), className)}>
      {signed && d.greaterThan(0) ? "+" : ""}{qty(d)}{unit && <span className="ml-1 font-sans text-xs text-text-3">{unitLabel(unit)}</span>}
    </span>
  );
}

// ── Depolar ────────────────────────────────────────────────

export async function WarehouseListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("stock.read");
  const archived = strParam((await searchParams).arsiv) === "1";
  const rows = await listWarehouses(user, { archived });
  const canEdit = can(user.role, "stock.write");
  return (
    <>
      <PageHeader title={archived ? "Depolar · Arşiv" : "Depolar"} actions={canEdit ? <LinkButton href="/depolar/yeni">Yeni depo ekle</LinkButton> : undefined} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={archived ? "Arşivde depo yok" : "Henüz depo yok"} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-card-muted">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-[#d9d9d9] text-white"><Warehouse className="size-4" /></span>
                  <div className="min-w-0">
                    <Link href={`/depolar/${w.id}`} className="font-medium uppercase text-text hover:text-accent">{w.name}</Link>
                    {w.address && <p className="truncate text-xs text-text-3">{w.address}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-text-2">
                  {w.isDefault && <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Varsayılan</span>}
                  <span>{w.productCount} ürün</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <ListFooter total={rows.length} page={1} pages={1} href={() => "/depolar"} summary={<Link href={archived ? "/depolar" : "/depolar?arsiv=1"} className="text-accent hover:underline">{archived ? "Aktif depolar" : "Arşiv"}</Link>} />
      </Card>
    </>
  );
}

export async function WarehouseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("stock.read");
  const w = await orNotFound(getWarehouse(user, (await params).id));
  const canEdit = can(user.role, "stock.write");
  return (
    <>
      <PageHeader title={w.name} parent={{ href: "/depolar", label: "Depolar" }} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
            <h2 className="flex items-center gap-3 text-lg uppercase text-text"><Warehouse className="size-7 text-text-3" /> {w.name}</h2>
            <div className="flex items-center gap-2">
              {w.isDefault && <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Varsayılan</span>}
              {w.isArchived && <span className="rounded-sm bg-warning px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Arşivde</span>}
              {canEdit && <LinkButton href={`/depolar/${w.id}/duzenle`} variant="secondary">Düzenle</LinkButton>}
            </div>
          </div>
          <dl className="py-3"><InfoRow label="Adres" icon={<MapPin />}>{w.address}</InfoRow></dl>
          <CardHeader title="Depodaki ürünler" className="border-t border-border" />
          {w.items.length === 0 ? (
            <p className="px-4 py-4 text-sm text-text-3">Bu depoda stok yok.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {w.items.map((i) => (
                  <tr key={i.id}>
                    <Td><Link href={`/hizmet-ve-urunler/${i.id}`} className="uppercase hover:text-accent">{i.name}</Link>{i.code && <span className="ml-2 font-mono text-xs text-text-3">{i.code}</span>}</Td>
                    <Td className="text-right"><Qty value={i.quantity} unit={i.unit} className={i.quantity.isNegative() ? "text-danger" : undefined} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <aside className="flex flex-col gap-3">
          <LinkButton href={buildHref("/stok-hareketleri", { depo: w.id })} variant="secondary">Depo hareketleri</LinkButton>
          {canEdit && !w.isArchived && !w.isDefault && <WarehouseStatusButton id={w.id} op="default" label="Varsayılan yap" />}
          {canEdit && !w.isDefault && <WarehouseStatusButton id={w.id} op={w.isArchived ? "unarchive" : "archive"} label={w.isArchived ? "Arşivden çıkar" : "Arşivle"} />}
        </aside>
      </div>
    </>
  );
}

export async function WarehouseFormPage({ params }: { params?: Promise<{ id: string }> }) {
  const user = await requireUser("stock.write");
  const id = params ? (await params).id : null;
  const w = id ? await orNotFound(getWarehouse(user, id)) : null;
  return (
    <>
      <PageHeader title={id ? "Düzenle" : "Yeni depo"} parent={{ href: id ? `/depolar/${id}` : "/depolar", label: w?.name ?? "Depolar" }} />
      <Card><WarehouseForm values={{ id: w?.id, name: w?.name ?? "", address: w?.address ?? null }} cancelHref={id ? `/depolar/${id}` : "/depolar"} /></Card>
    </>
  );
}

// ── Depolar arası transfer ─────────────────────────────────

export async function TransferListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("stock.read");
  const { rows, total, page, pages } = await listStockTransfers(user, pageParam((await searchParams).sayfa));
  const canEdit = can(user.role, "stock.write");
  return (
    <>
      <PageHeader title="Depolar Arası Transfer" actions={canEdit ? <LinkButton href="/depolar-arasi-transfer/yeni">Yeni transfer</LinkButton> : undefined} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Henüz transfer yok" description="İkinci bir depo ekledikten sonra ürünleri depolar arasında taşıyabilirsiniz." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-border"><tr><Th>Tarih</Th><Th>Depolar</Th><Th>Açıklama</Th><Th className="text-right">Kalem</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((t) => (
                  <tr key={t.id} className="hover:bg-card-muted">
                    <Td className="whitespace-nowrap"><Link href={`/depolar-arasi-transfer/${t.id}`} className="hover:text-accent">{fmtDate(t.date)}</Link></Td>
                    <Td><Link href={`/depolar-arasi-transfer/${t.id}`} className="flex items-center gap-1.5 font-medium hover:text-accent">{t.fromWarehouse.name} <ArrowRight className="size-3.5 text-text-3" /> {t.toWarehouse.name}</Link></Td>
                    <Td className="text-text-2">{t.description}</Td>
                    <Td className="text-right">{t._count.lines}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListFooter total={total} page={page} pages={pages} href={(p) => buildHref("/depolar-arasi-transfer", { sayfa: p > 1 ? p : undefined })} />
      </Card>
    </>
  );
}

export async function TransferFormPage() {
  await requireUser("stock.write");
  const [warehouses, products, stock] = await Promise.all([
    activeWarehouses(),
    db.product.findMany({ where: { isArchived: false, trackStock: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true } }),
    stockByWarehouse(),
  ]);
  return (
    <>
      <PageHeader title="Yeni transfer" parent={{ href: "/depolar-arasi-transfer", label: "Depolar Arası Transfer" }} />
      <Card>
        {warehouses.length < 2 ? (
          <EmptyState title="Transfer için en az iki depo gerekli" action={<LinkButton href="/depolar/yeni">Yeni depo ekle</LinkButton>} />
        ) : (
          <TransferForm warehouses={warehouses} products={products} stock={Object.fromEntries(stock.map((s) => [`${s.productId}:${s.warehouseId}`, s.quantity.toString()]))} cancelHref="/depolar-arasi-transfer" />
        )}
      </Card>
    </>
  );
}

export async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("stock.read");
  const t = await orNotFound(getStockTransfer(user, (await params).id));
  return (
    <>
      <PageHeader title="Transfer" parent={{ href: "/depolar-arasi-transfer", label: "Depolar Arası Transfer" }} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-4 text-lg text-text">
            <Link href={`/depolar/${t.fromWarehouse.id}`} className="hover:text-accent">{t.fromWarehouse.name}</Link>
            <ArrowRight className="size-5 text-text-3" />
            <Link href={`/depolar/${t.toWarehouse.id}`} className="hover:text-accent">{t.toWarehouse.name}</Link>
          </div>
          <p className="border-b border-border px-4 py-2 text-sm text-text-2">{fmtDate(t.date)}{t.description && ` · ${t.description}`}</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {t.lines.map((l) => (
                <tr key={l.id}>
                  <Td><Link href={`/hizmet-ve-urunler/${l.product.id}`} className="uppercase hover:text-accent">{l.product.name}</Link></Td>
                  <Td className="text-right"><Qty value={l.quantity} unit={l.product.unit} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {can(user.role, "stock.write") && <ConfirmDelete action={deleteTransferAction} id={t.id} label="Transferi geri al" confirmText="Transfer geri alınsın mı? Ürünler çıkış deposuna döner." />}
      </div>
    </>
  );
}

// ── Stok geçmişi ───────────────────────────────────────────

export async function MovementListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("stock.read");
  const sp = await searchParams;
  const productId = strParam(sp.urun);
  const warehouseId = strParam(sp.depo);
  const sourceRaw = strParam(sp.kaynak);
  const source = sourceRaw && sourceRaw in SOURCE_LABELS ? (sourceRaw as StockMoveSource) : undefined;
  const from = strParam(sp.baslangic);
  const to = strParam(sp.bitis);
  const [{ rows, total, page, pages }, warehouses, product] = await Promise.all([
    listMovements(user, { productId, warehouseId, source, from, to, page: pageParam(sp.sayfa) }),
    activeWarehouses(),
    productId ? db.product.findUnique({ where: { id: productId }, select: { id: true, name: true } }) : Promise.resolve(null),
  ]);
  const href = (p: number) => buildHref("/stok-hareketleri", { urun: productId, depo: warehouseId, kaynak: source, baslangic: from, bitis: to, sayfa: p > 1 ? p : undefined });
  const sel = "h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs";
  return (
    <>
      <PageHeader title={product ? `Stok Geçmişi · ${product.name}` : "Stok Geçmişi"} parent={product ? { href: `/hizmet-ve-urunler/${product.id}`, label: product.name } : undefined} />
      <form action="/stok-hareketleri" className="mb-3 flex flex-wrap items-center gap-2 rounded bg-[#d4d4d4] p-1.5">
        {productId && <input type="hidden" name="urun" value={productId} />}
        {warehouses.length > 1 && (
          <select name="depo" defaultValue={warehouseId ?? ""} aria-label="Depo" className={sel}>
            <option value="">Tüm depolar</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
        <select name="kaynak" defaultValue={source ?? ""} aria-label="Kaynak" className={sel}>
          <option value="">Tüm hareketler</option>
          {(Object.keys(SOURCE_LABELS) as StockMoveSource[]).map((k) => <option key={k} value={k}>{SOURCE_LABELS[k]}</option>)}
        </select>
        <input type="date" name="baslangic" defaultValue={from} aria-label="Başlangıç" className={sel} />
        <input type="date" name="bitis" defaultValue={to} aria-label="Bitiş" className={sel} />
        <button type="submit" className={buttonClass("secondary", "sm")}>Filtrele</button>
      </form>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Stok hareketi yok" description="Fatura, irsaliye, transfer ve sayımlar burada listelenir." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border"><tr><Th>Tarih</Th>{!productId && <Th>Ürün</Th>}<Th>İşlem</Th>{warehouses.length > 1 && <Th>Depo</Th>}<Th className="text-right">Miktar</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((m) => {
                  const src = movementSource(m);
                  return (
                    <tr key={m.id}>
                      <Td className="whitespace-nowrap text-text-2">{fmtDate(m.date)}</Td>
                      {!productId && <Td><Link href={`/hizmet-ve-urunler/${m.product.id}`} className="uppercase hover:text-accent">{m.product.name}</Link></Td>}
                      <Td>{src.href ? <Link href={src.href} className="text-accent hover:underline">{src.label}</Link> : src.label}</Td>
                      {warehouses.length > 1 && <Td className="text-text-2">{m.warehouse.name}</Td>}
                      <Td className="text-right"><Qty value={m.quantity} unit={m.product.unit} signed /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <ListFooter total={total} page={page} pages={pages} href={href} />
      </Card>
    </>
  );
}

// ── İrsaliyeler ────────────────────────────────────────────

const WB: Record<InvoiceDirection, { base: string; list: string; single: string; read: "sales.read" | "expenses.read"; write: "sales.write" | "expenses.write"; party: string; contactBase: string; invoiceBase: string; contactParam: string }> = {
  SALE: { base: "/giden-irsaliyeler", list: "Giden İrsaliyeler", single: "Giden İrsaliye", read: "sales.read", write: "sales.write", party: "Müşteri", contactBase: "/musteriler", invoiceBase: "/satislar", contactParam: "musteri" },
  PURCHASE: { base: "/gelen-irsaliyeler", list: "Gelen İrsaliyeler", single: "Gelen İrsaliye", read: "expenses.read", write: "expenses.write", party: "Tedarikçi", contactBase: "/tedarikciler", invoiceBase: "/giderler", contactParam: "tedarikci" },
};

export async function WaybillListPage({ searchParams, direction }: { searchParams: Promise<SP>; direction: InvoiceDirection }) {
  const M = WB[direction];
  const user = await requireUser(M.read);
  const sp = await searchParams;
  const q = strParam(sp.q);
  const invoiced = strParam(sp.durum) as "yes" | "no" | undefined;
  const { rows, total, page, pages } = await listWaybills(user, direction, { q, invoiced, page: pageParam(sp.sayfa) });
  const canEdit = can(user.role, M.write) && can(user.role, "stock.write");
  return (
    <>
      <PageHeader title={M.list} />
      <ListToolbar
        action={M.base}
        q={q}
        placeholder="İrsaliye no, cari, ürün…"
        filters={
          <select name="durum" defaultValue={invoiced ?? ""} aria-label="Fatura durumu" className="h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs">
            <option value="">Tümü</option>
            <option value="no">Faturalanmadı</option>
            <option value="yes">Faturalandı</option>
          </select>
        }
        actions={canEdit ? <LinkButton href={`${M.base}/yeni`}>Yeni irsaliye</LinkButton> : undefined}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={q || invoiced ? "Filtreye uyan irsaliye yok" : "Henüz irsaliye yok"} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="border-b border-border"><tr><Th>{M.party}</Th><Th>İrsaliye no</Th><Th>Sevk tarihi</Th><Th>Fatura</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((w) => (
                  <tr key={w.id} className="hover:bg-card-muted">
                    <Td>
                      <Link href={`${M.base}/${w.id}`} className="font-medium uppercase text-text hover:text-accent">{w.contact.title}</Link>
                      <p className="text-xs text-text-3">{w._count.lines} kalem · {w.warehouse.name}</p>
                    </Td>
                    <Td className="font-mono text-xs">{w.waybillNo ?? "—"}</Td>
                    <Td>{fmtDate(w.dispatchDate)}</Td>
                    <Td>{w.invoice ? <Link href={`${M.invoiceBase}/${w.invoice.id}`} className="text-xs text-success hover:underline">Faturalandı{w.invoice.invoiceNo ? ` · ${w.invoice.invoiceNo}` : ""}</Link> : <span className="text-xs text-warning">Faturalanmadı</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListFooter total={total} page={page} pages={pages} href={(p) => buildHref(M.base, { q, durum: invoiced, sayfa: p > 1 ? p : undefined })} />
      </Card>
    </>
  );
}

export async function WaybillDetailPage({ params, direction }: { params: Promise<{ id: string }>; direction: InvoiceDirection }) {
  const M = WB[direction];
  const user = await requireUser(M.read);
  const w = await orNotFound(getWaybill(user, (await params).id));
  if (w.direction !== direction) notFound();
  const canEdit = can(user.role, M.write) && can(user.role, "stock.write");
  const c = w.contact;
  return (
    <>
      <PageHeader title={w.waybillNo ? `İrsaliye ${w.waybillNo}` : M.single} parent={{ href: M.base, label: M.list }} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
            <h2 className="flex items-center gap-3 text-lg text-text"><Truck className="size-7 text-accent" /> {M.single}</h2>
            <div className="flex items-center gap-2">
              {canEdit && !w.invoiceId && <LinkButton href={`${M.base}/${w.id}/duzenle`} variant="secondary">Düzenle</LinkButton>}
              {direction === "SALE" && <LinkButton href={`${M.base}/${w.id}/yazdir`} variant="secondary" target="_blank"><Printer className="size-3.5" /> Yazdır</LinkButton>}
            </div>
          </div>
          <div className="grid gap-3 border-b border-border px-4 py-4 sm:grid-cols-2">
            <div>
              <Link href={`${M.contactBase}/${c.id}`} className="font-medium uppercase text-text hover:text-accent">{c.title}</Link>
              {w.deliveryAddress && <p className="text-xs text-text-2">Teslimat: {w.deliveryAddress}</p>}
              {c.taxNumber && <p className="text-xs text-text-2">{c.taxOffice ? `${c.taxOffice} V.D. · ` : ""}{c.taxNumber.length === 11 ? "TCKN" : "VKN"} {c.taxNumber}</p>}
            </div>
            <div className="text-sm text-text-2 sm:text-right">
              <p>Düzenleme: {fmtDate(w.issueDate)}{w.waybillNo && <span className="ml-3 font-mono"># {w.waybillNo}</span>}</p>
              <p className="text-xs">{direction === "SALE" ? "Sevk" : "Teslim alma"}: {fmtDate(w.dispatchDate)}</p>
              <p className="text-xs">Depo: {w.warehouse.name}</p>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-card-muted"><tr><Th>Hizmet / ürün</Th><Th className="text-right">Miktar</Th></tr></thead>
            <tbody className="divide-y divide-border">
              {w.lines.map((l) => (
                <tr key={l.id}>
                  <Td>{l.productId ? <Link href={`/hizmet-ve-urunler/${l.productId}`} className="hover:text-accent">{l.name}</Link> : l.name}{l.product && !l.product.trackStock && <span className="ml-2 text-[10px] uppercase text-text-3">stok takibi yok</span>}</Td>
                  <Td className="text-right"><Qty value={l.quantity} unit={l.unit} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
          {w.notes && <p className="whitespace-pre-line border-t border-border px-4 py-3 text-sm text-text-2">{w.notes}</p>}
        </Card>
        <aside className="flex flex-col gap-3">
          <Card className="p-4 text-sm">
            <p className="mb-2 text-[11px] font-semibold uppercase text-text-2">Fatura</p>
            {w.invoice ? (
              <Link href={`${M.invoiceBase}/${w.invoice.id}`} className="text-accent hover:underline">{w.invoice.name || w.invoice.invoiceNo || "Faturayı aç"}</Link>
            ) : can(user.role, M.write) ? (
              <LinkButton href={`${M.invoiceBase}/yeni?irsaliye=${w.id}`} variant="accent">Faturaya dönüştür</LinkButton>
            ) : (
              <p className="text-text-3">Faturalanmadı</p>
            )}
            <p className="mt-2 text-[11px] text-text-3">Stok irsaliye ile hareket etti; irsaliyeden oluşturulan faturada stok tekrar hareket etmez.</p>
          </Card>
          {canEdit && !w.invoiceId && <ConfirmDelete action={deleteWaybillAction} id={w.id} label="İrsaliyeyi sil" confirmText="İrsaliye silinsin mi? Stok hareketi geri alınır." />}
        </aside>
      </div>
    </>
  );
}

export async function WaybillFormPage({ params, searchParams, direction }: { params?: Promise<{ id: string }>; searchParams?: Promise<SP>; direction: InvoiceDirection }) {
  const M = WB[direction];
  const user = await requireUser(M.write);
  const id = params ? (await params).id : null;
  const [contacts, products, warehouses] = await Promise.all([
    db.contact.findMany({ where: { kind: direction === "SALE" ? "CUSTOMER" : "SUPPLIER", isArchived: false }, orderBy: { title: "asc" }, select: { id: true, title: true, address: true, district: true, city: true } }),
    db.product.findMany({ where: { isArchived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true } }),
    activeWarehouses(),
  ]);
  let values: WaybillFormValues;
  if (id) {
    const w = await orNotFound(getWaybill(user, id));
    if (w.direction !== direction || w.invoiceId) notFound();
    values = {
      id: w.id, direction, contactId: w.contactId, warehouseId: w.warehouseId, waybillNo: w.waybillNo, issueDate: w.issueDate.toISOString().slice(0, 10), dispatchDate: w.dispatchDate.toISOString().slice(0, 10),
      deliveryAddress: w.deliveryAddress, notes: w.notes, lines: w.lines.map((l) => ({ productId: l.productId ?? "", name: l.name, quantity: l.quantity.toString().replace(".", ","), unit: l.unit })),
    };
  } else {
    const sp = searchParams ? await searchParams : {};
    const pre = contacts.find((c) => c.id === strParam(sp[M.contactParam]));
    const preAddress = pre && direction === "SALE" ? [pre.address, [pre.district, pre.city].filter(Boolean).join(" / ")].filter(Boolean).join(" ") || null : null;
    values = { direction, contactId: pre?.id ?? "", warehouseId: null, waybillNo: null, issueDate: todayIso(), dispatchDate: todayIso(), deliveryAddress: preAddress, notes: null, lines: [] };
  }
  const formContacts = contacts.map((c) => ({ id: c.id, name: c.title, address: [c.address, [c.district, c.city].filter(Boolean).join(" / ")].filter(Boolean).join(" ") || null }));
  return (
    <>
      <PageHeader title={id ? "Düzenle" : `Yeni ${M.single.toLocaleLowerCase("tr")}`} parent={{ href: id ? `${M.base}/${id}` : M.base, label: M.list }} />
      <Card><WaybillForm values={values} contacts={formContacts} products={products} warehouses={warehouses} cancelHref={id ? `${M.base}/${id}` : M.base} /></Card>
    </>
  );
}

// ── Fiyat listeleri ────────────────────────────────────────

export async function PriceListListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("stock.read");
  const archived = strParam((await searchParams).arsiv) === "1";
  const rows = await listPriceLists(user, { archived });
  const canEdit = can(user.role, "stock.write");
  return (
    <>
      <PageHeader title={archived ? "Fiyat Listeleri · Arşiv" : "Fiyat Listeleri"} actions={canEdit ? <LinkButton href="/fiyat-listeleri/yeni">Yeni fiyat listesi</LinkButton> : undefined} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={archived ? "Arşivde liste yok" : "Henüz fiyat listesi yok"} description="Bayi, toptan gibi müşteri gruplarına farklı fiyat uygulamak için liste oluşturup müşteri kartında seçin." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-card-muted">
                <div>
                  <Link href={`/fiyat-listeleri/${l.id}`} className="font-medium uppercase text-text hover:text-accent">{l.name}</Link>
                  <p className="text-xs text-text-3">{l.currency}{l.notes ? ` · ${l.notes}` : ""}</p>
                </div>
                <p className="text-xs text-text-2">{l._count.items} ürün · {l._count.contacts} müşteri</p>
              </li>
            ))}
          </ul>
        )}
        <ListFooter total={rows.length} page={1} pages={1} href={() => "/fiyat-listeleri"} summary={<Link href={archived ? "/fiyat-listeleri" : "/fiyat-listeleri?arsiv=1"} className="text-accent hover:underline">{archived ? "Aktif listeler" : "Arşiv"}</Link>} />
      </Card>
    </>
  );
}

export async function PriceListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("stock.read");
  const l = await orNotFound(getPriceList(user, (await params).id));
  const canEdit = can(user.role, "stock.write");
  const products = canEdit ? await db.product.findMany({ where: { isArchived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, sellPrice: true, sellCurrency: true } }) : [];
  const priceOf = new Map(l.items.map((i) => [i.productId, i.price.toString()]));
  return (
    <>
      <PageHeader title={l.name} parent={{ href: "/fiyat-listeleri", label: "Fiyat Listeleri" }} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
            <h2 className="flex items-center gap-3 text-lg uppercase text-text"><FileText className="size-7 text-text-3" /> {l.name} <span className="text-sm text-text-3">({l.currency})</span></h2>
            {canEdit && <LinkButton href={`/fiyat-listeleri/${l.id}/duzenle`} variant="secondary">Düzenle</LinkButton>}
          </div>
          {canEdit ? (
            <PriceListItemsForm id={l.id} currency={l.currency} products={products.map((p) => ({ id: p.id, name: p.name, code: p.code, sellPrice: p.sellPrice?.toString() ?? null, sellCurrency: p.sellCurrency, price: priceOf.get(p.id) ?? null }))} />
          ) : l.items.length === 0 ? (
            <p className="px-4 py-4 text-sm text-text-3">Listede fiyat yok.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {l.items.map((i) => <tr key={i.id}><Td>{i.product.name}</Td><Td className="text-right font-mono">{i.price.toString().replace(".", ",")} {l.currency}</Td></tr>)}
              </tbody>
            </table>
          )}
        </Card>
        <aside className="flex flex-col gap-3">
          <Card className="p-4 text-sm">
            <p className="mb-2 text-[11px] font-semibold uppercase text-text-2">Bu listeyi kullanan müşteriler</p>
            {l.contacts.length === 0 ? <p className="text-text-3">Yok. Müşteri kartında &quot;Fiyat listesi&quot; seçin.</p> : (
              <ul className="flex flex-col gap-1">{l.contacts.map((c) => <li key={c.id}><Link href={`/musteriler/${c.id}`} className="hover:text-accent">{c.title}</Link></li>)}</ul>
            )}
          </Card>
          {canEdit && (
            <form action={archivePriceListAction}>
              <input type="hidden" name="id" value={l.id} />
              <input type="hidden" name="archived" value={l.isArchived ? "0" : "1"} />
              <Button type="submit" variant="ghost" size="sm">{l.isArchived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} {l.isArchived ? "Arşivden çıkar" : "Arşivle"}</Button>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}

export async function PriceListFormPage({ params }: { params?: Promise<{ id: string }> }) {
  const user = await requireUser("stock.write");
  const id = params ? (await params).id : null;
  const l = id ? await orNotFound(getPriceList(user, id)) : null;
  return (
    <>
      <PageHeader title={id ? "Düzenle" : "Yeni fiyat listesi"} parent={{ href: id ? `/fiyat-listeleri/${id}` : "/fiyat-listeleri", label: l?.name ?? "Fiyat Listeleri" }} />
      <Card><PriceListForm values={{ id: l?.id, name: l?.name ?? "", currency: l?.currency ?? "TRY", notes: l?.notes ?? null }} cancelHref={id ? `/fiyat-listeleri/${id}` : "/fiyat-listeleri"} /></Card>
    </>
  );
}

