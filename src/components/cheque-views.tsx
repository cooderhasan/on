import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Calendar, FileText, Hash, Landmark, Pencil, User } from "lucide-react";
import Decimal from "decimal.js";
import type { ChequeDirection, ChequeStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { CHEQUE_STATUS_LABELS, getCheque, listCheques } from "@/server/services/cheques";
import { invoicePaid } from "@/server/services/ledger";
import { orNotFound, pageParam, strParam } from "@/server/page-helpers";
import { deleteChequeAction } from "@/app/actions/stock";
import { VOID_EDOC } from "@/lib/edoc-status";
import { chequeTxLabel } from "@/lib/cheque";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, Td, Th } from "./ui";
import { buildHref, InfoRow, ListFooter, ListToolbar } from "./list";
import { Money } from "./money";
import { ConfirmDelete } from "./money-forms";
import { ChequeActions, ChequeForm } from "./stock-forms";
import { fmtDate } from "./invoice-views";
import { cn } from "@/lib/cn";

type SP = Record<string, string | string[] | undefined>;

const STATUS_TONE: Record<ChequeStatus, string> = {
  PORTFOLIO: "bg-accent",
  PENDING: "bg-accent",
  COLLECTED: "bg-success",
  PAID: "bg-success",
  ENDORSED: "bg-teal",
  BOUNCED: "bg-danger",
};

function StatusBadge({ status }: { status: ChequeStatus }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase text-white", STATUS_TONE[status])}>{CHEQUE_STATUS_LABELS[status]}</span>;
}

/** Açık faturalar (kalan > 0) — çek formunda seçim için */
async function openInvoices(direction: "SALE" | "PURCHASE") {
  const invs = await db.invoice.findMany({
    where: { direction, kind: "INVOICE", eDocStatus: { notIn: [...VOID_EDOC] } },
    orderBy: { issueDate: "desc" },
    take: 500,
    select: { id: true, contactId: true, name: true, invoiceNo: true, issueDate: true, payableTotal: true },
  });
  const paid = await invoicePaid(invs.map((i) => i.id));
  return invs
    .map((i) => ({ id: i.id, contactId: i.contactId, label: [i.invoiceNo, i.name, fmtDate(i.issueDate)].filter(Boolean).join(" · "), remaining: new Decimal(i.payableTotal.toString()).minus(paid.get(i.id)!) }))
    .filter((i) => i.remaining.greaterThan(0))
    .map((i) => ({ ...i, remaining: i.remaining.toString() }));
}

