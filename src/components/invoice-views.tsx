import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CircleCheck, FileDown, FileText, Package, Printer, User } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { getInvoice, listInvoices, type PaymentFilter } from "@/server/services/invoices";
import { activeWarehouses } from "@/server/services/stock";
import { priceListsForForm } from "@/server/services/price-lists";
import { getWaybill } from "@/server/services/waybills";
import { addPeriod, getRecurring, runRecurring } from "@/server/services/recurring";
import { RecurringForm } from "./recurring-form";
import { listCategories, listTags } from "@/server/services/categories";
import { orNotFound, pageParam, strParam } from "@/server/page-helpers";
import { deleteInvoiceAction } from "@/app/actions/sales";
import { Alert, buttonClass, Card, CardHeader, EmptyState, LinkButton, PageHeader, Td, Th } from "./ui";
import { buildHref, CategoryBadge, ListFooter, ListToolbar } from "./list";
import { Money } from "./money";
import { DocumentForm, type DocumentFormValues, type FormContact, type FormProduct } from "./document-form";
import { ConfirmDelete, DeleteTransactionButton, SettlementForm } from "./money-forms";
import { EDocPanel } from "./einvoice-forms";
import { isVoidEDoc } from "@/lib/edoc-status";
import { unitLabel } from "@/lib/units";
import { cn } from "@/lib/cn";

type SP = Record<string, string | string[] | undefined>;
const BASE = "/satislar";

export const fmtDate = (d: Date) => d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

const EDOC_LABEL: Record<string, { label: string; tone: string }> = {
  QUEUED: { label: "Gönderiliyor", tone: "bg-warning" },
  SENT: { label: "Gönderildi", tone: "bg-warning" },
  ACCEPTED: { label: "Resmileşti", tone: "bg-success" },
  REJECTED: { label: "Reddedildi", tone: "bg-danger" },
  FAILED: { label: "Gönderilemedi", tone: "bg-danger" },
  CANCELLED: { label: "İptal", tone: "bg-text-3" },
};

export function DocStatusBadge({ status, profile }: { status: string; profile: string | null }) {
  if (status === "NONE") return <span className="text-[11px] text-text-3">Kağıt / taslak</span>;
  const s = EDOC_LABEL[status] ?? { label: status, tone: "bg-text-3" };
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-text-3">
      {profile === "EARSIVFATURA" ? "e-Arşiv" : profile === "IRSALIYE" ? "e-İrsaliye" : "e-Fatura"}
      <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white", s.tone)}>{s.label}</span>
    </span>
  );
}

