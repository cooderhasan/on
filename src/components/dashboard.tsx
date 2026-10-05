import Link from "next/link";
import Decimal from "decimal.js";
import { CheckCircle2, Circle } from "lucide-react";
import type { CurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { getCompany } from "@/server/company";
import { accountBalances } from "@/server/services/ledger";
import { startOfToday } from "@/server/services/invoices";
import { aging, cashFlowReport, daysLate, expenseReport, monthLabel, openPayables, openReceivables, salesReport, vatReport, type OpenItem } from "@/server/services/reports";
import { Card, CardHeader, EmptyState } from "./ui";
import { Money } from "./money";
import { cn } from "@/lib/cn";

const ZERO = new Decimal(0);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Halka grafik: toplam içinde gecikmiş ve 7 gün içinde vadesi gelen pay */
function Donut({ total, parts, color }: { total: Decimal; parts: Array<{ value: Decimal; color: string }>; color: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 80 80" className="size-24 shrink-0 -rotate-90" aria-hidden>
      <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="10" opacity={total.isZero() ? 0.15 : 0.35} />
      {!total.isZero() &&
        parts.map((p, i) => {
          const len = Math.max(0, Math.min(1, p.value.dividedBy(total).toNumber())) * c;
          const el = <circle key={i} cx="40" cy="40" r={r} fill="none" stroke={p.color} strokeWidth="10" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />;
          offset += len;
          return el;
        })}
    </svg>
  );
}

function SummaryCard({ title, tone, items, href, extra }: { title: string; tone: string; items: OpenItem[]; href: string; extra?: React.ReactNode }) {
  const a = aging(items);
  const today = startOfToday();
  const week = new Date(today.getTime() + 7 * 86_400_000);
  const soon = items.filter((i) => i.dueDate >= today && i.dueDate <= week).reduce((s, i) => s.plus(i.remainingTl), ZERO);
  return (
    <Card>
      <CardHeader title={<Link href={href} className={cn("hover:underline", tone === "teal" ? "text-teal" : "text-[#8a6d5a]")}>{title}</Link>} />
      {items.length === 0 ? (
        <EmptyState title="Açık kayıt yok" description="Vadesi gelen ve geciken tutarlar burada görünür." />
      ) : (
        <div className="flex flex-wrap items-center gap-6 p-4">
          <Donut total={a.total} color={tone === "teal" ? "#1aa59a" : "#8a6d5a"} parts={[{ value: a.overdue, color: "#e0533d" }, { value: soon, color: "#f0a73a" }]} />
          <dl className="grid flex-1 grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div><dt className="text-[11px] font-semibold uppercase text-text-2">Toplam</dt><dd><Money value={a.total} className="text-lg" /></dd><dd className="text-[11px] text-text-3">{items.length} kayıt</dd></div>
            <div><dt className="text-[11px] font-semibold uppercase text-danger">Gecikmiş</dt><dd><Money value={a.overdue} className="text-lg text-danger" /></dd></div>
            <div><dt className="text-[11px] font-semibold uppercase text-warning">7 gün içinde</dt><dd><Money value={soon} className="text-lg" /></dd></div>
          </dl>
        </div>
      )}
      {extra}
    </Card>
  );
}

export async function Dashboard({ user }: { user: CurrentUser }) {
  const sales = can(user.role, "sales.read");
  const expenses = can(user.role, "expenses.read");
  const cash = can(user.role, "cash.read");
  const reports = can(user.role, "reports.read");
  const today = startOfToday();
  const monthStart = `${iso(today).slice(0, 7)}-01`;
  const lastMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const lastMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));

  const [company, receivables, payables, accounts, cheques, month, flow] = await Promise.all([
    getCompany(),
    sales ? openReceivables() : Promise.resolve([]),
    expenses ? openPayables() : Promise.resolve([]),
    cash ? db.account.findMany({ where: { isArchived: false }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true, currency: true } }) : Promise.resolve([]),
    cash ? db.cheque.groupBy({ by: ["direction", "currency"], where: { status: { in: ["PORTFOLIO", "PENDING"] } }, _sum: { amount: true }, _count: true }) : Promise.resolve([]),
    reports
      ? Promise.all([
          salesReport(user, { from: monthStart, to: iso(today) }, "month"),
          expenseReport(user, { from: monthStart, to: iso(today) }, "month"),
          vatReport(user, { from: iso(lastMonthStart), to: iso(today) }),
        ])
      : Promise.resolve(null),
    reports ? cashFlowReport(user, 0, 2) : Promise.resolve(null),
  ]);
  const balances = await accountBalances(accounts.map((a) => a.id));

  // Zaman çizelgesi: gecikmiş + 7 gün içinde vadesi gelenler
  const horizon = new Date(today.getTime() + 7 * 86_400_000);
  const timeline = [
    ...receivables.map((i) => ({ ...i, inbound: true })),
    ...payables.map((i) => ({ ...i, inbound: false })),
  ]
    .filter((i) => i.dueDate <= horizon)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || b.remainingTl.comparedTo(a.remainingTl))
    .slice(0, 12);

  const steps = [
    { done: Boolean(company?.title && company.taxNumber), label: "Firma bilgilerini girin (unvan, VKN, vergi dairesi, adres)", href: "/firma-bilgileri" },
    { done: accounts.length > 0 || !cash, label: "Kasa veya banka hesabı ekleyin", href: "/kasa-ve-bankalar" },
  ];
  const chequeIn = cheques.filter((c) => c.direction === "RECEIVED");
  const chequeOut = cheques.filter((c) => c.direction === "ISSUED");
  const vatLast = month?.[2].rows.find((r) => r.key === iso(lastMonthEnd).slice(0, 7));
  const vatThis = month?.[2].rows.find((r) => r.key === iso(today).slice(0, 7));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        {sales && (
          <SummaryCard
            title="Tahsilatlar"
            tone="teal"
            items={receivables}
            href={reports ? "/raporlar/tahsilatlar" : "/satislar?durum=open"}
            extra={chequeIn.length > 0 && (
              <p className="border-t border-border px-4 py-2 text-xs text-text-2">
                Portföydeki çekler: {chequeIn.map((c) => <Money key={c.currency} value={c._sum.amount ?? 0} currency={c.currency} className="ml-1" />)} <Link href="/cekler?tur=alinan&durum=open" className="ml-2 text-accent hover:underline">Çekler</Link>
              </p>
            )}
          />
        )}
        {expenses && (
          <SummaryCard
            title="Ödemeler"
            tone="brown"
            items={payables}
            href={reports ? "/raporlar/odemeler" : "/giderler?durum=open"}
            extra={chequeOut.length > 0 && (
              <p className="border-t border-border px-4 py-2 text-xs text-text-2">
                Ödenecek çekler: {chequeOut.map((c) => <Money key={c.currency} value={c._sum.amount ?? 0} currency={c.currency} className="ml-1" />)} <Link href="/cekler?tur=verilen&durum=open" className="ml-2 text-accent hover:underline">Çekler</Link>
              </p>
            )}
          />
        )}
        {month && (
          <Card>
            <CardHeader title={`Bu ay · ${monthLabel(iso(today).slice(0, 7))}`} action={<Link href="/raporlar/gelir-gider" className="text-xs text-accent hover:underline">Gelir gider raporu</Link>} />
            <dl className="grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-4">
              <div><dt className="text-[11px] font-semibold uppercase text-text-2">Satış (KDV hariç)</dt><dd><Money value={month[0].totals.net} className="text-lg text-teal" /></dd></div>
              <div><dt className="text-[11px] font-semibold uppercase text-text-2">Gider (KDV hariç)</dt><dd><Money value={month[1].totals.net} className="text-lg text-[#8a6d5a]" /></dd></div>
              <div><dt className="text-[11px] font-semibold uppercase text-text-2">Bu ay oluşan KDV</dt><dd><Money value={vatThis?.net ?? 0} className="text-lg" /></dd></div>
              <div><dt className="text-[11px] font-semibold uppercase text-text-2">Geçen ay KDV</dt><dd><Money value={vatLast?.net ?? 0} className="text-lg" /></dd><dd className="text-[11px] text-text-3"><Link href="/raporlar/kdv" className="hover:underline">KDV raporu</Link></dd></div>
            </dl>
          </Card>
        )}
        {flow && (
          <Card>
            <CardHeader title="Beklenen nakit akışı" action={<Link href="/raporlar/nakit-akisi" className="text-xs text-accent hover:underline">Ayrıntı</Link>} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-[11px] uppercase text-text-2"><tr><th className="px-2 py-1.5 text-left font-semibold sm:px-4">Ay</th><th className="px-2 text-right font-semibold sm:px-4">Giriş</th><th className="px-2 text-right font-semibold sm:px-4">Çıkış</th><th className="px-2 text-right font-semibold sm:px-4">Net</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {flow.future.map((r) => (
                    <tr key={r.key}>
                      <td className="px-2 py-2 text-xs sm:px-4 sm:text-sm">{r.label}</td>
                      <td className="px-2 py-2 text-right sm:px-4"><Money value={r.inflow} className="text-success" /></td>
                      <td className="px-2 py-2 text-right sm:px-4"><Money value={r.outflow} className="text-danger" /></td>
                      <td className="px-2 py-2 text-right font-semibold sm:px-4"><Money value={r.net} className={r.net.isNegative() ? "text-danger" : undefined} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        {(sales || expenses) && (
          <Card>
            <div className="rounded-t bg-teal px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white">
              Bugün · {new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", timeZone: "Europe/Istanbul" })}
            </div>
            {timeline.length === 0 ? (
              <p className="px-4 py-4 text-sm text-text-3">Gecikmiş veya 7 gün içinde vadesi gelen işlem yok.</p>
            ) : (
              <ul className="divide-y divide-border">
                {timeline.map((i) => {
                  const late = daysLate(i.dueDate, today);
                  return (
                    <li key={i.href} className="px-4 py-2.5 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={i.href} className="min-w-0 truncate hover:text-accent">{i.party === "—" ? i.title : i.party}</Link>
                        <Money value={i.remaining} currency={i.currency} className={i.inbound ? "text-teal" : "text-[#8a6d5a]"} />
                      </div>
                      <p className={cn("text-[11px]", late > 0 ? "text-danger" : "text-text-3")}>
                        {i.inbound ? "Tahsilat" : "Ödeme"} · {late > 0 ? `${late} gün gecikti` : late === 0 ? "bugün" : `${-late} gün sonra`}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}
        {cash && accounts.length > 0 && (
          <Card>
            <CardHeader title="Kasa ve bankalar" />
            <ul className="divide-y divide-border">
              {accounts.map((a) => (
                <li key={a.id} className="flex justify-between gap-2 px-4 py-2 text-sm">
                  <Link href={`/kasa-ve-bankalar/${a.id}`} className="truncate hover:text-accent">{a.name}</Link>
                  <Money value={balances.get(a.id)!} currency={a.currency} className={balances.get(a.id)!.isNegative() ? "text-danger" : undefined} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        {steps.some((s) => !s.done) && (
          <Card>
            <CardHeader title="Kurulum" />
            <ul className="flex flex-col gap-2 p-4 text-sm">
              {steps.map((s) => (
                <li key={s.label} className="flex items-start gap-2">
                  {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle className="mt-0.5 size-4 shrink-0 text-text-3" />}
                  {s.done ? <span className="text-text-3 line-through">{s.label}</span> : <Link href={s.href} className="text-accent hover:underline">{s.label}</Link>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </aside>
    </div>
  );
}
