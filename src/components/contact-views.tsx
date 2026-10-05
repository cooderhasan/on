import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Building2, Hash, Landmark, Mail, MapPin, Phone, Printer, User, Coins, List } from "lucide-react";
import type Decimal from "decimal.js";
import type { ContactKind } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth/session";
import { can, type Permission } from "@/server/auth/permissions";
import { contactTotals, getContact, KIND_LABELS, listContacts } from "@/server/services/contacts";
import { listCategories } from "@/server/services/categories";
import { orNotFound, pageParam, strParam } from "@/server/page-helpers";
import { archiveContactAction } from "@/app/actions/records";
import { Button, Card, CardHeader, EmptyState, LinkButton, PageHeader, Td, Th } from "./ui";
import { buildHref, CategoryBadge, InfoRow, ListFooter, ListToolbar } from "./list";
import { Money } from "./money";
import { ContactForm, type ContactFormValues } from "./contact-form";
import { formatIban } from "@/lib/iban";
import { db } from "@/server/db";
import { contactStatement, type StatementRow } from "@/server/services/ledger";
import { SettlementForm } from "./money-forms";

type SP = Record<string, string | string[] | undefined>;

const writePerm = (kind: ContactKind): Permission => (kind === "CUSTOMER" ? "sales.write" : "expenses.write");

function BalanceCell({ value: d, kind }: { value: Decimal; kind: ContactKind }) {
  if (d.isZero()) return <span className="text-text-3">—</span>;
  const receivable = d.greaterThan(0);
  return (
    <div className="text-right">
      <Money value={d.abs()} className={receivable ? "text-teal" : "text-[#8a6d5a]"} />
      <p className="text-[11px] text-text-3">{receivable ? (kind === "CUSTOMER" ? "Tahsil edilecek" : "Alacak") : "Ödenecek"}</p>
    </div>
  );
}

