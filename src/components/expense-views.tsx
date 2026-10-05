import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Archive, ArchiveRestore, CircleCheck, FileText, Landmark, Mail, Phone, Plus, User, Hash, Calendar } from "lucide-react";
import type { ExpenseKind, IncomingStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { EXPENSE_KIND_LABELS, getExpense, listExpenseRows } from "@/server/services/expenses";
import { getEmployee, listEmployees } from "@/server/services/employees";
import { INCOMING_STATUS_LABELS, listIncoming } from "@/server/services/incoming";
import { listCategories } from "@/server/services/categories";
import { orNotFound, pageParam, strParam } from "@/server/page-helpers";
import { archiveEmployeeAction, deleteExpenseAction } from "@/app/actions/expenses";
import { Alert, Button, Card, CardHeader, EmptyState, LinkButton, PageHeader, Td, Th } from "./ui";
import { buildHref, CategoryBadge, InfoRow, ListFooter, ListToolbar } from "./list";
import { Money } from "./money";
import { ConfirmDelete, DeleteTransactionButton, SettlementForm } from "./money-forms";
import { EmployeeForm, ExpenseForm, IncomingActions, SyncIncomingButton, type EmployeeFormValues, type ExpenseFormValues } from "./expense-forms";
import { fmtDate } from "./invoice-views";
import { formatIban } from "@/lib/iban";
import { cn } from "@/lib/cn";

type SP = Record<string, string | string[] | undefined>;
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
const accountsFor = () => db.account.findMany({ where: { isArchived: false }, select: { id: true, name: true, currency: true }, orderBy: { name: "asc" } });
const NEW_LINKS: Array<[string, string]> = [
  ["/giderler/kayit/yeni?tur=fis", "Hızlı fiş / fatura"],
  ["/giderler/kayit/yeni?tur=maas", "Yeni maaş / prim"],
  ["/giderler/kayit/yeni?tur=vergi", "Yeni vergi / SGK primi"],
  ["/giderler/kayit/yeni?tur=banka", "Yeni banka gideri"],
];
const KIND_FROM_PARAM: Record<string, ExpenseKind> = { fis: "RECEIPT", maas: "SALARY", vergi: "TAX", banka: "BANK_FEE" };

// ── Gider listesi ──────────────────────────────────────────

export async function ExpenseListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("expenses.read");
  const sp = await searchParams;
  const q = strParam(sp.q);
  const payment = strParam(sp.durum) as "open" | "overdue" | "paid" | undefined;
  const kind = strParam(sp.tur) as "INVOICE" | ExpenseKind | undefined;
  const { rows, total, page, pages, totals } = await listExpenseRows(user, { q, payment, kind, page: pageParam(sp.sayfa) });
  const canWrite = can(user.role, "expenses.write");
  return (
    <>
      <PageHeader title="Gider Listesi" />
      <ListToolbar
        action="/giderler"
        q={q}
        placeholder="Açıklama, fiş no, tedarikçi, çalışan…"
        filters={
          <>
            <select name="tur" defaultValue={kind ?? ""} aria-label="Tür" className="h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs">
              <option value="">Tüm kayıtlar</option>
              <option value="INVOICE">Alış faturaları</option>
              {(Object.keys(EXPENSE_KIND_LABELS) as ExpenseKind[]).map((k) => <option key={k} value={k}>{EXPENSE_KIND_LABELS[k]}</option>)}
            </select>
            <select name="durum" defaultValue={payment ?? ""} aria-label="Ödeme durumu" className="h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs">
              <option value="">Tümü</option>
              <option value="open">Ödenecek</option>
              <option value="overdue">Vadesi geçmiş</option>
              <option value="paid">Ödendi</option>
            </select>
          </>
        }
        actions={
          canWrite ? (
            <>
              <LinkButton href="/giderler/yeni">Detaylı fiş / fatura</LinkButton>
              <details className="relative">
                <summary className="flex h-9 cursor-pointer list-none items-center gap-1 rounded bg-primary px-4 text-xs font-semibold uppercase tracking-wide text-white hover:bg-primary-hover"><Plus className="size-3.5" /> Diğer</summary>
                <ul className="absolute right-0 z-10 mt-1 w-56 rounded border border-border bg-white py-1 text-sm shadow-lg">
                  {NEW_LINKS.map(([href, label]) => <li key={href}><Link href={href} className="block px-3 py-2 hover:bg-card-muted">{label}</Link></li>)}
                </ul>
              </details>
            </>
          ) : undefined
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={q || payment || kind ? "Filtreye uyan kayıt yok" : "Henüz gider kaydı yok"} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border"><tr><Th>Kayıt ismi</Th><Th>Düzenlenme tarihi</Th><Th>Ödeme tarihi</Th><Th className="text-right">Kalan meblağ</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.href} className="hover:bg-card-muted">
                    <Td>
                      <Link href={r.href} className="font-medium text-text hover:text-accent">{r.title}</Link>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-text-3">
                        <span>{r.kindLabel}</span>
                        {r.party && <span className="uppercase">· {r.party}</span>}
                        {r.category && <CategoryBadge category={r.category} />}
                      </p>
                    </Td>
                    <Td>{fmtDate(r.date)}</Td>
                    <Td className={r.overdue ? "text-danger" : undefined}>
                      {r.remaining.greaterThan(0) ? fmtDate(r.dueDate) : <span className="flex items-center gap-1 text-success"><CircleCheck className="size-4" /> Ödendi</span>}
                    </Td>
                    <Td className="text-right">
                      <Money value={r.remaining} currency={r.currency} className={r.overdue ? "text-danger" : undefined} />
                      <p className="text-[11px] text-text-3">Toplam <Money value={r.total} currency={r.currency} /></p>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListFooter total={total} page={page} pages={pages} href={(p) => buildHref("/giderler", { q, durum: payment, tur: kind, sayfa: p > 1 ? p : undefined })} summary={<><span>Toplam <Money value={totals.total} /></span><span>Ödenecek <Money value={totals.remaining} /></span></>} />
      </Card>
    </>
  );
}

// ── Fatura dışı gider: detay ve form ───────────────────────

export async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("expenses.read");
  const e = await orNotFound(getExpense(user, (await params).id));
  const canWrite = can(user.role, "expenses.write") && can(user.role, "cash.write");
  const accounts = canWrite ? await accountsFor() : [];
  return (
    <>
      <PageHeader title={e.description} parent={{ href: "/giderler", label: "Gider Listesi" }} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
            <h2 className="flex items-center gap-3 text-lg text-text"><FileText className="size-7 text-[#8a6d5a]" /> {e.description}</h2>
            <div className="flex items-center gap-2">
              <CategoryBadge category={e.category} />
              {can(user.role, "expenses.write") && <LinkButton href={`/giderler/kayit/${e.id}/duzenle`} variant="secondary">Düzenle</LinkButton>}
            </div>
          </div>
          <dl className="py-3">
            <InfoRow label="Tür" icon={<FileText />}>{EXPENSE_KIND_LABELS[e.kind]}</InfoRow>
            {e.contact && <InfoRow label="Tedarikçi" icon={<User />}><Link href={`/tedarikciler/${e.contact.id}`} className="text-accent hover:underline">{e.contact.title}</Link></InfoRow>}
            {e.employee && <InfoRow label="Çalışan" icon={<User />}><Link href={`/calisanlar/${e.employee.id}`} className="text-accent hover:underline">{e.employee.name}</Link></InfoRow>}
            {e.receiptNo && <InfoRow label="Fiş / fatura no" icon={<Hash />}>{e.receiptNo}</InfoRow>}
            <InfoRow label="Düzenleme tarihi" icon={<Calendar />}>{fmtDate(e.date)}</InfoRow>
            <InfoRow label="Ödeme tarihi" icon={<Calendar />}>{fmtDate(e.dueDate)}</InfoRow>
            {e.kind === "RECEIPT" && <InfoRow label="Matrah / KDV" icon={<FileText />}><Money value={e.netAmount} /> · KDV %{e.vatRate} <Money value={e.vatAmount} /></InfoRow>}
            <InfoRow label="Toplam" icon={<FileText />}><Money value={e.totalAmount} className="text-[#8a6d5a]" /></InfoRow>
          </dl>
        </Card>
        <aside className="flex flex-col gap-4">
          <Card>
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-2">Kalan</span>
              <Money value={e.remaining} className={cn("text-xl", e.overdue && "text-danger")} />
            </div>
            {e.overdue && <p className="flex items-center gap-1.5 px-4 pb-3 text-xs text-danger"><AlertTriangle className="size-3.5" /> Ödeme tarihi geçti</p>}
            {canWrite && e.remaining.greaterThan(0) && (
              <div className="border-t border-border px-4 py-4">
                <p className="mb-2 text-[11px] font-semibold uppercase text-text-2">Ödeme ekle</p>
                <SettlementForm expenseId={e.id} accounts={accounts} docCurrency={e.currency} defaultAmount={e.remaining.toString()} label="Ödeme ekle" />
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Ödemeler" />
            {e.transactions.length === 0 ? (
              <p className="px-4 py-4 text-sm text-text-3">Henüz ödeme yok.</p>
            ) : (
              <ul className="divide-y divide-border">
                {e.transactions.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-2 px-4 py-2.5 text-sm">
                    <div>
                      <Money value={t.appliedAmount} />
                      <p className="text-xs text-text-3">{fmtDate(t.date)} · <Link href={`/kasa-ve-bankalar/${t.account.id}`} className="hover:underline">{t.account.name}</Link></p>
                    </div>
                    {canWrite && <DeleteTransactionButton id={t.id} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {can(user.role, "expenses.write") && e.transactions.length === 0 && <ConfirmDelete action={deleteExpenseAction} id={e.id} label="Gideri sil" confirmText="Gider kaydı silinsin mi?" />}
        </aside>
      </div>
    </>
  );
}

export async function ExpenseFormPage({ params, searchParams }: { params?: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const user = await requireUser("expenses.write");
  const id = params ? (await params).id : null;
  const [categories, suppliers, employees] = await Promise.all([
    listCategories("EXPENSE"),
    db.contact.findMany({ where: { kind: "SUPPLIER", isArchived: false }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    db.employee.findMany({ where: { isArchived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  let values: ExpenseFormValues;
  if (id) {
    const e = await orNotFound(getExpense(user, id));
    values = { id: e.id, kind: e.kind, description: e.description, date: e.date.toISOString().slice(0, 10), dueDate: e.dueDate.toISOString().slice(0, 10), categoryId: e.categoryId, contactId: e.contactId, employeeId: e.employeeId, totalAmount: e.totalAmount.toString().replace(".", ","), vatRate: e.vatRate, receiptNo: e.receiptNo };
  } else {
    const kind = KIND_FROM_PARAM[strParam((await searchParams)?.tur) ?? ""];
    if (!kind) notFound();
    const sp = (await searchParams) ?? {};
    values = { kind, description: "", date: todayIso(), dueDate: todayIso(), categoryId: null, contactId: strParam(sp.tedarikci) ?? null, employeeId: strParam(sp.calisan) ?? null, totalAmount: "", vatRate: kind === "RECEIPT" ? 20 : 0, receiptNo: null };
  }
  return (
    <>
      <PageHeader title={id ? "Düzenle" : EXPENSE_KIND_LABELS[values.kind]} parent={{ href: id ? `/giderler/kayit/${id}` : "/giderler", label: id ? values.description : "Gider Listesi" }} />
      <Card>
        <ExpenseForm values={values} categories={categories.map((c) => ({ id: c.id, name: c.name }))} suppliers={suppliers.map((s) => ({ id: s.id, name: s.title }))} employees={employees} cancelHref={id ? `/giderler/kayit/${id}` : "/giderler"} />
      </Card>
    </>
  );
}

// ── Gelen e-faturalar ──────────────────────────────────────

const ANSWER_LABEL: Record<string, string> = { Waiting: "Yanıt bekliyor", Accepted: "Kabul edildi", Rejected: "Reddedildi", None: "" };

export async function IncomingListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("expenses.read");
  const sp = await searchParams;
  const q = strParam(sp.q);
  const statusRaw = strParam(sp.durum);
  const status = statusRaw && statusRaw in INCOMING_STATUS_LABELS ? (statusRaw as IncomingStatus) : undefined;
  const [{ rows, total, page, pages, lastSync }, categories, settings] = await Promise.all([
    listIncoming(user, { q, status, page: pageParam(sp.sayfa) }),
    listCategories("EXPENSE"),
    db.eInvoiceSettings.findUnique({ where: { id: "nes" }, select: { apiKeyEnc: true } }),
  ]);
  const canWrite = can(user.role, "expenses.write");
  return (
    <>
      <PageHeader title="Gelen e-Faturalar" actions={canWrite && settings?.apiKeyEnc ? <SyncIncomingButton /> : undefined} />
      {!settings?.apiKeyEnc && <Alert tone="info" className="mb-3">Gelen faturaları içeri almak için önce <Link href="/e-fatura-ayarlari" className="text-accent underline">e-Fatura Ayarları</Link>&apos;ndan NES API anahtarını girin.</Alert>}
      <ListToolbar
        action="/gelen-e-faturalar"
        q={q}
        placeholder="Gönderen, VKN, fatura no…"
        filters={
          <select name="durum" defaultValue={status ?? ""} aria-label="Durum" className="h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs">
            <option value="">Tümü</option>
            {(Object.keys(INCOMING_STATUS_LABELS) as IncomingStatus[]).map((s) => <option key={s} value={s}>{INCOMING_STATUS_LABELS[s]}</option>)}
          </select>
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={q || status ? "Filtreye uyan fatura yok" : "Henüz gelen fatura yok"} description={settings?.apiKeyEnc ? "\"Faturaları içeri al\" ile NES'teki gelen e-faturaları çekin." : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-border"><tr><Th>Gönderen unvan</Th><Th>Fatura no</Th><Th>Fatura tarihi</Th><Th className="text-right">Fatura tutarı</Th><Th className="w-72 text-right">İşlem</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-card-muted">
                    <Td>
                      <a href={`/api/einvoice/incoming/${r.id}/html`} target="_blank" rel="noopener" className="font-medium text-text hover:text-accent">{r.senderTitle}</a>
                      <p className="text-xs text-text-3">{r.senderTaxNumber}</p>
                    </Td>
                    <Td>
                      <p className="font-mono text-xs">{r.documentNumber}</p>
                      <p className="text-[11px] text-text-3">{r.profile === "TICARIFATURA" ? "Ticari" : r.profile === "TEMELFATURA" ? "Temel" : r.profile} e-Fatura · {r.typeCode === "IADE" ? "İade" : "Satış"}</p>
                    </Td>
                    <Td>
                      <p>{fmtDate(r.issueDate)}</p>
                      <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] font-semibold uppercase">
                        <span className={cn("rounded-full px-1.5 py-0.5 text-white", r.status === "PROCESSED" ? "bg-success" : r.status === "IGNORED" ? "bg-text-3" : "bg-warning")}>{INCOMING_STATUS_LABELS[r.status]}</span>
                        {r.profile === "TICARIFATURA" && r.answer && ANSWER_LABEL[r.answer] && <span className={cn("rounded-full px-1.5 py-0.5 text-white", r.answer === "Rejected" ? "bg-danger" : r.answer === "Accepted" ? "bg-success" : "bg-accent")}>{ANSWER_LABEL[r.answer]}</span>}
                      </div>
                    </Td>
                    <Td className="text-right"><Money value={r.payableAmount} currency={r.currency} /></Td>
                    <Td className="text-right">
                      {r.status === "PROCESSED" && r.purchaseInvoiceId ? (
                        <Link href={`/giderler/${r.purchaseInvoiceId}`} className="text-xs text-accent hover:underline">Alış faturasını aç</Link>
                      ) : (
                        canWrite && <IncomingActions id={r.id} status={r.status} canAnswer={r.profile === "TICARIFATURA" && (r.answer === "Waiting" || r.answer === "None" || !r.answer)} categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListFooter total={total} page={page} pages={pages} href={(p) => buildHref("/gelen-e-faturalar", { q, durum: status, sayfa: p > 1 ? p : undefined })} summary={lastSync ? <span>Son alma: {lastSync.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</span> : undefined} />
      </Card>
    </>
  );
}

// ── Çalışanlar ─────────────────────────────────────────────

export async function EmployeeListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("expenses.read");
  const sp = await searchParams;
  const q = strParam(sp.q);
  const archived = strParam(sp.arsiv) === "1";
  const rows = await listEmployees(user, { q, archived });
  const canWrite = can(user.role, "expenses.write");
  return (
    <>
      <PageHeader title={archived ? "Çalışanlar · Arşiv" : "Çalışanlar"} />
      <ListToolbar action="/calisanlar" q={q} placeholder="Ad soyad…" hidden={{ arsiv: archived ? "1" : undefined }} actions={canWrite ? <LinkButton href="/calisanlar/yeni">Yeni çalışan ekle</LinkButton> : undefined} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={archived ? "Arşivde çalışan yok" : "Henüz çalışan eklenmedi"} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="border-b border-border"><tr><Th className="w-10" /><Th>Ad soyad</Th><Th className="text-right">Bakiye</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((e) => (
                  <tr key={e.id} className="hover:bg-card-muted">
                    <Td><span className="grid size-8 place-items-center rounded-sm bg-[#d9d9d9] text-white"><User className="size-4" /></span></Td>
                    <Td>
                      <Link href={`/calisanlar/${e.id}`} className="font-medium uppercase text-text hover:text-accent">{e.name}</Link>
                      {e.category && <div className="mt-0.5"><CategoryBadge category={e.category} /></div>}
                    </Td>
                    <Td className="text-right">{e.balance.isZero() ? <span className="text-text-3">—</span> : <><Money value={e.balance.abs()} className={e.balance.isNegative() ? "text-[#8a6d5a]" : "text-teal"} /><p className="text-[11px] text-text-3">{e.balance.isNegative() ? "Ödenecek" : "Avans (alacak)"}</p></>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-between border-t border-border px-4 py-2.5 text-xs text-text-2">
          <Link href={buildHref("/calisanlar", { arsiv: archived ? undefined : "1" })} className="text-accent hover:underline">{archived ? "Aktif çalışanlar" : "Arşiv"}</Link>
          <span>{rows.length} kayıt</span>
        </div>
      </Card>
    </>
  );
}

export async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("expenses.read");
  const e = await orNotFound(getEmployee(user, (await params).id));
  const canWrite = can(user.role, "expenses.write");
  const canPay = canWrite && can(user.role, "cash.write");
  const accounts = canPay ? await accountsFor() : [];
  return (
    <>
      <PageHeader title={e.name} parent={{ href: "/calisanlar", label: "Çalışanlar" }} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
            <h2 className="flex items-center gap-3 text-lg uppercase text-text"><User className="size-7 text-text-3" /> {e.name}</h2>
            <div className="flex items-center gap-2">
              <CategoryBadge category={e.category} />
              {canWrite && <LinkButton href={`/calisanlar/${e.id}/duzenle`} variant="secondary">Düzenle</LinkButton>}
            </div>
          </div>
          <dl className="py-3">
            <InfoRow label="T.C. kimlik no" icon={<Hash />}>{e.tckn && <span className="font-mono">{e.tckn}</span>}</InfoRow>
            <InfoRow label="E-posta" icon={<Mail />}>{e.email}</InfoRow>
            <InfoRow label="Telefon" icon={<Phone />}>{e.phone}</InfoRow>
            <InfoRow label="IBAN" icon={<Landmark />}>{e.iban && <span className="font-mono text-xs">{formatIban(e.iban)}</span>}</InfoRow>
            <InfoRow label="İşe başlama" icon={<Calendar />}>{e.startDate ? fmtDate(e.startDate) : null}</InfoRow>
          </dl>
        </Card>
        <aside className="flex flex-col gap-4 xl:row-span-2">
          <Card>
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-2">Bakiye</span>
              {e.balance.isZero() ? <span className="text-text-3">0,00₺</span> : <div className="text-right"><Money value={e.balance.abs()} className={cn("text-lg", e.balance.isNegative() ? "text-[#8a6d5a]" : "text-teal")} /><p className="text-[11px] text-text-3">{e.balance.isNegative() ? "Ödenecek" : "Avans (alacak)"}</p></div>}
            </div>
            {canWrite && <div className="border-t border-border px-4 py-3"><LinkButton href={`/giderler/kayit/yeni?tur=maas&calisan=${e.id}`} variant="secondary">Maaş / prim tahakkuku</LinkButton></div>}
            {canPay && (
              <div className="border-t border-border px-4 py-4">
                <p className="mb-2 text-[11px] font-semibold uppercase text-text-2">Ödeme / avans</p>
                <SettlementForm employeeId={e.id} accounts={accounts} docCurrency="TRY" label="Ödeme ekle" />
                <p className="mt-2 text-[11px] text-text-3">Belirli bir maaş kaydını kapatmak için o kaydın sayfasından ödeyin.</p>
              </div>
            )}
          </Card>
          {canWrite && (
            <form action={archiveEmployeeAction}>
              <input type="hidden" name="id" value={e.id} />
              <input type="hidden" name="archived" value={e.isArchived ? "0" : "1"} />
              <Button type="submit" variant="ghost" size="sm">{e.isArchived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}{e.isArchived ? "Arşivden çıkar" : "Arşivle"}</Button>
            </form>
          )}
        </aside>
        <Card className="xl:col-start-1">
          <CardHeader title="Hareketler" />
          {e.movements.length === 0 ? (
            <p className="px-4 py-4 text-sm text-text-3">Henüz hareket yok.</p>
          ) : (
            <ul className="divide-y divide-border">
              {e.movements.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="mr-2 rounded-sm bg-card-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text-2">{m.kind}</span>
                    {m.href ? <Link href={m.href} className="hover:text-accent">{m.label}</Link> : m.label}
                    <p className="text-xs text-text-3">{fmtDate(m.date)}</p>
                  </div>
                  <Money value={m.amount.abs()} className={m.amount.isNegative() ? "text-[#8a6d5a]" : "text-success"} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export async function EmployeeFormPage({ params }: { params?: Promise<{ id: string }> }) {
  const user = await requireUser("expenses.write");
  const id = params ? (await params).id : null;
  const categories = (await listCategories("EMPLOYEE")).map((c) => ({ id: c.id, name: c.name }));
  let values: EmployeeFormValues = { name: "", tckn: null, email: null, phone: null, iban: null, categoryId: null, startDate: null, notes: null };
  if (id) {
    const e = await orNotFound(getEmployee(user, id));
    values = { id: e.id, name: e.name, tckn: e.tckn, email: e.email, phone: e.phone, iban: e.iban ? formatIban(e.iban) : null, categoryId: e.categoryId, startDate: e.startDate?.toISOString().slice(0, 10) ?? null, notes: e.notes };
  }
  return (
    <>
      <PageHeader title={id ? "Düzenle" : "Yeni çalışan"} parent={{ href: id ? `/calisanlar/${id}` : "/calisanlar", label: id ? values.name : "Çalışanlar" }} />
      <Card>
        <EmployeeForm values={values} categories={categories} cancelHref={id ? `/calisanlar/${id}` : "/calisanlar"} />
      </Card>
    </>
  );
}
