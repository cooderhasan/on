import Link from "next/link";
import { FileText, Printer, User } from "lucide-react";
import type { QuoteStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getQuote, listQuotes, QUOTE_STATUS_LABELS } from "@/server/services/quotes";
import { orNotFound, pageParam, strParam } from "@/server/page-helpers";
import { deleteQuoteAction } from "@/app/actions/sales";
import { Card, EmptyState, LinkButton, PageHeader, Td, Th } from "./ui";
import { buildHref, ListFooter, ListToolbar } from "./list";
import { Money } from "./money";
import { DocumentForm, type DocumentFormValues } from "./document-form";
import { ConfirmDelete } from "./money-forms";
import { QuoteActions } from "./quote-actions";
import { documentFormData, fmtDate } from "./invoice-views";
import { unitLabel } from "@/lib/units";
import { cn } from "@/lib/cn";

type SP = Record<string, string | string[] | undefined>;
const BASE = "/teklifler";
const STATUS_TONE: Record<QuoteStatus, string> = { OPEN: "bg-accent", ACCEPTED: "bg-success", REJECTED: "bg-danger", INVOICED: "bg-text-3" };

export function QuoteStatusBadge({ status, expired }: { status: QuoteStatus; expired?: boolean }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase text-white", expired ? "bg-warning" : STATUS_TONE[status])}>{expired ? "Süresi doldu" : QUOTE_STATUS_LABELS[status]}</span>;
}

export async function QuoteListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("sales.read");
  const sp = await searchParams;
  const q = strParam(sp.q);
  const statusRaw = strParam(sp.durum);
  const status = statusRaw && statusRaw in QUOTE_STATUS_LABELS ? (statusRaw as QuoteStatus) : undefined;
  const { rows, total, page, pages } = await listQuotes(user, { q, status, page: pageParam(sp.sayfa) });
  const canWrite = can(user.role, "sales.write");
  return (
    <>
      <PageHeader title="Teklifler" />
      <ListToolbar
        action={BASE}
        q={q}
        placeholder="Teklif ismi, no, müşteri…"
        filters={
          <select name="durum" defaultValue={status ?? ""} aria-label="Durum" className="h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs">
            <option value="">Tüm teklifler</option>
            {(Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[]).map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABELS[s]}</option>)}
          </select>
        }
        actions={canWrite ? <LinkButton href={`${BASE}/yeni`}>Yeni teklif oluştur</LinkButton> : undefined}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={q || status ? "Filtreye uyan teklif yok" : "Henüz teklif yok"} action={canWrite && !q ? <LinkButton href={`${BASE}/yeni`}>Yeni teklif oluştur</LinkButton> : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="border-b border-border"><tr><Th>Teklif</Th><Th>Tarih</Th><Th>Geçerlilik</Th><Th>Durum</Th><Th className="text-right">Tutar</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-card-muted">
                    <Td>
                      <Link href={`${BASE}/${r.id}`} className="font-medium text-text hover:text-accent">{r.name || "Teklif"}{r.quoteNo && <span className="ml-2 font-mono text-xs text-text-3">#{r.quoteNo}</span>}</Link>
                      <p className="text-xs uppercase text-text-3">{r.contact.title}</p>
                    </Td>
                    <Td>{fmtDate(r.issueDate)}</Td>
                    <Td className={r.expired ? "text-warning" : undefined}>{r.validUntil ? fmtDate(r.validUntil) : "—"}</Td>
                    <Td><QuoteStatusBadge status={r.status} expired={r.expired} /></Td>
                    <Td className="text-right"><Money value={r.payableTotal} currency={r.currency} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListFooter total={total} page={page} pages={pages} href={(p) => buildHref(BASE, { q, durum: status, sayfa: p > 1 ? p : undefined })} />
      </Card>
    </>
  );
}