export async function ChequeListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("cash.read");
  const sp = await searchParams;
  const q = strParam(sp.q);
  const dirRaw = strParam(sp.tur);
  const direction: ChequeDirection | undefined = dirRaw === "alinan" ? "RECEIVED" : dirRaw === "verilen" ? "ISSUED" : undefined;
  const statusRaw = strParam(sp.durum);
  const status = statusRaw === "open" || statusRaw === "overdue" || (statusRaw && statusRaw in CHEQUE_STATUS_LABELS) ? (statusRaw as ChequeStatus | "open" | "overdue") : undefined;
  const { rows, total, page, pages, openTotals } = await listCheques(user, { q, direction, status, page: pageParam(sp.sayfa) });
  const canWrite = can(user.role, "cash.write");
  const href = (p: number) => buildHref("/cekler", { q, tur: dirRaw, durum: statusRaw, sayfa: p > 1 ? p : undefined });
  const sel = "h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs";
  return (
    <>
      <PageHeader title="Çekler" />
      <ListToolbar
        action="/cekler"
        q={q}
        placeholder="Çek no, banka, cari, düzenleyen…"
        filters={
          <>
            <select name="tur" defaultValue={dirRaw ?? ""} aria-label="Tür" className={sel}>
              <option value="">Alınan ve verilen</option>
              <option value="alinan">Alınan çekler</option>
              <option value="verilen">Verilen çekler</option>
            </select>
            <select name="durum" defaultValue={statusRaw ?? ""} aria-label="Durum" className={sel}>
              <option value="">Tüm durumlar</option>
              <option value="open">Açık (portföyde / ödenecek)</option>
              <option value="overdue">Vadesi geçmiş</option>
              {(Object.keys(CHEQUE_STATUS_LABELS) as ChequeStatus[]).map((k) => <option key={k} value={k}>{CHEQUE_STATUS_LABELS[k]}</option>)}
            </select>
          </>
        }
        actions={
          canWrite ? (
            <>
              {can(user.role, "sales.write") && <LinkButton href="/cekler/yeni?tur=alinan">Alınan çek</LinkButton>}
              {can(user.role, "expenses.write") && <LinkButton href="/cekler/yeni?tur=verilen" variant="secondary">Verilen çek</LinkButton>}
            </>
          ) : undefined
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={q || direction || status ? "Filtreye uyan çek yok" : "Henüz çek yok"} description="Müşteriden alınan çek, fatura veya müşteri sayfasındaki “Çek ile tahsil et” ile de eklenebilir." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-border"><tr><Th>Düzenleyen / cari</Th><Th>Çek bilgileri</Th><Th>Vade tarihi</Th><Th>Durum</Th><Th className="text-right">Tutar</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-card-muted">
                    <Td>
                      <Link href={`/cekler/${c.id}`} className="font-medium uppercase text-text hover:text-accent">{c.drawer || c.contact.title}</Link>
                      <p className="text-xs text-text-3">{c.direction === "RECEIVED" ? "Alınan" : "Verilen"}{c.drawer ? ` · ${c.contact.title}` : ""}</p>
                    </Td>
                    <Td className="text-xs text-text-2"><span className="font-mono">{c.chequeNo}</span>{c.bankName && <><br />{[c.bankName, c.branch].filter(Boolean).join(" / ")}</>}</Td>
                    <Td className={cn("whitespace-nowrap", c.overdue && "text-danger")}>{fmtDate(c.dueDate)}</Td>
                    <Td>
                      <StatusBadge status={c.status} />
                      {c.status === "ENDORSED" && c.endorsedTo && <p className="mt-0.5 text-[11px] text-text-3">→ {c.endorsedTo.title}</p>}
                      {(c.status === "COLLECTED" || c.status === "PAID") && c.account && <p className="mt-0.5 text-[11px] text-text-3">{c.account.name}</p>}
                    </Td>
                    <Td className="text-right"><Money value={c.amount} currency={c.currency} className={c.overdue ? "text-danger" : undefined} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListFooter
          total={total}
          page={page}
          pages={pages}
          href={href}
          summary={openTotals.map((t) => (
            <span key={`${t.direction}${t.currency}`}>{t.direction === "RECEIVED" ? "Portföyde" : "Ödenecek"} <Money value={t.total} currency={t.currency} /></span>
          ))}
        />
      </Card>
    </>
  );
}

