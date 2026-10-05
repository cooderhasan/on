import Link from "next/link";
import { Archive, ArchiveRestore, Banknote, CalendarDays, Coins, Hash, Landmark } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getAccount, listAccounts } from "@/server/services/accounts";
import { orNotFound, strParam } from "@/server/page-helpers";
import { archiveAccountAction } from "@/app/actions/records";
import { Button, Card, CardHeader, EmptyState, LinkButton, PageHeader, Td, Th } from "./ui";
import { buildHref, InfoRow } from "./list";
import { Money } from "./money";
import { AccountForm, type AccountFormValues } from "./account-form";
import { formatIban } from "@/lib/iban";
import { db } from "@/server/db";
import { accountMovements } from "@/server/services/transactions";
import { CashForms, DeleteTransactionButton } from "./money-forms";

const MOVE_LABEL = { COLLECTION: "Tahsilat", PAYMENT: "Ödeme", TRANSFER: "Virman", DEPOSIT: "Para girişi", WITHDRAWAL: "Para çıkışı" } as const;

type SP = Record<string, string | string[] | undefined>;
const BASE = "/kasa-ve-bankalar";

export async function AccountListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("cash.read");
  const sp = await searchParams;
  const archived = strParam(sp.arsiv) === "1";
  const { rows, totals } = await listAccounts(user, { archived });
  const canEdit = can(user.role, "cash.write");

  return (
    <>
      <PageHeader
        title={archived ? "Kasa ve Bankalar · Arşiv" : "Kasa ve Bankalar"}
        actions={
          canEdit ? (
            <>
              <LinkButton href={`${BASE}/yeni?tur=kasa`}>Kasa ekle</LinkButton>
              <LinkButton href={`${BASE}/yeni?tur=banka`}>Banka ekle</LinkButton>
            </>
          ) : undefined
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={archived ? "Arşivde hesap yok" : "Henüz kasa veya banka hesabı yok"} description={archived ? undefined : "Tahsilat ve ödemeleri kaydetmek için en az bir kasa veya banka hesabı ekleyin."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-border">
                <tr><Th className="w-10" /><Th>Hesap ismi</Th><Th className="hidden md:table-cell">IBAN</Th><Th>Döviz cinsi</Th><Th className="text-right">Bakiye</Th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-card-muted">
                    <Td><span className="grid size-8 place-items-center rounded-sm bg-[#d9d9d9] text-white">{a.type === "BANK" ? <Landmark className="size-4" /> : <Banknote className="size-4" />}</span></Td>
                    <Td>
                      <Link href={`${BASE}/${a.id}`} className="font-medium text-text hover:text-accent">{a.name}</Link>
                      {a.bankName && <p className="text-xs text-text-3">{a.bankName}{a.branch ? ` · ${a.branch}` : ""}</p>}
                    </Td>
                    <Td className="hidden font-mono text-xs text-text-2 md:table-cell">{a.iban ? formatIban(a.iban) : ""}</Td>
                    <Td className="text-text-2">{a.currency === "TRY" ? "TRL" : a.currency}</Td>
                    <Td className="text-right"><Money value={a.balance} currency={a.currency} className={a.balance.isNegative() ? "text-danger" : undefined} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-text-2">
          <Link href={buildHref(BASE, { arsiv: archived ? undefined : "1" })} className="text-accent hover:underline">{archived ? "Aktif hesaplar" : "Arşiv"}</Link>
          <div className="flex flex-wrap gap-4">
            <span>{rows.length} kayıt</span>
            {totals.map((t) => <span key={t.currency}>Net <Money value={t.total} currency={t.currency} /></span>)}
          </div>
        </div>
      </Card>
    </>
  );
}

export async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("cash.read");
  const a = await orNotFound(getAccount(user, (await params).id));
  const canEdit = can(user.role, "cash.write");
  const [moves, allAccounts] = await Promise.all([accountMovements(user, a.id), canEdit ? db.account.findMany({ where: { isArchived: false }, select: { id: true, name: true, currency: true }, orderBy: { name: "asc" } }) : Promise.resolve([])]);
  return (
    <>
      <PageHeader title={a.name} parent={{ href: BASE, label: "Kasa ve Bankalar" }} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
            <h2 className="flex items-center gap-3 text-lg text-text">{a.type === "BANK" ? <Landmark className="size-7 text-text-3" /> : <Banknote className="size-7 text-text-3" />} {a.name}</h2>
            <div className="flex items-center gap-2">
              {a.isArchived && <span className="rounded-sm bg-warning px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Arşivde</span>}
              {canEdit && <LinkButton href={`${BASE}/${a.id}/duzenle`} variant="secondary">Düzenle</LinkButton>}
            </div>
          </div>
          <dl className="py-3">
            <InfoRow label="Türü" icon={<Banknote />}>{a.type === "BANK" ? "Banka hesabı" : "Kasa"}</InfoRow>
            <InfoRow label="Döviz cinsi" icon={<Coins />}>{a.currency}</InfoRow>
            {a.type === "BANK" && (
              <>
                <InfoRow label="Banka / şube" icon={<Landmark />}>{[a.bankName, a.branch].filter(Boolean).join(" · ")}</InfoRow>
                <InfoRow label="Hesap no" icon={<Hash />}>{a.accountNo}</InfoRow>
                <InfoRow label="IBAN" icon={<Hash />}>{a.iban && <span className="font-mono">{formatIban(a.iban)}</span>}</InfoRow>
              </>
            )}
            <InfoRow label="Açılış" icon={<CalendarDays />}>
              <Money value={a.openingBalance.toString()} currency={a.currency} />
              {a.openingDate && <span className="ml-2 text-xs text-text-3">{a.openingDate.toLocaleDateString("tr-TR", { timeZone: "UTC" })}</span>}
            </InfoRow>
          </dl>
        </Card>
        <Card className="xl:col-start-1">
          <CardHeader title="Hesap hareketleri" />
          {moves.length === 0 ? (
            <p className="px-4 py-4 text-sm text-text-3">Henüz hareket yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-border"><tr><Th>Tarih</Th><Th>İşlem</Th><Th className="text-right">Giriş</Th><Th className="text-right">Çıkış</Th><Th className="text-right">Bakiye</Th><Th className="w-10" /></tr></thead>
                <tbody className="divide-y divide-border">
                  {moves.map((m) => (
                    <tr key={m.id}>
                      <Td className="whitespace-nowrap text-text-2">{m.date.toLocaleDateString("tr-TR", { timeZone: "UTC" })}</Td>
                      <Td>
                        <span className="mr-2 rounded-sm bg-card-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text-2">{MOVE_LABEL[m.type]}</span>
                        {m.type === "TRANSFER" ? (m.incoming ? `${m.account?.name} hesabından` : `${m.targetAccount?.name} hesabına`) : m.contact ? <Link href={`${m.contact.kind === "CUSTOMER" ? "/musteriler" : "/tedarikciler"}/${m.contact.id}`} className="hover:text-accent">{m.contact.title}</Link> : m.employee ? <Link href={`/calisanlar/${m.employee.id}`} className="hover:text-accent">{m.employee.name}</Link> : null}
                        {m.invoice && <> · <Link href={`${m.invoice.direction === "SALE" ? "/satislar" : "/giderler"}/${m.invoice.id}`} className="text-accent hover:underline">{m.invoice.name || m.invoice.invoiceNo || "Fatura"}</Link></>}
                        {m.cheque && <> · <Link href={`/cekler/${m.cheque.id}`} className="text-accent hover:underline">Çek {m.cheque.chequeNo} ({m.cheque.contact.title})</Link></>}
                        {m.expense && <> · <Link href={`/giderler/kayit/${m.expense.id}`} className="text-accent hover:underline">{m.expense.description}</Link></>}
                        {m.description && <span className="block text-xs text-text-3">{m.description}</span>}
                      </Td>
                      <Td className="text-right">{m.incoming ? <Money value={m.value} currency={a.currency} className="text-success" /> : ""}</Td>
                      <Td className="text-right">{!m.incoming ? <Money value={m.value} currency={a.currency} className="text-danger" /> : ""}</Td>
                      <Td className="text-right"><Money value={m.balance} currency={a.currency} /></Td>
                      <Td>{canEdit && !m.chequeId && <DeleteTransactionButton id={m.id} />}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <aside className="flex flex-col gap-4 xl:col-start-2 xl:row-span-2 xl:row-start-1">
          <Card>
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-2">Bakiye</span>
              <Money value={a.balance} currency={a.currency} className={a.balance.isNegative() ? "text-lg text-danger" : "text-lg"} />
            </div>
          </Card>
          {canEdit && !a.isArchived && (
            <Card className="p-4">
              <CashForms account={{ id: a.id, name: a.name, currency: a.currency }} accounts={allAccounts} />
            </Card>
          )}
          {canEdit && (
            <form action={archiveAccountAction}>
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="archived" value={a.isArchived ? "0" : "1"} />
              <Button type="submit" variant="ghost" size="sm">
                {a.isArchived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                {a.isArchived ? "Arşivden çıkar" : "Arşivle"}
              </Button>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}

export async function AccountFormPage({ params, searchParams }: { params?: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const user = await requireUser("cash.write");
  const id = params ? (await params).id : null;
  let values: AccountFormValues;
  if (id) {
    const a = await orNotFound(getAccount(user, id));
    values = { ...a, iban: a.iban ? formatIban(a.iban) : null, openingBalance: a.openingBalance.toString(), openingDate: a.openingDate?.toISOString().slice(0, 10) ?? null };
  } else {
    const tur = strParam((await searchParams)?.tur);
    values = { type: tur === "banka" ? "BANK" : "CASH", name: "", currency: "TRY", bankName: null, branch: null, accountNo: null, iban: null, openingBalance: "0", openingDate: null };
  }
  const title = id ? "Düzenle" : values.type === "BANK" ? "Yeni banka hesabı" : "Yeni kasa";
  return (
    <>
      <PageHeader title={title} parent={{ href: id ? `${BASE}/${id}` : BASE, label: id ? values.name : "Kasa ve Bankalar" }} />
      <Card>
        <AccountForm values={values} cancelHref={id ? `${BASE}/${id}` : BASE} />
      </Card>
    </>
  );
}
