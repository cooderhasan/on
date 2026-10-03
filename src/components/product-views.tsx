import Link from "next/link";
import { AlertCircle, Archive, ArchiveRestore, Barcode, Boxes, Hash, Minus, Package, Percent, Plus, Ruler } from "lucide-react";
import Decimal from "decimal.js";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getProduct, listProducts } from "@/server/services/products";
import { listCategories } from "@/server/services/categories";
import { orNotFound, pageParam, strParam } from "@/server/page-helpers";
import { archiveProductAction } from "@/app/actions/records";
import { Button, Card, EmptyState, LinkButton, PageHeader, Td, Th } from "./ui";
import { buildHref, CategoryBadge, InfoRow, ListFooter, ListToolbar } from "./list";
import { Money } from "./money";
import { ProductForm, type ProductFormValues } from "./product-form";
import { unitLabel } from "@/lib/units";
import { cn } from "@/lib/cn";

type SP = Record<string, string | string[] | undefined>;
const BASE = "/hizmet-ve-urunler";

/** Miktar: "12,00 Adet" (Paraşüt görünümü) */
function Qty({ value, unit, className }: { value: { toString(): string }; unit: string; className?: string }) {
  const d = new Decimal(value.toString());
  return (
    <span className={cn("whitespace-nowrap font-mono", className)}>
      <b>{d.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}</b> <span className="text-xs text-text-3">{unitLabel(unit)}</span>
    </span>
  );
}

const price = (v: { toString(): string } | null, currency: string) => (v === null ? <span className="text-text-3">—</span> : <Money value={v.toString()} currency={currency} unitPrice />);