export async function ChequeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("cash.read");
  const c = await orNotFound(getCheque(user, (await params).id));
  const received = c.direction === "RECEIVED";
  const canWrite = can(user.role, "cash.write") && can(user.role, received ? "sales.write" : "expenses.write");
  const [accounts, suppliers, supplierInvoices] = canWrite
    ? await Promise.all([
        db.account.findMany({ where: { isArchived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, currency: true } }),
        received ? db.contact.findMany({ where: { kind: "SUPPLIER", isArchived: false }, orderBy: { title: "asc" }, select: { id: true, title: true, currency: true } }) : Promise.resolve([]),
        received && c.initial ? openInvoices("PURCHASE") : Promise.resolve([]),
      ])
    : [[], [], []];
  const contactBase = c.contact.kind === "CUSTOMER" ? "/musteriler" : "/tedarikciler";
  return (
    <>
      <PageHeader title={`Çek ${c.chequeNo}`} parent={{ href: "/cekler", label: "Çekler" }} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
            <h2 className="flex items-center gap-3 text-lg text-text"><FileText className="size-7 text-accent" /> {received ? "Alınan çek" : "Verilen çek"}</h2>
            <StatusBadge status={c.status} />
          </div>
          <dl className="py-3">
            <InfoRow label={received ? "Müşteri" : "Tedarikçi"} icon={<User />}><Link href={`${contactBase}/${c.contact.id}`} className="hover:text-accent">{c.contact.title}</Link></InfoRow>
            {received && <InfoRow label="Düzenleyen" icon={<User />}>{c.drawer}</InfoRow>}
            <InfoRow label="Çek no" icon={<Hash />}><span className="font-mono">{c.chequeNo}</span></InfoRow>
            <InfoRow label="Banka / şube" icon={<Landmark />}>{[c.bankName, c.branch].filter(Boolean).join(" / ") || null}</InfoRow>
            <InfoRow label="Düzenleme tarihi" icon={<Calendar />}>{fmtDate(c.issueDate)}</InfoRow>
            <InfoRow label="Vade tarihi" icon={<Calendar />}>
              <span className={c.overdue ? "text-danger" : undefined}>{fmtDate(c.dueDate)}{c.overdue && <AlertTriangle className="ml-1 inline size-3.5" />}</span>
            </InfoRow>
            <InfoRow label="Fatura" icon={<FileText />}>
              {c.invoice && <Link href={`${c.invoice.direction === "SALE" ? "/satislar" : "/giderler"}/${c.invoice.id}`} className="text-accent hover:underline">{c.invoice.invoiceNo || c.invoice.name || "Fatura"}</Link>}
            </InfoRow>
            <InfoRow label="Not" icon={<Pencil />}>{c.notes}</InfoRow>
          </dl>
          <CardHeader title="Hareketler" className="border-t border-border" />
          <ul className="divide-y divide-border">
            {c.transactions.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-2 px-4 py-2.5 text-sm">
                <div>
                  <p>{chequeTxLabel(t, c)}</p>
                  <p className="text-xs text-text-3">
                    {fmtDate(t.date)}
                    {t.account && <> · <Link href={`/kasa-ve-bankalar/${t.account.id}`} className="hover:underline">{t.account.name}</Link></>}
                    {t.contact && <> · <Link href={`${t.contact.kind === "CUSTOMER" ? "/musteriler" : "/tedarikciler"}/${t.contact.id}`} className="hover:underline">{t.contact.title}</Link></>}
                    {t.invoice && <> · <Link href={`${t.invoice.direction === "SALE" ? "/satislar" : "/giderler"}/${t.invoice.id}`} className="hover:underline">{t.invoice.invoiceNo || t.invoice.name || "Fatura"}</Link></>}
                  </p>
                </div>
                <Money value={t.amount} currency={c.currency} />
              </li>
            ))}
          </ul>
        </Card>
        <aside className="flex flex-col gap-4">
          <Card>
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-2">Tutar</span>
              <Money value={c.amount} currency={c.currency} className="text-xl" />
            </div>
            {canWrite ? (
              <div className="border-t border-border px-4 py-4">
                <ChequeActions
                  id={c.id}
                  direction={c.direction}
                  status={c.status}
                  currency={c.currency}
                  accounts={accounts}
                  suppliers={suppliers.map((s) => ({ id: s.id, name: s.title, currency: s.currency }))}
                  supplierInvoices={supplierInvoices}
                />
              </div>
            ) : null}
          </Card>
          {canWrite && c.initial && <ConfirmDelete action={deleteChequeAction} id={c.id} label="Çeki sil" confirmText="Çek ve cari hareketi silinsin mi?" />}
        </aside>
      </div>
    </>
  );
}

export async function ChequeFormPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const invoiceId = strParam(sp.fatura);
  const contactParam = strParam(sp.cari);
  // Fatura / cari verildiyse yön ondan; yoksa ?tur=alinan|verilen
  let direction: ChequeDirection = strParam(sp.tur) === "verilen" ? "ISSUED" : "RECEIVED";
  let preset = { contactId: "", invoiceId: null as string | null, amount: "" };
  if (invoiceId) {
    const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, direction: true, contactId: true } });
    if (!inv) notFound();
    direction = inv.direction === "SALE" ? "RECEIVED" : "ISSUED";
    preset = { contactId: inv.contactId, invoiceId: inv.id, amount: "" };
  } else if (contactParam) {
    const c = await db.contact.findUnique({ where: { id: contactParam }, select: { id: true, kind: true } });
    if (!c) notFound();
    direction = c.kind === "CUSTOMER" ? "RECEIVED" : "ISSUED";
    preset = { contactId: c.id, invoiceId: null, amount: "" };
  }
  const received = direction === "RECEIVED";
  await requireUser(received ? "sales.write" : "expenses.write");
  await requireUser("cash.write");
  const [contacts, invoices] = await Promise.all([
    db.contact.findMany({ where: { kind: received ? "CUSTOMER" : "SUPPLIER", isArchived: false }, orderBy: { title: "asc" }, select: { id: true, title: true, currency: true } }),
    openInvoices(received ? "SALE" : "PURCHASE"),
  ]);
  if (preset.invoiceId) preset.amount = invoices.find((i) => i.id === preset.invoiceId)?.remaining ?? "";
  const cancelHref = preset.invoiceId ? `${received ? "/satislar" : "/giderler"}/${preset.invoiceId}` : "/cekler";
  return (
    <>
      <PageHeader title={received ? "Alınan çek" : "Verilen çek"} parent={{ href: "/cekler", label: "Çekler" }} />
      <Card>
        <ChequeForm direction={direction} contacts={contacts.map((c) => ({ id: c.id, name: c.title, currency: c.currency }))} invoices={invoices} preset={preset} cancelHref={cancelHref} />
      </Card>
    </>
  );
}
