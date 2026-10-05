import Link from "next/link";
import type { ReactNode } from "react";
import Decimal from "decimal.js";
import { AlertTriangle, Download } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { strParam } from "@/server/page-helpers";
import {
  aging, byParty, cashFlowReport, cashReport, expenseReport, incomeExpenseReport, monthLabel, openPayables, openReceivables, resolvePeriod, salesReport, settlementsReport, stockReport, vatDetail,
  vatReport, daysLate, type ExpenseGroup, type GroupRow, type OpenItem, type Period, type SalesGroup,
} from "@/server/services/reports";
import { activeWarehouses } from "@/server/services/stock";
import { buttonClass, Card, CardHeader, EmptyState, PageHeader, Td, Th } from "./ui";
import { buildHref } from "./list";
import { Money } from "./money";
import { fmtDate } from "./invoice-views";
import { qty } from "./stock-views";
import { unitLabel } from "@/lib/units";
import { cn } from "@/lib/cn";

type SP = Record<string, string | string[] | undefined>;
const ZERO = new Decimal(0);
const sel = "h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs";

/** Dönem filtresi + Excel'e aktar (aynı parametrelerle) */
function ReportToolbar({ action, exportName, period, params, children }: { action: string; exportName: string; period?: Period; params?: Record<string, string | undefined>; children?: ReactNode }) {
  const q = { ...(period ? { baslangic: period.from, bitis: period.to } : {}), ...params };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <form action={action} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded bg-[#d4d4d4] p-1.5">
        {period && (
          <>
            <input type="date" name="baslangic" defaultValue={period.from} aria-label="Başlangıç" className={sel} />
            <span className="text-xs text-text-2">–</span>
            <input type="date" name="bitis" defaultValue={period.to} aria-label="Bitiş" className={sel} />
          </>
        )}
        {children}
        <button type="submit" className={buttonClass("secondary", "sm")}>Göster</button>
      </form>
      <a href={buildHref(`/api/disa-aktar/${exportName}`, q)} className={buttonClass("secondary")}><Download className="size-3.5" /> Excel&apos;e aktar</a>
    </div>
  );
}

/** Yatay çubuk (değer / en büyük) */
function Bar({ value, max, tone = "bg-accent" }: { value: Decimal; max: Decimal; tone?: string }) {
  const pct = max.isZero() ? 0 : Math.max(0, Math.min(100, value.abs().dividedBy(max).times(100).toNumber()));
  return <div className="h-2 w-full rounded-full bg-card-muted"><div className={cn("h-2 rounded-full", tone)} style={{ width: `${pct}%` }} /></div>;
}

const maxOf = (vals: Decimal[]) => vals.reduce((m, v) => (v.abs().greaterThan(m) ? v.abs() : m), ZERO);

function GroupTable({ rows, totals, firstHeader, showQty }: { rows: GroupRow[]; totals: { net: Decimal; vat: Decimal; total: Decimal }; firstHeader: string; showQty?: boolean }) {
  const max = maxOf(rows.map((r) => r.net));
  if (!rows.length) return <EmptyState title="Bu dönemde kayıt yok" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-border"><tr><Th>{firstHeader}</Th><Th className="w-40" /><Th className="text-right">{showQty ? "Miktar" : "Belge"}</Th><Th className="text-right">KDV hariç</Th><Th className="text-right">KDV</Th><Th className="text-right">Toplam</Th></tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.key}>
              <Td>{r.href ? <Link href={r.href} className="hover:text-accent">{r.label}</Link> : r.label}</Td>
              <Td><Bar value={r.net} max={max} tone={r.net.isNegative() ? "bg-danger" : "bg-accent"} /></Td>
              <Td className="text-right font-mono text-xs">{showQty ? (r.quantity ? qty(r.quantity) : "—") : r.count}</Td>
              <Td className="text-right"><Money value={r.net} /></Td>
              <Td className="text-right text-text-2"><Money value={r.vat} /></Td>
              <Td className="text-right"><Money value={r.total} /></Td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-border font-semibold">
          <tr><Td>Toplam</Td><Td /><Td /><Td className="text-right"><Money value={totals.net} /></Td><Td className="text-right"><Money value={totals.vat} /></Td><Td className="text-right"><Money value={totals.total} /></Td></tr>
        </tfoot>
      </table>
    </div>
  );
}