export async function ContactListPage({ kind, searchParams }: { kind: ContactKind; searchParams: Promise<SP> }) {
  const user = await requireUser(kind === "CUSTOMER" ? "sales.read" : "expenses.read");
  const sp = await searchParams;
  const L = KIND_LABELS[kind];
  const q = strParam(sp.q);
  const archived = strParam(sp.arsiv) === "1";
  const categoryId = strParam(sp.kategori);
  const [{ rows, total, page, pages }, totals, categories] = await Promise.all([
    listContacts(user, kind, { q, archived, categoryId, page: pageParam(sp.sayfa) }),
    contactTotals(kind),
    listCategories("CONTACT"),
  ]);
  const href = (p: number) => buildHref(L.path, { q, arsiv: archived ? "1" : undefined, kategori: categoryId, sayfa: p > 1 ? p : undefined });

  return (
    <>
      <PageHeader title={archived ? `${L.plural} · Arşiv` : L.plural} />
      <ListToolbar
        action={L.path}
        q={q}
        placeholder="Unvan, VKN/TCKN, telefon, e-posta…"
        hidden={{ arsiv: archived ? "1" : undefined }}
        filters={
          categories.length > 0 ? (
            <select name="kategori" defaultValue={categoryId ?? ""} aria-label="Kategori" className="h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs">
              <option value="">Tüm kategoriler</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ) : undefined
        }
        actions={can(user.role, writePerm(kind)) ? <LinkButton href={`${L.path}/yeni`}>Yeni {L.single.toLocaleLowerCase("tr")} oluştur</LinkButton> : undefined}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title={q || categoryId ? "Aramaya uyan kayıt yok" : archived ? "Arşivde kayıt yok" : `Henüz ${L.single.toLocaleLowerCase("tr")} eklenmedi`}
            action={!q && !archived && can(user.role, writePerm(kind)) ? <LinkButton href={`${L.path}/yeni`}>Yeni {L.single.toLocaleLowerCase("tr")} oluştur</LinkButton> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-border">
                <tr>
                  <Th className="w-10" />
                  <Th>Unvanı</Th>
                  <Th className="hidden md:table-cell">VKN / TCKN</Th>
                  <Th className="text-right">Bakiye</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-card-muted">
                    <Td>
                      <span className="grid size-8 place-items-center rounded-sm bg-[#d9d9d9] text-white">{c.personType === "NATURAL" ? <User className="size-4" /> : <Building2 className="size-4" />}</span>
                    </Td>
                    <Td>
                      <Link href={`${L.path}/${c.id}`} className="font-medium uppercase text-text hover:text-accent">{c.title}</Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-text-3">
                        {c.phone && <span>{c.phone}</span>}
                        {c.category && <CategoryBadge category={c.category} />}
                      </div>
                    </Td>
                    <Td className="hidden font-mono text-xs text-text-2 md:table-cell">{c.taxNumber ?? "—"}</Td>
                    <Td><BalanceCell value={c.balance} kind={kind} /></Td>
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
          summary={
            <>
              <Link href={buildHref(L.path, { arsiv: archived ? undefined : "1" })} className="text-accent hover:underline">{archived ? "Aktif kayıtlar" : "Arşiv"}</Link>
              {!archived && (
                <>
                  <span>Ödenecek <Money value={totals.payable} /></span>
                  <span>Tahsil edilecek <Money value={totals.receivable} /></span>
                </>
              )}
            </>
          }
        />
      </Card>
    </>
  );
}

export async function ContactDetailPage({ kind, params }: { kind: ContactKind; params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const c = await orNotFound(getContact(user, id));
  if (c.kind !== kind) notFound();
  const L = KIND_LABELS[kind];
  const canEdit = can(user.role, writePerm(kind));
  const canCash = can(user.role, "cash.write");
  const [statement, accounts] = await Promise.all([contactStatement(c.id), canEdit && canCash ? db.account.findMany({ where: { isArchived: false }, select: { id: true, name: true, currency: true }, orderBy: { name: "asc" } }) : Promise.resolve([])]);
  const addr = c.isAbroad ? [c.address, c.postalCode, c.city, c.country] : [c.address, c.postalCode, [c.district, c.city].filter(Boolean).join(" / ")];

  return (
    <>
      <PageHeader title={c.shortName || c.title} parent={{ href: L.path, label: L.plural }} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
            <h2 className="flex min-w-0 items-center gap-3 text-lg text-text">
              {c.personType === "NATURAL" ? <User className="size-7 shrink-0 text-text-3" /> : <Building2 className="size-7 shrink-0 text-text-3" />}
              <span className="uppercase">{c.title}</span>
            </h2>
            <div className="flex items-center gap-2">
              <CategoryBadge category={c.category} />
              {c.isArchived && <span className="rounded-sm bg-warning px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Arşivde</span>}
              {canEdit && <LinkButton href={`${L.path}/${c.id}/duzenle`} variant="secondary">Düzenle</LinkButton>}
            </div>
          </div>
          <dl className="py-3">
            <InfoRow label="Türü" icon={<Building2 />}>{c.personType === "NATURAL" ? "Gerçek kişi" : "Tüzel kişi"}</InfoRow>
            <InfoRow label="VKN / TCKN" icon={<Hash />}>
              {c.taxNumber && <span className="font-mono">{c.taxNumber}</span>}
              {c.eInvoiceCheckedAt && <span className={`ml-3 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white ${c.eInvoiceAlias ? "bg-success" : "bg-text-3"}`}>{c.eInvoiceAlias ? "e-Fatura mükellefi" : "e-Arşiv"}</span>}
            </InfoRow>
            <InfoRow label="Vergi dairesi" icon={<Landmark />}>{c.taxOffice}</InfoRow>
            <InfoRow label="E-posta" icon={<Mail />}>{c.email && <a href={`mailto:${c.email}`} className="text-accent hover:underline">{c.email}</a>}</InfoRow>
            <InfoRow label="Telefon" icon={<Phone />}>{c.phone && <a href={`tel:${c.phone}`} className="text-accent hover:underline">{c.phone}</a>}</InfoRow>
            <InfoRow label="Faks" icon={<Printer />}>{c.fax}</InfoRow>
            <InfoRow label="Adres" icon={<MapPin />}>{addr.filter(Boolean).join(", ")}</InfoRow>
            <InfoRow label="IBAN" icon={<Hash />}>
              {c.ibans.length > 0 && (
                <ul className="font-mono text-xs">
                  {c.ibans.map((i) => <li key={i.id}>{formatIban(i.iban)}</li>)}
                </ul>
              )}
            </InfoRow>
            <InfoRow label="Döviz" icon={<Coins />}>{c.currency !== "TRY" ? `${c.currency} · ${c.rateType === "BUYING" ? "alış" : "satış"} kuru` : null}</InfoRow>
            <InfoRow label="Notlar" icon={<List />}>{c.notes && <span className="whitespace-pre-line">{c.notes}</span>}</InfoRow>
          </dl>
          {c.people.length > 0 && (
            <div className="border-t border-border">
              <CardHeader title="Yetkili kişiler" className="border-b-0" />
              <div className="overflow-x-auto px-0 pb-3">
                <table className="w-full min-w-[480px] text-sm">
                  <thead><tr><Th>Ad</Th><Th>E-posta</Th><Th>Telefon</Th><Th>Not</Th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {c.people.map((p) => (
                      <tr key={p.id}><Td>{p.name}</Td><Td>{p.email ?? "—"}</Td><Td>{p.phone ?? "—"}</Td><Td className="text-text-2">{p.notes ?? ""}</Td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
        <StatementCard rows={statement} currency={c.currency} />
        <aside className="flex flex-col gap-4 xl:col-start-2 xl:row-span-2 xl:row-start-1">
          <Card>
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-2">Bakiye</span>
              {c.balance.isZero() ? <span className="text-text-3">0,00₺</span> : <BalanceCell value={c.balance} kind={kind} />}
            </div>
            {c.openingBalance && (
              <p className="border-t border-border px-4 py-2 text-xs text-text-3">
                Açılış bakiyesi{c.openingBalanceDate ? ` (${c.openingBalanceDate.toLocaleDateString("tr-TR", { timeZone: "UTC" })})` : ""}
              </p>
            )}
          </Card>
          {canEdit && canCash && (
            <Card className="p-4">
              <p className="mb-2 text-[11px] font-semibold uppercase text-text-2">{kind === "CUSTOMER" ? "Cari tahsilat ekle" : "Cari ödeme ekle"}</p>
              <SettlementForm contactId={c.id} accounts={accounts} docCurrency={c.currency} label={kind === "CUSTOMER" ? "Tahsilat ekle" : "Ödeme ekle"} />
              <p className="mt-2 text-[11px] text-text-3">Belirli bir faturaya bağlamak için faturanın sayfasından ekleyin.</p>
            </Card>
          )}
          {kind === "CUSTOMER" && can(user.role, "sales.write") && <LinkButton href={`/satislar/yeni?musteri=${c.id}`} variant="secondary">Fatura oluştur</LinkButton>}
          {kind === "SUPPLIER" && can(user.role, "expenses.write") && <LinkButton href={`/giderler/yeni?tedarikci=${c.id}`} variant="secondary">Fatura oluştur</LinkButton>}
          {canEdit && (
            <form action={archiveContactAction}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="archived" value={c.isArchived ? "0" : "1"} />
              <Button type="submit" variant="ghost" size="sm">
                {c.isArchived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                {c.isArchived ? "Arşivden çıkar" : "Arşivle"}
              </Button>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}

export async function ContactFormPage({ kind, params }: { kind: ContactKind; params?: Promise<{ id: string }> }) {
  const user = await requireUser(writePerm(kind));
  const L = KIND_LABELS[kind];
  const categories = await listCategories("CONTACT");
  const id = params ? (await params).id : null;
  let values: ContactFormValues;
  if (id) {
    const c = await orNotFound(getContact(user, id));
    if (c.kind !== kind) notFound();
    values = {
      ...c,
      openingBalance: c.openingBalance?.toString() ?? null,
      openingBalanceDate: c.openingBalanceDate?.toISOString().slice(0, 10) ?? null,
      ibans: c.ibans.map((i) => formatIban(i.iban)),
      people: c.people.map(({ name, email, phone, notes }) => ({ name, email, phone, notes })),
    };
  } else {
    values = {
      kind, personType: "LEGAL", title: "", shortName: null, taxNumber: null, taxOffice: null, categoryId: null, email: null, phone: null, fax: null,
      address: null, isAbroad: false, postalCode: null, district: null, city: null, country: null, currency: "TRY", rateType: "BUYING",
      openingBalance: null, openingBalanceSide: null, openingBalanceDate: null, notes: null, ibans: [], people: [],
    };
  }
  return (
    <>
      <PageHeader title={id ? "Düzenle" : "Yeni"} parent={{ href: id ? `${L.path}/${id}` : L.path, label: id ? values.title : L.plural }} />
      <Card>
        <ContactForm values={values} categories={categories} cancelHref={id ? `${L.path}/${id}` : L.path} />
      </Card>
    </>
  );
}

const ROW_LABEL: Record<StatementRow["kind"], string> = { OPENING: "Açılış", INVOICE: "Fatura", RETURN: "İade", COLLECTION: "Tahsilat", PAYMENT: "Ödeme", EXPENSE: "Fiş" };

/** Cari ekstre: borç / alacak / yürüyen bakiye (en yeni üstte) */
function StatementCard({ rows, currency }: { rows: StatementRow[]; currency: string }) {
  return (
    <Card className="xl:col-start-1">
      <CardHeader title="Hesap hareketleri (ekstre)" />
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-text-3">Henüz hareket yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-border"><tr><Th>Tarih</Th><Th>İşlem</Th><Th className="text-right">Borç</Th><Th className="text-right">Alacak</Th><Th className="text-right">Bakiye</Th></tr></thead>
            <tbody className="divide-y divide-border">
              {[...rows].reverse().map((r, i) => (
                <tr key={i}>
                  <Td className="whitespace-nowrap text-text-2">{r.date.toLocaleDateString("tr-TR", { timeZone: "UTC" })}</Td>
                  <Td>
                    <span className="mr-2 rounded-sm bg-card-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text-2">{ROW_LABEL[r.kind]}</span>
                    {r.href ? <Link href={r.href} className="hover:text-accent">{r.label}</Link> : r.label}
                  </Td>
                  <Td className="text-right">{r.debit.isZero() ? "" : <Money value={r.debit} currency={currency} />}</Td>
                  <Td className="text-right">{r.credit.isZero() ? "" : <Money value={r.credit} currency={currency} />}</Td>
                  <Td className="text-right"><Money value={r.balance} currency={currency} className={r.balance.isNegative() ? "text-[#8a6d5a]" : "text-teal"} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}