export async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("sales.read");
  const qt = await orNotFound(getQuote(user, (await params).id));
  const canWrite = can(user.role, "sales.write");
  const c = qt.contact;
  const expired = qt.status === "OPEN" && qt.validUntil !== null && qt.validUntil < new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" }) + "T00:00:00Z");
  return (
    <>
      <PageHeader title={qt.name || "Teklif"} parent={{ href: BASE, label: "Teklifler" }} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
            <h2 className="flex items-center gap-3 text-lg text-text"><FileText className="size-7 text-accent" /> {qt.name || "Teklif"} {qt.quoteNo && <span className="font-mono text-sm text-text-3">#{qt.quoteNo}</span>}</h2>
            <div className="flex items-center gap-2">
              <QuoteStatusBadge status={qt.status} expired={expired} />
              {canWrite && qt.status !== "INVOICED" && <LinkButton href={`${BASE}/${qt.id}/duzenle`} variant="secondary">Düzenle</LinkButton>}
              <LinkButton href={`${BASE}/${qt.id}/yazdir`} variant="secondary" target="_blank"><Printer className="size-3.5" /> Yazdır</LinkButton>
            </div>
          </div>
          <div className="grid gap-3 border-b border-border px-4 py-4 sm:grid-cols-2">
            <div className="flex gap-3">
              <User className="mt-0.5 size-4 shrink-0 text-text-3" />
              <div>
                <Link href={`/musteriler/${c.id}`} className="font-medium uppercase text-text hover:text-accent">{c.title}</Link>
                <p className="text-xs text-text-2">{[c.address, [c.district, c.city].filter(Boolean).join(" / ")].filter(Boolean).join(" ")}</p>
              </div>
            </div>
            <div className="text-sm text-text-2 sm:text-right">
              <p>{fmtDate(qt.issueDate)}</p>
              {qt.validUntil && <p className={cn("text-xs", expired && "text-warning")}>Geçerlilik: {fmtDate(qt.validUntil)}</p>}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-border bg-card-muted"><tr><Th>Hizmet / ürün</Th><Th className="text-right">Miktar</Th><Th className="text-right">Br. fiyat</Th><Th className="text-right">KDV</Th><Th className="text-right">Toplam</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {qt.lines.map((l) => (
                  <tr key={l.id}>
                    <Td>{l.name}{l.description && <p className="text-xs text-text-3">{l.description}</p>}</Td>
                    <Td className="text-right"><span className="font-mono">{l.quantity.toString().replace(".", ",")}</span> <span className="text-xs text-text-3">{unitLabel(l.unit)}</span></Td>
                    <Td className="text-right"><Money value={l.unitPrice} currency={qt.currency} unitPrice /></Td>
                    <Td className="text-right text-xs">%{l.vatRate}</Td>
                    <Td className="text-right"><Money value={l.totalAmount} currency={qt.currency} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end border-t border-border px-4 py-3">
            <dl className="w-full max-w-sm text-sm">
              <div className="flex justify-between py-1.5"><dt className="text-[11px] font-semibold uppercase text-text-2">Ara toplam</dt><dd><Money value={qt.grossTotal} currency={qt.currency} /></dd></div>
              {qt.discountTotal.greaterThan(0) && <div className="flex justify-between py-1.5"><dt className="text-[11px] font-semibold uppercase text-text-2">İndirim</dt><dd><Money value={qt.discountTotal.negated()} currency={qt.currency} /></dd></div>}
              <div className="flex justify-between py-1.5"><dt className="text-[11px] font-semibold uppercase text-text-2">KDV</dt><dd><Money value={qt.vatTotal} currency={qt.currency} /></dd></div>
              <div className="flex justify-between py-1.5"><dt className="text-[11px] font-semibold uppercase text-text-2">Genel toplam</dt><dd><Money value={qt.payableTotal} currency={qt.currency} className="text-lg text-teal" /></dd></div>
            </dl>
          </div>
          {qt.notes && <p className="whitespace-pre-line border-t border-border px-4 py-3 text-sm text-text-2">{qt.notes}</p>}
        </Card>
        <aside className="flex flex-col gap-4">
          {qt.invoice ? (
            <Card className="p-4 text-sm">
              Bu tekliften fatura oluşturuldu: <Link href={`/satislar/${qt.invoice.id}`} className="text-accent hover:underline">{qt.invoice.name || "Satış Faturası"}</Link>
            </Card>
          ) : (
            canWrite && <QuoteActions id={qt.id} status={qt.status} />
          )}
          {canWrite && !qt.invoice && <ConfirmDelete action={deleteQuoteAction} id={qt.id} label="Teklifi sil" confirmText="Teklif silinsin mi?" />}
        </aside>
      </div>
    </>
  );
}

export async function QuoteFormPage({ params }: { params?: Promise<{ id: string }> }) {
  const user = await requireUser("sales.write");
  const id = params ? (await params).id : null;
  const data = await documentFormData("SALE");
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
  let values: DocumentFormValues;
  if (id) {
    const q = await orNotFound(getQuote(user, id));
    values = {
      id: q.id, kind: "INVOICE", name: q.name, docNo: q.quoteNo, contactId: q.contactId, issueDate: q.issueDate.toISOString().slice(0, 10), dueDate: q.issueDate.toISOString().slice(0, 10),
      validUntil: q.validUntil?.toISOString().slice(0, 10) ?? null, currency: q.currency, exchangeRate: q.exchangeRate.toString(), categoryId: null, notes: q.notes, orderNo: null, orderDate: null,
      stockMode: "NONE", discountType: q.discountType, discountValue: q.discountValue?.toString() ?? null, tagIds: [],
      lines: q.lines.map((l) => ({
        productId: l.productId ?? "", name: l.name, description: l.description, quantity: l.quantity.toString().replace(".", ","), unit: l.unit, unitPrice: l.unitPrice.toString().replace(".", ","),
        discountType: l.discountType ?? "", discountValue: l.discountValue?.toString().replace(".", ",") ?? "", vatRate: l.vatRate, vatExemptionCode: l.vatExemptionCode ?? "", otvRate: l.otvRate?.toString().replace(".", ",") ?? "", otvCode: l.otvCode ?? "0074",
        withholdingRate: l.withholdingRate?.toString() ?? "", withholdingCode: l.withholdingCode ?? "",
      })),
    };
  } else {
    const valid = new Date(`${todayIso}T00:00:00Z`);
    valid.setUTCDate(valid.getUTCDate() + 15);
    values = { kind: "INVOICE", name: null, docNo: null, contactId: "", issueDate: todayIso, dueDate: todayIso, validUntil: valid.toISOString().slice(0, 10), currency: "TRY", exchangeRate: null, categoryId: null, notes: null, orderNo: null, orderDate: null, stockMode: "NONE", discountType: null, discountValue: null, tagIds: [], lines: [] };
  }
  return (
    <>
      <PageHeader title={id ? "Düzenle" : "Yeni teklif"} parent={{ href: id ? `${BASE}/${id}` : BASE, label: id ? values.name || "Teklif" : "Teklifler" }} />
      <Card>
        <DocumentForm mode="quote" values={values} {...data} cancelHref={id ? `${BASE}/${id}` : BASE} />
      </Card>
    </>
  );
}