const periodOf = (sp: SP) => resolvePeriod(strParam(sp.baslangic), strParam(sp.bitis));
const Note = ({ children }: { children: ReactNode }) => <p className="px-4 py-2 text-[11px] text-text-3">{children}</p>;

// ── Satışlar ───────────────────────────────────────────────

const SALES_GROUPS: Array<[SalesGroup, string]> = [["month", "Ay"], ["customer", "Müşteri"], ["product", "Hizmet / ürün"], ["category", "Kategori"]];

export async function SalesReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("reports.read");
  const sp = await searchParams;
  const period = periodOf(sp);
  const group = (SALES_GROUPS.find(([k]) => k === strParam(sp.grup))?.[0] ?? "month") as SalesGroup;
  const r = await salesReport(user, period, group);
  return (
    <>
      <PageHeader title="Satışlar Raporu" />
      <ReportToolbar action="/raporlar/satislar" exportName="rapor-satislar" period={period} params={{ grup: group }}>
        <select name="grup" defaultValue={group} aria-label="Gruplama" className={sel}>{SALES_GROUPS.map(([k, l]) => <option key={k} value={k}>{l} bazında</option>)}</select>
      </ReportToolbar>
      <Card>
        <GroupTable rows={r.rows} totals={r.totals} firstHeader={SALES_GROUPS.find(([k]) => k === group)![1]} showQty={group === "product"} />
        <Note>Satış faturaları − satış iadeleri; dövizli faturalar fatura kuruyla TL&apos;ye çevrilir. Reddedilen / iptal edilen e-belgeler hariç.</Note>
      </Card>
    </>
  );
}

// ── Giderler ───────────────────────────────────────────────

const EXPENSE_GROUPS: Array<[ExpenseGroup, string]> = [["month", "Ay"], ["supplier", "Tedarikçi / çalışan"], ["category", "Kategori"], ["kind", "Gider türü"]];

export async function ExpenseReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("reports.read");
  const sp = await searchParams;
  const period = periodOf(sp);
  const group = (EXPENSE_GROUPS.find(([k]) => k === strParam(sp.grup))?.[0] ?? "month") as ExpenseGroup;
  const r = await expenseReport(user, period, group);
  return (
    <>
      <PageHeader title="Giderler Raporu" />
      <ReportToolbar action="/raporlar/giderler" exportName="rapor-giderler" period={period} params={{ grup: group }}>
        <select name="grup" defaultValue={group} aria-label="Gruplama" className={sel}>{EXPENSE_GROUPS.map(([k, l]) => <option key={k} value={k}>{l} bazında</option>)}</select>
      </ReportToolbar>
      <Card>
        <GroupTable rows={r.rows} totals={r.totals} firstHeader={EXPENSE_GROUPS.find(([k]) => k === group)![1]} />
        <Note>Alış faturaları − alış iadeleri + fiş, maaş, vergi / SGK ve banka giderleri. Tutarlar TL.</Note>
      </Card>
    </>
  );
}

// ── Gelir / gider ──────────────────────────────────────────