export async function ProductListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("stock.read");
  const sp = await searchParams;
  const q = strParam(sp.q);
  const archived = strParam(sp.arsiv) === "1";
  const critical = strParam(sp.kritik) === "1";
  const categoryId = strParam(sp.kategori);
  const [{ rows, total, page, pages }, categories] = await Promise.all([
    listProducts(user, { q, archived, critical, categoryId, page: pageParam(sp.sayfa) }),
    listCategories("PRODUCT"),
  ]);
  const href = (p: number) => buildHref(BASE, { q, arsiv: archived ? "1" : undefined, kritik: critical ? "1" : undefined, kategori: categoryId, sayfa: p > 1 ? p : undefined });
  const canEdit = can(user.role, "stock.write");

  return (
    <>
      <PageHeader title={archived ? "Hizmet ve Ürünler · Arşiv" : "Hizmet ve Ürünler"} />
      <ListToolbar
        action={BASE}
        q={q}
        placeholder="Ad, stok kodu, barkod…"
        hidden={{ arsiv: archived ? "1" : undefined }}
        filters={
          <>
            {categories.length > 0 && (
              <select name="kategori" defaultValue={categoryId ?? ""} aria-label="Kategori" className="h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs">
                <option value="">Tüm kategoriler</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <label className="flex items-center gap-1.5 whitespace-nowrap px-1 text-xs text-text-2">
              <input type="checkbox" name="kritik" value="1" defaultChecked={critical} className="accent-accent" /> Kritik stok
            </label>
          </>
        }
        actions={canEdit ? <LinkButton href={`${BASE}/yeni`}>Hizmet / ürün ekle</LinkButton> : undefined}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title={q || critical || categoryId ? "Filtreye uyan ürün yok" : archived ? "Arşivde ürün yok" : "Henüz hizmet / ürün eklenmedi"}
            action={!q && !archived && canEdit ? <LinkButton href={`${BASE}/yeni`}>Hizmet / ürün ekle</LinkButton> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="border-b border-border">
                <tr>
                  <Th className="w-10" />
                  <Th>Adı</Th>
                  <Th className="text-right">Stok miktarı</Th>
                  <Th className="hidden text-right md:table-cell">Alış (vergiler hariç)</Th>
                  <Th className="text-right">Satış (vergiler hariç)</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((p) => {
                  const low = p.trackStock && p.criticalStock !== null && p.stockQuantity.lessThanOrEqualTo(p.criticalStock);
                  return (
                    <tr key={p.id} className="hover:bg-card-muted">
                      <Td><span className="grid size-8 place-items-center rounded-sm bg-[#d9d9d9] text-white"><Package className="size-4" /></span></Td>
                      <Td>
                        <Link href={`${BASE}/${p.id}`} className="font-medium uppercase text-text hover:text-accent">{p.name}</Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-text-3">
                          {p.code && <span className="font-mono">{p.code}</span>}
                          {p.category && <CategoryBadge category={p.category} />}
                        </div>
                      </Td>
                      <Td className="text-right">
                        {p.trackStock ? (
                          <span className={cn("inline-flex items-center gap-1", (low || p.stockQuantity.isNegative()) && "text-danger")}>
                            {low && <AlertCircle className="size-3.5" aria-label="Kritik stok" />}
                            <Qty value={p.stockQuantity} unit={p.unit} />
                          </span>
                        ) : (
                          <span className="text-xs text-text-3">Takip yok</span>
                        )}
                      </Td>
                      <Td className="hidden text-right md:table-cell">{price(p.buyPrice, p.buyCurrency)}</Td>
                      <Td className="text-right">{price(p.sellPrice, p.sellCurrency)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <ListFooter
          total={total}
          page={page}
          pages={pages}
          href={href}
          summary={<Link href={buildHref(BASE, { arsiv: archived ? undefined : "1" })} className="text-accent hover:underline">{archived ? "Aktif kayıtlar" : "Arşiv"}</Link>}
        />
      </Card>
    </>
  );
}

export async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("stock.read");
  const p = await orNotFound(getProduct(user, (await params).id));
  const canEdit = can(user.role, "stock.write");
  const incl = (v: { toString(): string } | null) => (v === null ? null : new Decimal(v.toString()).times(100 + p.vatRate).dividedBy(100));

  return (
    <>
      <PageHeader title={p.name} parent={{ href: BASE, label: "Hizmet ve Ürünler" }} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
            <h2 className="flex min-w-0 items-center gap-3 text-lg uppercase text-text"><Package className="size-7 shrink-0 text-text-3" /> {p.name}</h2>
            <div className="flex items-center gap-2">
              <CategoryBadge category={p.category} />
              {p.isArchived && <span className="rounded-sm bg-warning px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Arşivde</span>}
              {canEdit && <LinkButton href={`${BASE}/${p.id}/duzenle`} variant="secondary">Düzenle</LinkButton>}
            </div>
          </div>
          <dl className="py-3">
            <InfoRow label="Ürün / stok kodu" icon={<Hash />}>{p.code && <span className="font-mono">{p.code}</span>}</InfoRow>
            <InfoRow label="Barkod" icon={<Barcode />}>{p.barcode && <span className="font-mono">{p.barcode}</span>}</InfoRow>
            <InfoRow label="Birim" icon={<Ruler />}>{unitLabel(p.unit)}</InfoRow>
            <InfoRow label="GTİP kodu" icon={<Hash />}>{p.gtipCode}</InfoRow>
            <InfoRow label="KDV" icon={<Percent />}>%{p.vatRate}</InfoRow>
            <InfoRow label="Alış fiyatı" icon={<Minus />}>
              {p.buyPrice && <>{price(p.buyPrice, p.buyCurrency)} <span className="ml-2 text-xs text-text-3">KDV dahil <Money value={incl(p.buyPrice)!} currency={p.buyCurrency} /></span></>}
            </InfoRow>
            <InfoRow label="Satış fiyatı" icon={<Plus />}>
              {p.sellPrice && <>{price(p.sellPrice, p.sellCurrency)} <span className="ml-2 text-xs text-text-3">KDV dahil <Money value={incl(p.sellPrice)!} currency={p.sellCurrency} /></span></>}
            </InfoRow>
          </dl>
        </Card>
        <aside className="flex flex-col gap-4">
          <Card>
            <div className="px-4 py-4">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-2"><Boxes className="size-3.5" /> Stok</p>
              {p.trackStock ? (
                <>
                  <p className="mt-2 text-xl"><Qty value={p.stockQuantity} unit={p.unit} className={p.stockQuantity.isNegative() ? "text-danger" : undefined} /></p>
                  {p.criticalStock !== null && (
                    <p className={cn("mt-1 text-xs", p.stockQuantity.lessThanOrEqualTo(p.criticalStock) ? "text-danger" : "text-text-3")}>
                      Kritik seviye: <Qty value={p.criticalStock} unit={p.unit} />
                    </p>
                  )}
                  <p className="mt-2 text-xs text-text-3">Stok hareketleri (fatura, irsaliye, sayım) Faz 5 ile listelenecek.</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-text-3">Bu hizmet / ürün için stok takibi yapılmıyor.</p>
              )}
            </div>
          </Card>
          {canEdit && (
            <form action={archiveProductAction}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="archived" value={p.isArchived ? "0" : "1"} />
              <Button type="submit" variant="ghost" size="sm">
                {p.isArchived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                {p.isArchived ? "Arşivden çıkar" : "Arşivle"}
              </Button>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}

export async function ProductFormPage({ params }: { params?: Promise<{ id: string }> }) {
  const user = await requireUser("stock.write");
  const categories = await listCategories("PRODUCT");
  const id = params ? (await params).id : null;
  let values: ProductFormValues;
  if (id) {
    const p = await orNotFound(getProduct(user, id));
    values = {
      ...p,
      initialStock: p.initialStock.toString(),
      criticalStock: p.criticalStock?.toString() ?? null,
      buyPrice: p.buyPrice?.toString() ?? null,
      sellPrice: p.sellPrice?.toString() ?? null,
    };
  } else {
    values = { name: "", code: null, barcode: null, categoryId: null, unit: "C62", gtipCode: null, trackStock: true, initialStock: "0", criticalStock: null, buyPrice: null, buyCurrency: "TRY", sellPrice: null, sellCurrency: "TRY", vatRate: 20 };
  }
  return (
    <>
      <PageHeader title={id ? "Düzenle" : "Yeni"} parent={{ href: id ? `${BASE}/${id}` : BASE, label: id ? values.name : "Hizmet ve Ürünler" }} />
      <Card>
        <ProductForm values={values} categories={categories} cancelHref={id ? `${BASE}/${id}` : BASE} />
      </Card>
    </>
  );
}