export async function InvoiceListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("sales.read");
  // Zamanlayıcı kurulmamışsa (yerel) vadesi gelen tekrarlayan faturalar burada oluşur
  if (can(user.role, "sales.write")) await runRecurring();
  const sp = await searchParams;
  const q = strParam(sp.q);
  const payment = strParam(sp.durum) as PaymentFilter | undefined;
  const from = strParam(sp.baslangic);
  const to = strParam(sp.bitis);
  const { rows, total, page, pages, totals } = await listInvoices(user, "SALE", { q, payment: ["open", "overdue", "paid"].includes(payment ?? "") ? payment : undefined, from, to, page: pageParam(sp.sayfa) });
  const href = (p: number) => buildHref(BASE, { q, durum: payment, baslangic: from, bitis: to, sayfa: p > 1 ? p : undefined });
  const canWrite = can(user.role, "sales.write");
  const today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" }) + "T00:00:00Z");

  return (
    <>
      <PageHeader title="Satış Faturaları" />
      <ListToolbar
        action={BASE}
        q={q}
        placeholder="Fatura ismi, no, müşteri…"
        filters={
          <>
            <select name="durum" defaultValue={payment ?? ""} aria-label="Tahsilat durumu" className="h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs">
              <option value="">Tüm faturalar</option>
              <option value="open">Tahsil edilecek</option>
              <option value="overdue">Vadesi geçmiş</option>
              <option value="paid">Tahsil edildi</option>
            </select>
            <input type="date" name="baslangic" defaultValue={from} aria-label="Başlangıç tarihi" className="h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs" />
            <input type="date" name="bitis" defaultValue={to} aria-label="Bitiş tarihi" className="h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs" />
          </>
        }
        actions={
          canWrite ? (
            <>
              <LinkButton href={`${BASE}/yeni`}>Yeni fatura oluştur</LinkButton>
              <LinkButton href={`${BASE}/yeni?tur=iade`} variant="secondary">İade faturası</LinkButton>
            </>
          ) : undefined
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={q || payment || from || to ? "Filtreye uyan fatura yok" : "Henüz satış faturası yok"} action={canWrite && !q ? <LinkButton href={`${BASE}/yeni`}>Yeni fatura oluştur</LinkButton> : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border">
                <tr><Th className="w-10" /><Th>Fatura ismi</Th><Th className="hidden lg:table-cell">Fatura no</Th><Th>Düzenleme tarihi</Th><Th>Vade tarihi</Th><Th className="text-right">Kalan meblağ</Th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((i) => {
                  const late = i.overdue ? daysBetween(i.dueDate, today) : 0;
                  return (
                    <tr key={i.id} className="hover:bg-card-muted">
                      <Td><span className={cn("grid size-8 place-items-center rounded-sm border text-[13px] font-bold italic", i.overdue ? "border-danger text-danger" : "border-[#c9c9c9] text-text-3")}>e</span></Td>
                      <Td>
                        <Link href={`${BASE}/${i.id}`} className="font-medium text-text hover:text-accent">{i.name || (i.kind === "RETURN" ? "İade Faturası" : "Satış Faturası")}</Link>
                        <p className="text-xs uppercase text-text-3">{i.contact.title}</p>
                      </Td>
                      <Td className="hidden font-mono text-xs text-text-2 lg:table-cell">{i.invoiceNo ?? "—"}</Td>
                      <Td>
                        <p>{fmtDate(i.issueDate)}</p>
                        <DocStatusBadge status={i.eDocStatus} profile={i.eDocProfile} />
                      </Td>
                      <Td className={i.overdue ? "text-danger" : undefined}>
                        {i.remaining.greaterThan(0) ? (
                          <>
                            <p>{fmtDate(i.dueDate)}</p>
                            {i.overdue && <p className="text-xs">({late} gün gecikti)</p>}
                          </>
                        ) : (
                          <span className="flex items-center gap-1 text-success"><CircleCheck className="size-4" /> Tahsil edildi</span>
                        )}
                      </Td>
                      <Td className="text-right">
                        <Money value={i.remaining} currency={i.currency} className={i.overdue ? "text-danger" : undefined} />
                        <p className="text-[11px] text-text-3">Genel toplam <Money value={i.payableTotal.toString()} currency={i.currency} /></p>
                      </Td>
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
          exportHref={buildHref("/api/disa-aktar/satis-faturalari", { q, durum: payment, baslangic: from, bitis: to })}
          summary={<><Link href="/satislar/tekrarlayan" className="text-accent hover:underline">Tekrarlayan faturalar</Link>{totals.payable.map((t) => <span key={t.currency}>Toplam <Money value={t.total} currency={t.currency} /></span>)}{totals.remaining.map((t) => <span key={t.currency}>Tahsil edilecek <Money value={t.total} currency={t.currency} /></span>)}</>}
        />
      </Card>
    </>
  );
}

/** Satış / alış faturası için yol, etiket ve yetkiler */
export const DIR = {
  SALE: { base: "/satislar", list: "Satış Faturaları", single: "Satış Faturası", read: "sales.read", write: "sales.write", contactBase: "/musteriler", contactParam: "musteri" },
  PURCHASE: { base: "/giderler", list: "Gider Listesi", single: "Alış Faturası", read: "expenses.read", write: "expenses.write", contactBase: "/tedarikciler", contactParam: "tedarikci" },
} as const;

export async function InvoiceDetailPage({ params, searchParams, direction = "SALE" }: { params: Promise<{ id: string }>; searchParams: Promise<SP>; direction?: "SALE" | "PURCHASE" }) {
  const M = DIR[direction];
  const BASE = M.base;
  const user = await requireUser(M.read);
  const inv = await orNotFound(getInvoice(user, (await params).id));
  if (inv.direction !== direction) notFound();
  const sp = await searchParams;
  const canWrite = can(user.role, M.write) && can(user.role, "cash.write");
  const canSend = can(user.role, "einvoice.send");
  const recurring = direction === "SALE" && inv.kind === "INVOICE" ? await getRecurring(inv.id) : null;
  const accounts = canWrite ? await db.account.findMany({ where: { isArchived: false }, select: { id: true, name: true, currency: true }, orderBy: { name: "asc" } }) : [];
  const title = inv.name || (inv.kind === "RETURN" ? "İade Faturası" : M.single);
  const c = inv.contact;
  // Para girişi mi (tahsilat) çıkışı mı (ödeme)
  const moneyIn = (direction === "PURCHASE") === (inv.kind === "RETURN");

  return (
    <>
      <PageHeader title={title} parent={{ href: BASE, label: M.list }} />
      {strParam(sp.uyari) === "tahsilat" && <Alert tone="warning" className="mb-4">Fatura kaydedildi ama tahsilat eklenemedi (hesap dövizi farklı olabilir). Tahsilatı sağdaki panelden ekleyin.</Alert>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
            <h2 className="flex items-center gap-3 text-lg text-text"><FileText className="size-7 text-accent" /> {title}</h2>
            <div className="flex items-center gap-2">
              {canWrite && !inv.locked && <LinkButton href={`${BASE}/${inv.id}/duzenle`} variant="secondary">Düzenle</LinkButton>}
              {direction === "PURCHASE" ? (
                // Gelen e-faturadan oluştuysa tedarikçinin gönderdiği resmi belge (NES görüntüsü)
                inv.incoming ? (
                  <>
                    <a href={`/api/einvoice/incoming/${inv.incoming.id}/html`} target="_blank" rel="noopener" className={buttonClass("secondary")}><FileText className="size-3.5" /> e-Faturayı göster</a>
                    <a href={`/api/einvoice/incoming/${inv.incoming.id}/pdf`} target="_blank" rel="noopener" className={buttonClass("secondary")}><FileDown className="size-3.5" /> PDF</a>
                  </>
                ) : null
              ) : inv.eDocStatus === "NONE" || inv.eDocStatus === "FAILED" ? (
                <LinkButton href={`${BASE}/${inv.id}/yazdir`} variant="secondary" target="_blank"><Printer className="size-3.5" /> Yazdır</LinkButton>
              ) : (
                // Gönderilmiş e-belgenin resmi görüntüsü NES'ten (kendi şablonumuz değil)
                <a href={`/api/einvoice/${inv.id}/html`} target="_blank" rel="noopener" className={buttonClass("secondary")}><Printer className="size-3.5" /> e-Belgeyi göster</a>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
            <CategoryBadge category={inv.category} />
            <div className="flex flex-wrap gap-1.5">
              {inv.tags.map((t) => <span key={t.tagId} className="rounded-sm border border-dashed border-text-3 px-1.5 py-0.5 text-[10px] uppercase text-text-2">{t.tag.name}</span>)}
            </div>
          </div>
          <div className="grid gap-3 border-b border-border px-4 py-4 sm:grid-cols-2">
            <div className="flex gap-3">
              <User className="mt-0.5 size-4 shrink-0 text-text-3" />
              <div>
                <Link href={`${M.contactBase}/${c.id}`} className="font-medium uppercase text-text hover:text-accent">{c.title}</Link>
                <p className="text-xs text-text-2">{[c.address, [c.district, c.city].filter(Boolean).join(" / ")].filter(Boolean).join(" ")}</p>
                {c.taxNumber && <p className="text-xs text-text-2">{c.taxOffice ? `${c.taxOffice} V.D. · ` : ""}{c.taxNumber.length === 11 ? "TCKN" : "VKN"} {c.taxNumber}</p>}
              </div>
            </div>
            <div className="text-sm text-text-2 sm:text-right">
              <p>{fmtDate(inv.issueDate)}{inv.invoiceNo && <span className="ml-3 font-mono"># {inv.invoiceNo}</span>}</p>
              <p className="text-xs">Vade: {fmtDate(inv.dueDate)}</p>
              {inv.currency !== "TRY" && <p className="text-xs">Kur: 1 {inv.currency} = {inv.exchangeRate.toString()} TL</p>}
              {inv.quote && <p className="text-xs"><Link href={`/teklifler/${inv.quote.id}`} className="text-accent hover:underline">Tekliften oluşturuldu</Link></p>}
              {inv.recurring && <p className="text-xs"><Link href={`/satislar/${inv.recurring.templateId}`} className="text-accent hover:underline">Tekrarlayan faturadan oluşturuldu</Link></p>}
              {inv.waybills.map((w) => (
                <p key={w.id} className="text-xs"><Link href={`${direction === "SALE" ? "/giden-irsaliyeler" : "/gelen-irsaliyeler"}/${w.id}`} className="text-accent hover:underline">İrsaliye {w.waybillNo ?? fmtDate(w.dispatchDate)}</Link></p>
              ))}
              {inv.stockMode === "WITH_INVOICE" && inv.warehouse && <p className="text-xs">Depo: {inv.warehouse.name}</p>}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-border bg-card-muted"><tr><Th>Hizmet / ürün</Th><Th className="text-right">Miktar</Th><Th className="text-right">Br. fiyat</Th><Th className="text-right">Vergi</Th><Th className="text-right">Toplam</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {inv.lines.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      <span className="flex items-center gap-1.5">{l.productId && <Package className="size-3.5 text-text-3" />}{l.name}</span>
                      {l.description && <p className="text-xs text-text-3">{l.description}</p>}
                      {l.discountAmount.greaterThan(0) && <p className="text-xs text-text-3">İndirim −<Money value={l.discountAmount.toString()} currency={inv.currency} /></p>}
                    </Td>
                    <Td className="text-right"><span className="font-mono">{l.quantity.toString().replace(".", ",")}</span> <span className="text-xs text-text-3">{unitLabel(l.unit)}</span></Td>
                    <Td className="text-right"><Money value={l.unitPrice.toString()} currency={inv.currency} unitPrice /></Td>
                    <Td className="text-right text-xs text-text-2">
                      KDV %{l.vatRate}
                      {l.otvRate && <><br />ÖTV %{l.otvRate.toString()}</>}
                      {l.withholdingRate && <><br />Tevkifat {l.withholdingRate / 10}/10{l.withholdingCode ? ` (${l.withholdingCode})` : ""}</>}
                    </Td>
                    <Td className="text-right"><Money value={l.totalAmount.toString()} currency={inv.currency} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end border-t border-border px-4 py-3">
            <dl className="w-full max-w-sm text-sm">
              {[
                ["Ara toplam", inv.grossTotal, true],
                ["Toplam indirim", inv.discountTotal.negated(), inv.discountTotal.greaterThan(0)],
                ["Toplam ÖTV", inv.otvTotal, inv.otvTotal.greaterThan(0)],
                ["Toplam KDV", inv.vatTotal, true],
                ["Genel toplam", inv.grandTotal, true],
                ["Tevkifat", inv.withholdingTotal.negated(), inv.withholdingTotal.greaterThan(0)],
                ["Ödenecek", inv.payableTotal, inv.withholdingTotal.greaterThan(0)],
              ]
                .filter((r) => r[2])
                .map(([label, value]) => (
                  <div key={String(label)} className="flex justify-between border-b border-border py-2 last:border-0">
                    <dt className="text-[11px] font-semibold uppercase text-text-2">{String(label)}</dt>
                    <dd><Money value={(value as { toString(): string }).toString()} currency={inv.currency} className={label === "Genel toplam" || label === "Ödenecek" ? "text-teal" : "text-text-2"} /></dd>
                  </div>
                ))}
            </dl>
          </div>
          {inv.notes && <p className="whitespace-pre-line border-t border-border px-4 py-3 text-sm text-text-2">{inv.notes}</p>}
        </Card>

        <aside className="flex flex-col gap-4">
          <Card>
            {direction === "SALE" && <div className="flex flex-col gap-2 border-b border-border px-4 py-3 text-sm">
              <p className="text-[11px] font-semibold uppercase text-text-2">e-Belge durumu</p>
              <DocStatusBadge status={inv.eDocStatus} profile={inv.eDocProfile} />
              {inv.eDocSentAt && <p className="text-xs text-text-3">Gönderim: {inv.eDocSentAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}{inv.eDocCheckedAt ? ` · son sorgu ${inv.eDocCheckedAt.toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" })}` : ""}</p>}
              {inv.eDocAnswer && inv.eDocAnswer !== "None" && <p className="text-xs text-text-2">Alıcı yanıtı: {{ Waiting: "Bekleniyor", Accepted: "Kabul etti", Rejected: "Reddetti" }[inv.eDocAnswer] ?? inv.eDocAnswer}</p>}
              {inv.eDocError && <Alert tone={inv.eDocStatus === "REJECTED" || inv.eDocStatus === "FAILED" ? "danger" : "warning"} className="text-xs">{inv.eDocError}</Alert>}
              {(inv.eDocStatus === "REJECTED" || inv.eDocStatus === "CANCELLED") && <p className="text-xs text-text-3">Bu faturanın hukuki etkisi yok: bakiyeye ve stoğa yansımaz. Silebilir, gerekirse yeni fatura kesebilirsiniz.</p>}
              <EDocPanel invoiceId={inv.id} status={inv.eDocStatus} profile={inv.eDocProfile} canSend={canSend} hasError={inv.eDocStatus === "FAILED"} />
            </div>}
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-2">Kalan</span>
              <Money value={inv.remaining} currency={inv.currency} className={cn("text-xl", inv.overdue ? "text-danger" : "")} />
            </div>
            {inv.overdue && <p className="flex items-center gap-1.5 px-4 pb-3 text-xs text-danger"><AlertTriangle className="size-3.5" /> Vadesi geçti</p>}
            {canWrite && inv.remaining.greaterThan(0) && !isVoidEDoc(inv.eDocStatus) && (
              <div className="border-t border-border px-4 py-4">
                <p className="mb-2 text-[11px] font-semibold uppercase text-text-2">{moneyIn ? "Tahsilat ekle" : "Ödeme ekle"}</p>
                <SettlementForm invoiceId={inv.id} accounts={accounts} docCurrency={inv.currency} defaultAmount={inv.remaining.toString()} label={moneyIn ? "Tahsilat ekle" : "Ödeme ekle"} />
                {inv.kind === "INVOICE" && can(user.role, "cash.write") && (
                  <Link href={`/cekler/yeni?fatura=${inv.id}`} className="mt-2 inline-block text-xs text-accent hover:underline">{moneyIn ? "Çek ile tahsil et" : "Çek ile öde"}</Link>
                )}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title={moneyIn ? "Tahsilatlar" : "Ödemeler"} />
            {inv.transactions.length === 0 ? (
              <p className="px-4 py-4 text-sm text-text-3">Henüz {moneyIn ? "tahsilat" : "ödeme"} yok.</p>
            ) : (
              <ul className="divide-y divide-border">
                {inv.transactions.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-2 px-4 py-2.5 text-sm">
                    <div>
                      <p><Money value={t.appliedAmount.toString()} currency={inv.currency} /></p>
                      <p className="text-xs text-text-3">
                        {fmtDate(t.date)} ·{" "}
                        {t.account ? <Link href={`/kasa-ve-bankalar/${t.account.id}`} className="hover:underline">{t.account.name}</Link> : t.cheque ? <Link href={`/cekler/${t.cheque.id}`} className="hover:underline">Çek {t.cheque.chequeNo}</Link> : null}
                      </p>
                      {t.description && <p className="text-xs text-text-3">{t.description}</p>}
                    </div>
                    {canWrite && !t.chequeId && <DeleteTransactionButton id={t.id} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {direction === "SALE" && inv.kind === "INVOICE" && (recurring || can(user.role, "sales.write")) && (
            <Card className="p-4 text-sm">
              <p className="mb-2 text-[11px] font-semibold uppercase text-text-2">Tekrarlayan fatura</p>
              {recurring && (
                <div className="mb-2 text-xs text-text-2">
                  {recurring.isActive ? (
                    <p>{recurring.interval > 1 ? `${recurring.interval} ` : ""}{recurring.period === "MONTHLY" ? "Ayda" : "Yılda"} bir · sonraki: <b>{fmtDate(recurring.nextDate)}</b>{recurring.endDate && ` · bitiş ${fmtDate(recurring.endDate)}`}</p>
                  ) : (
                    <p className="text-text-3">Durduruldu</p>
                  )}
                  {recurring.invoices.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {recurring.invoices.map((r) => <li key={r.id}><Link href={`/satislar/${r.id}`} className="text-accent hover:underline">{fmtDate(r.issueDate)}{r.invoiceNo ? ` · ${r.invoiceNo}` : ""}</Link></li>)}
                    </ul>
                  )}
                </div>
              )}
              {can(user.role, "sales.write") && (
                <RecurringForm
                  invoiceId={inv.id}
                  active={Boolean(recurring?.isActive)}
                  values={{
                    period: recurring?.period ?? "MONTHLY",
                    interval: recurring?.interval ?? 1,
                    nextDate: (recurring?.nextDate ?? addPeriod(inv.issueDate, "MONTHLY", 1, inv.issueDate.getUTCDate())).toISOString().slice(0, 10),
                    endDate: recurring?.endDate?.toISOString().slice(0, 10) ?? null,
                  }}
                />
              )}
            </Card>
          )}
          {can(user.role, M.write) && inv.deletable && <ConfirmDelete action={deleteInvoiceAction} id={inv.id} label="Faturayı sil" confirmText="Fatura kalıcı olarak silinsin mi?" />}
        </aside>
      </div>
    </>
  );
}

/** Form için seçenek listeleri */
export async function documentFormData(direction: "SALE" | "PURCHASE") {
  const [contacts, products, categories, tags, accounts, warehouses, priceLists] = await Promise.all([
    db.contact.findMany({ where: { kind: direction === "SALE" ? "CUSTOMER" : "SUPPLIER", isArchived: false }, orderBy: { title: "asc" }, select: { id: true, title: true, currency: true, taxNumber: true, address: true, district: true, city: true, priceListId: true } }),
    db.product.findMany({ where: { isArchived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true, sellPrice: true, buyPrice: true, vatRate: true } }),
    listCategories(direction === "SALE" ? "SALES" : "EXPENSE"),
    listTags(),
    db.account.findMany({ where: { isArchived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, currency: true } }),
    activeWarehouses(),
    direction === "SALE" ? priceListsForForm() : Promise.resolve([]),
  ]);
  const formProducts: FormProduct[] = products.map((p) => ({ id: p.id, name: p.name, code: p.code, unit: p.unit, vatRate: p.vatRate, sellPrice: (direction === "SALE" ? p.sellPrice : p.buyPrice)?.toString() ?? null }));
  const formContacts: FormContact[] = contacts;
  return { contacts: formContacts, products: formProducts, categories, tags, accounts, warehouses, priceLists };
}

export async function InvoiceFormPage({ params, searchParams, direction = "SALE" }: { params?: Promise<{ id: string }>; searchParams?: Promise<SP>; direction?: "SALE" | "PURCHASE" }) {
  const M = DIR[direction];
  const BASE = M.base;
  const user = await requireUser(M.write);
  const id = params ? (await params).id : null;
  const data = await documentFormData(direction);
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
  let values: DocumentFormValues;
  if (id) {
    const inv = await orNotFound(getInvoice(user, id));
    if (inv.direction !== direction) notFound();
    if (inv.locked) notFound();
    // Arşivlenmiş müşteri seçili kalabilsin
    if (!data.contacts.some((c) => c.id === inv.contactId)) data.contacts.unshift({ id: inv.contact.id, title: inv.contact.title, currency: inv.contact.currency, taxNumber: inv.contact.taxNumber, address: inv.contact.address, district: inv.contact.district, city: inv.contact.city });
    values = {
      id: inv.id, kind: inv.kind, name: inv.name, docNo: inv.invoiceNo, contactId: inv.contactId, issueDate: inv.issueDate.toISOString().slice(0, 10), dueDate: inv.dueDate.toISOString().slice(0, 10),
      currency: inv.currency, exchangeRate: inv.exchangeRate.toString(), categoryId: inv.categoryId, notes: inv.notes, orderNo: inv.orderNo, orderDate: inv.orderDate?.toISOString().slice(0, 10) ?? null,
      returnRefNo: inv.returnRefNo, returnRefDate: inv.returnRefDate?.toISOString().slice(0, 10) ?? null,
      stockMode: inv.stockMode, warehouseId: inv.warehouseId, discountType: inv.discountType, discountValue: inv.discountValue?.toString() ?? null, tagIds: inv.tags.map((t) => t.tagId),
      lines: inv.lines.map((l) => ({
        productId: l.productId ?? "", name: l.name, description: l.description, quantity: l.quantity.toString().replace(".", ","), unit: l.unit, unitPrice: l.unitPrice.toString().replace(".", ","),
        discountType: l.discountType ?? "", discountValue: l.discountValue?.toString().replace(".", ",") ?? "", vatRate: l.vatRate, vatExemptionCode: l.vatExemptionCode ?? "", otvRate: l.otvRate?.toString().replace(".", ",") ?? "", otvCode: l.otvCode ?? "0074",
        withholdingRate: l.withholdingRate?.toString() ?? "", withholdingCode: l.withholdingCode ?? "",
      })),
    };
  } else {
    const sp = searchParams ? await searchParams : {};
    const preContact = strParam(sp[M.contactParam]);
    const pc = data.contacts.find((c) => c.id === preContact);
    values = {
      kind: strParam(sp.tur) === "iade" ? "RETURN" : "INVOICE", name: null, docNo: null, contactId: pc?.id ?? "", issueDate: todayIso, dueDate: todayIso, currency: pc?.currency ?? "TRY", exchangeRate: null,
      categoryId: null, notes: null, orderNo: null, orderDate: null, stockMode: "WITH_INVOICE", discountType: null, discountValue: null, tagIds: [], lines: [],
    };
    // İrsaliyeden fatura: cari ve satırlar irsaliyeden, fiyatlar ürün kartı / fiyat listesinden
    const waybillId = strParam(sp.irsaliye);
    if (waybillId) {
      const w = await orNotFound(getWaybill(user, waybillId));
      if (w.direction !== direction || w.invoiceId) notFound();
      const wc = data.contacts.find((c) => c.id === w.contactId);
      const list = wc?.priceListId ? data.priceLists.find((l) => l.id === wc.priceListId && l.currency === w.contact.currency) : undefined;
      const prods = await db.product.findMany({ where: { id: { in: w.lines.map((l) => l.productId).filter((x): x is string => Boolean(x)) } }, select: { id: true, sellPrice: true, buyPrice: true, vatRate: true } });
      values = {
        ...values, contactId: w.contactId, currency: w.contact.currency, waybillId: w.id, waybillNo: w.waybillNo, stockMode: "NONE",
        lines: w.lines.map((l) => {
          const p = prods.find((x) => x.id === l.productId);
          const price = p ? (direction === "SALE" ? (list?.prices[p.id] ?? p.sellPrice?.toString()) : p.buyPrice?.toString()) : null;
          return {
            productId: l.productId ?? "", name: l.name, description: null, quantity: l.quantity.toString().replace(".", ","), unit: l.unit, unitPrice: price ? price.replace(".", ",") : "",
            discountType: "" as const, discountValue: "", vatRate: p?.vatRate ?? 20, vatExemptionCode: "", otvRate: "", otvCode: "0074", withholdingRate: "", withholdingCode: "",
          };
        }),
      };
    }
  }
  const label = values.kind === "RETURN" ? "Yeni iade faturası" : "Yeni fatura";
  return (
    <>
      <PageHeader title={id ? "Düzenle" : label} parent={{ href: id ? `${BASE}/${id}` : BASE, label: id ? values.name || M.single : M.list }} />
      <Card>
        <DocumentForm mode="invoice" direction={direction} values={values} {...data} cancelHref={id ? `${BASE}/${id}` : BASE} />
      </Card>
    </>
  );
}