export async function IncomeExpenseReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("reports.read");
  const period = periodOf(await searchParams);
  const r = await incomeExpenseReport(user, period);
  const max = maxOf(r.rows.flatMap((x) => [x.income, x.expense]));
  return (
    <>
      <PageHeader title="Gelir Gider Raporu" />
      <ReportToolbar action="/raporlar/gelir-gider" exportName="rapor-gelir-gider" period={period} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[["Gelir", r.totals.income, "text-teal"], ["Gider", r.totals.expense, "text-[#8a6d5a]"], [r.totals.profit.isNegative() ? "Zarar" : "Kâr", r.totals.profit, r.totals.profit.isNegative() ? "text-danger" : "text-success"]].map(([l, v, c]) => (
          <Card key={String(l)} className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-2">{String(l)}</p>
            <Money value={v as Decimal} className={cn("text-2xl", String(c))} />
          </Card>
        ))}
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b border-border"><tr><Th>Ay</Th><Th className="w-48" /><Th className="text-right">Gelir</Th><Th className="text-right">Gider</Th><Th className="text-right">Fark</Th></tr></thead>
            <tbody className="divide-y divide-border">
              {r.rows.map((x) => (
                <tr key={x.key}>
                  <Td className="whitespace-nowrap">{x.label}</Td>
                  <Td><div className="flex flex-col gap-1"><Bar value={x.income} max={max} tone="bg-teal" /><Bar value={x.expense} max={max} tone="bg-[#8a6d5a]" /></div></Td>
                  <Td className="text-right"><Money value={x.income} /></Td>
                  <Td className="text-right"><Money value={x.expense} /></Td>
                  <Td className="text-right"><Money value={x.profit} className={x.profit.isNegative() ? "text-danger" : "text-success"} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Note>KDV hariç tutarlar. Gelir: satış faturaları − iadeler. Gider: alış faturaları − iadeler + fatura dışı giderler (maaş dahil).</Note>
      </Card>
    </>
  );
}

// ── KDV ────────────────────────────────────────────────────

export async function VatReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("reports.read");
  const sp = await searchParams;
  const period = periodOf(sp);
  const month = strParam(sp.ay);
  const side = strParam(sp.taraf) as "SALE" | "PURCHASE" | undefined;
  const [r, detail] = await Promise.all([vatReport(user, period), month ? vatDetail(user, month) : Promise.resolve([])]);
  const shown = side ? detail.filter((d) => d.side === side) : detail;
  const base = { baslangic: period.from, bitis: period.to };
  return (
    <>
      <PageHeader title="KDV Raporu" />
      <ReportToolbar action="/raporlar/kdv" exportName="rapor-kdv" period={period} params={{ ay: month }} />
      <Card>
        <CardHeader title="Aylara göre KDV" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border"><tr><Th>Ay</Th><Th className="text-right">Hesaplanan KDV</Th><Th className="text-right">İndirilecek KDV</Th><Th className="text-right">Net KDV</Th><Th className="hidden text-right md:table-cell">Tevkifat (satış / alış)</Th></tr></thead>
            <tbody className="divide-y divide-border">
              {r.rows.map((x) => (
                <tr key={x.key} className={cn(month === x.key && "bg-card-muted")}>
                  <Td className="whitespace-nowrap"><Link href={buildHref("/raporlar/kdv", { ...base, ay: x.key })} className="text-accent hover:underline">{x.label}</Link></Td>
                  <Td className="text-right"><Money value={x.output} /></Td>
                  <Td className="text-right"><Money value={x.input} /></Td>
                  <Td className="text-right"><Money value={x.net} className={x.net.isNegative() ? "text-success" : "text-danger"} /></Td>
                  <Td className="hidden text-right text-xs text-text-2 md:table-cell"><Money value={x.outputWithholding} /> / <Money value={x.inputWithholding} /></Td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border font-semibold">
              <tr><Td>Toplam</Td><Td className="text-right"><Money value={r.totals.output} /></Td><Td className="text-right"><Money value={r.totals.input} /></Td><Td className="text-right"><Money value={r.totals.net} /></Td><Td className="hidden md:table-cell" /></tr>
            </tfoot>
          </table>
        </div>
        <Note>Net KDV &gt; 0: ödenecek, &lt; 0: devreden. Tevkifatlı faturada hesaplanan KDV&apos;nin tevkif edilen kısmı alıcı tarafından beyan edilir (sütunda ayrıca gösterilir). Beyanname öncesi mali müşavirinizle kontrol edin.</Note>
      </Card>
      {month && (
        <Card className="mt-4">
          <CardHeader
            title={`${monthLabel(month)} KDV dökümü`}
            action={
              <div className="flex gap-1 text-xs">
                {([[undefined, "Tümü"], ["SALE", "Satışlar"], ["PURCHASE", "Giderler"]] as const).map(([k, l]) => (
                  <Link key={l} href={buildHref("/raporlar/kdv", { ...base, ay: month, taraf: k })} className={cn("rounded-sm px-2 py-1", side === k ? "bg-primary text-white" : "bg-card-muted text-text-2")}>{l}</Link>
                ))}
              </div>
            }
          />
          {shown.length === 0 ? <EmptyState title="Bu ayda KDV'li kayıt yok" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-border"><tr><Th>İşlem türü</Th><Th>Fatura / fiş no</Th><Th>Kayıt ismi</Th><Th>Cari</Th><Th>Tarih</Th><Th className="text-right">KDV</Th></tr></thead>
                <tbody className="divide-y divide-border">
                  {shown.map((d, i) => (
                    <tr key={i}>
                      <Td className="text-xs text-text-2">{d.kind}</Td>
                      <Td className="font-mono text-xs">{d.docNo ?? "—"}</Td>
                      <Td><Link href={d.href} className="hover:text-accent">{d.name || "—"}</Link></Td>
                      <Td className="text-text-2">{d.party}</Td>
                      <Td className="whitespace-nowrap text-text-2">{fmtDate(d.date)}</Td>
                      <Td className="text-right"><Money value={d.vat} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

// ── Tahsilatlar / ödemeler ─────────────────────────────────

function OpenItemsCard({ title, items }: { title: string; items: OpenItem[] }) {
  const list = [...items].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()).slice(0, 50);
  return (
    <Card>
      <CardHeader title={title} />
      {list.length === 0 ? <EmptyState title="Açık kayıt yok" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="border-b border-border"><tr><Th>Kayıt</Th><Th>Cari</Th><Th>Vade</Th><Th className="text-right">Kalan</Th></tr></thead>
            <tbody className="divide-y divide-border">
              {list.map((i) => {
                const late = daysLate(i.dueDate);
                return (
                  <tr key={i.href}>
                    <Td><Link href={i.href} className="hover:text-accent">{i.title}</Link><p className="text-[11px] text-text-3">{i.kind}</p></Td>
                    <Td className="text-text-2">{i.partyHref ? <Link href={i.partyHref} className="hover:text-accent">{i.party}</Link> : i.party}</Td>
                    <Td className={cn("whitespace-nowrap", late > 0 && "text-danger")}>{fmtDate(i.dueDate)}{late > 0 && <span className="block text-[11px]">{late} gün gecikti</span>}</Td>
                    <Td className="text-right"><Money value={i.remaining} currency={i.currency} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {items.length > 50 && <Note>İlk 50 kayıt gösteriliyor; tamamı Excel çıktısında.</Note>}
    </Card>
  );
}

async function SettlementReport({ sp, type }: { sp: SP; type: "COLLECTION" | "PAYMENT" }) {
  const user = await requireUser("reports.read");
  const period = periodOf(sp);
  const collect = type === "COLLECTION";
  const [open, done] = await Promise.all([collect ? openReceivables() : openPayables(), settlementsReport(user, period, type)]);
  const a = aging(open);
  const parties = byParty(open).slice(0, 10);
  const maxBucket = maxOf(a.buckets.map((b) => b.amount));
  const maxParty = maxOf(parties.map((x) => x.amount));
  return (
    <>
      <PageHeader title={collect ? "Tahsilatlar Raporu" : "Ödemeler Raporu"} />
      <ReportToolbar action={collect ? "/raporlar/tahsilatlar" : "/raporlar/odemeler"} exportName={collect ? "rapor-tahsilatlar" : "rapor-odemeler"} period={period} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={collect ? "Tahsil edilecekler · vade analizi" : "Ödenecekler · vade analizi"} />
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-baseline justify-between"><span className="text-xs uppercase text-text-2">Toplam açık</span><Money value={a.total} className="text-2xl" /></div>
            {a.buckets.map((b) => (
              <div key={b.key}>
                <div className="flex justify-between text-xs"><span className={b.key === "future" ? "text-text-2" : "text-danger"}>{b.label}</span><Money value={b.amount} /></div>
                <Bar value={b.amount} max={maxBucket} tone={b.key === "future" ? "bg-teal" : "bg-danger"} />
              </div>
            ))}
          </div>
          <Note>TL karşılığı. {collect ? "Çekle tahsil edilen faturalar kapanmış sayılır; portföydeki çekler Nakit Akışı raporundadır." : "Fatura dışı giderler (maaş, vergi…) dahil."}</Note>
        </Card>
        <Card>
          <CardHeader title={collect ? "En çok borçlu müşteriler" : "En çok borçlu olduğumuz cariler"} />
          {parties.length === 0 ? <EmptyState title="Açık kayıt yok" /> : (
            <ul className="flex flex-col gap-3 p-4 text-sm">
              {parties.map((x) => (
                <li key={x.party}>
                  <div className="flex justify-between gap-2">
                    {x.href ? <Link href={x.href} className="truncate hover:text-accent">{x.party}</Link> : <span className="truncate">{x.party}</span>}
                    <span className="shrink-0"><Money value={x.amount} />{x.overdue.greaterThan(0) && <span className="ml-2 text-[11px] text-danger">gecikmiş <Money value={x.overdue} /></span>}</span>
                  </div>
                  <Bar value={x.amount} max={maxParty} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={`${collect ? "Tahsilatlar" : "Ödemeler"} · ${fmtDate(new Date(period.from))} – ${fmtDate(new Date(period.to))}`} />
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {done.months.map((m) => (
                <tr key={m.key}>
                  <Td>{m.label}</Td>
                  <Td className="text-right">{m.amounts.length ? m.amounts.map((x) => <Money key={x.currency} value={x.amount} currency={x.currency} className="ml-3" />) : <span className="text-text-3">—</span>}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border font-semibold">
              <tr><Td>Toplam</Td><Td className="text-right">{done.totals.map((x) => <Money key={x.currency} value={x.amount} currency={x.currency} className="ml-3" />)}</Td></tr>
            </tfoot>
          </table>
          <Note>Kasa / bankaya giren tutarlar hesap dövizinde; çekle {collect ? "tahsilat" : "ödeme"} çek tutarıyla.</Note>
        </Card>
        <OpenItemsCard title={collect ? "Tahsil edilecekler" : "Ödenecekler"} items={open} />
      </div>
    </>
  );
}

export async function CollectionsReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  return <SettlementReport sp={await searchParams} type="COLLECTION" />;
}

export async function PaymentsReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  return <SettlementReport sp={await searchParams} type="PAYMENT" />;
}

// ── Kasa / banka ───────────────────────────────────────────

export async function CashReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("reports.read");
  const period = periodOf(await searchParams);
  const rows = await cashReport(user, period);
  return (
    <>
      <PageHeader title="Kasa / Banka Raporu" />
      <ReportToolbar action="/raporlar/kasa-banka" exportName="rapor-kasa-banka" period={period} />
      <Card>
        {rows.length === 0 ? <EmptyState title="Kasa / banka hesabı yok" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border"><tr><Th>Hesap</Th><Th className="text-right">Dönem başı</Th><Th className="text-right">Giriş</Th><Th className="text-right">Çıkış</Th><Th className="text-right">Dönem sonu</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((a) => (
                  <tr key={a.id}>
                    <Td><Link href={`/kasa-ve-bankalar/${a.id}`} className="font-medium hover:text-accent">{a.name}</Link><p className="text-[11px] text-text-3">{a.type === "CASH" ? "Kasa" : "Banka"} · {a.currency}</p></Td>
                    <Td className="text-right"><Money value={a.opening} currency={a.currency} /></Td>
                    <Td className="text-right"><Money value={a.inflow} currency={a.currency} className="text-success" /></Td>
                    <Td className="text-right"><Money value={a.outflow} currency={a.currency} className="text-danger" /></Td>
                    <Td className="text-right"><Money value={a.closing} currency={a.currency} className={a.closing.isNegative() ? "text-danger" : undefined} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Note>Giriş / çıkışa virmanlar dahildir. Tutarlar hesabın kendi dövizinde.</Note>
      </Card>
    </>
  );
}

// ── Nakit akışı ────────────────────────────────────────────

function FlowTable({ rows }: { rows: Array<{ key: string; label: string; inflow: Decimal; outflow: Decimal; net: Decimal }> }) {
  const max = maxOf(rows.flatMap((r) => [r.inflow, r.outflow]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <thead className="border-b border-border"><tr><Th>Ay</Th><Th className="w-40" /><Th className="text-right">Giriş</Th><Th className="text-right">Çıkış</Th><Th className="text-right">Net</Th></tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.key}>
              <Td className="whitespace-nowrap">{r.label}</Td>
              <Td><div className="flex flex-col gap-1"><Bar value={r.inflow} max={max} tone="bg-success" /><Bar value={r.outflow} max={max} tone="bg-danger" /></div></Td>
              <Td className="text-right"><Money value={r.inflow} className="text-success" /></Td>
              <Td className="text-right"><Money value={r.outflow} className="text-danger" /></Td>
              <Td className="text-right"><Money value={r.net} className={r.net.isNegative() ? "text-danger" : undefined} /></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function CashFlowReportPage() {
  const user = await requireUser("reports.read");
  const r = await cashFlowReport(user);
  return (
    <>
      <PageHeader title="Nakit Akışı Raporu" />
      <ReportToolbar action="/raporlar/nakit-akisi" exportName="rapor-nakit-akisi" />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Beklenen (önümüzdeki aylar)" />
          <FlowTable rows={r.future} />
          <Note>Açık satış / alış faturaları ve giderler vade tarihine göre; portföydeki alınan ve ödenecek verilen çekler vadesine göre. Gecikmişler bu aya yazılır. TL karşılığı.</Note>
        </Card>
        <Card>
          <CardHeader title="Gerçekleşen (son aylar)" />
          <FlowTable rows={r.past} />
          <Note>TL kasa / banka hesaplarına fiilen giren ve çıkan para; hesaplar arası virman hariç.</Note>
        </Card>
      </div>
    </>
  );
}

// ── Stoktaki ürünler ───────────────────────────────────────

export async function StockReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("reports.read");
  const sp = await searchParams;
  const warehouseId = strParam(sp.depo);
  const [r, warehouses] = await Promise.all([stockReport(user, warehouseId), activeWarehouses()]);
  return (
    <>
      <PageHeader title="Stoktaki Ürünler Raporu" />
      <ReportToolbar action="/raporlar/stoktaki-urunler" exportName="rapor-stok" params={{ depo: warehouseId }}>
        {warehouses.length > 1 && (
          <select name="depo" defaultValue={warehouseId ?? ""} aria-label="Depo" className={sel}>
            <option value="">Tüm depolar</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </ReportToolbar>
      <Card>
        {r.rows.length === 0 ? <EmptyState title="Stokta ürün yok" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="border-b border-border"><tr><Th>Ürün</Th><Th className="text-right">Miktar</Th><Th className="text-right">Alış fiyatı</Th><Th className="text-right">Stok değeri</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {r.rows.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      <Link href={`/hizmet-ve-urunler/${p.id}`} className="uppercase hover:text-accent">{p.name}</Link>
                      {p.code && <span className="ml-2 font-mono text-xs text-text-3">{p.code}</span>}
                      {p.critical && <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-danger"><AlertTriangle className="size-3" /> kritik</span>}
                    </Td>
                    <Td className={cn("whitespace-nowrap text-right font-mono", p.quantity.isNegative() && "text-danger")}>{qty(p.quantity)} <span className="font-sans text-xs text-text-3">{unitLabel(p.unit)}</span></Td>
                    <Td className="text-right">{p.buyPrice ? <Money value={p.buyPrice} currency={p.buyCurrency} unitPrice /> : <span className="text-text-3">—</span>}</Td>
                    <Td className="text-right">{p.value ? <Money value={p.value} currency={p.buyCurrency} /> : <span className="text-text-3">—</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-4 border-t border-border px-4 py-2.5 text-xs text-text-2">
          {r.totals.map((t) => <span key={t.currency}>Toplam stok değeri <Money value={t.total} currency={t.currency} /></span>)}
        </div>
        <Note>Stok değeri = miktar × ürün kartındaki alış fiyatı (vergiler hariç).</Note>
      </Card>
    </>
  );
}
