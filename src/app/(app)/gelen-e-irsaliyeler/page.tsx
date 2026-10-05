import type { Metadata } from "next";
import Link from "next/link";
import type { IncomingStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { INCOMING_DESPATCH_LABELS, listIncomingDespatches } from "@/server/services/edespatch";
import { activeWarehouses } from "@/server/services/stock";
import { strParam } from "@/server/page-helpers";
import { Card, EmptyState, PageHeader, Td, Th } from "@/components/ui";
import { IncomingDespatchActions, SyncIncomingDespatchButton } from "@/components/edespatch-forms";
import { fmtDate } from "@/components/invoice-views";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Gelen e-İrsaliyeler" };

const ANSWER: Record<string, string> = { Waiting: "Yanıt bekliyor", AllAccepted: "Kabul edildi", AllRejected: "Reddedildi", PartialAnswered: "Kısmi kabul" };

export default async function Page(props: PageProps<"/gelen-e-irsaliyeler">) {
  const user = await requireUser("expenses.read");
  const raw = strParam((await props.searchParams).durum);
  const status = raw && raw in INCOMING_DESPATCH_LABELS ? (raw as IncomingStatus) : undefined;
  const [{ rows, lastSync }, warehouses] = await Promise.all([listIncomingDespatches(user, status), activeWarehouses()]);
  const canWrite = can(user.role, "expenses.write") && can(user.role, "stock.write");
  return (
    <>
      <PageHeader title="Gelen e-İrsaliyeler" actions={canWrite ? <SyncIncomingDespatchButton /> : undefined} />
      <div className="mb-3 flex flex-wrap gap-1 text-xs">
        {([[undefined, "Tümü"], ...Object.entries(INCOMING_DESPATCH_LABELS)] as Array<[string | undefined, string]>).map(([k, l]) => (
          <Link key={l} href={k ? `/gelen-e-irsaliyeler?durum=${k}` : "/gelen-e-irsaliyeler"} className={cn("rounded-sm px-2 py-1", status === k ? "bg-primary text-white" : "bg-card text-text-2")}>{l}</Link>
        ))}
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Gelen e-İrsaliye yok" description="“e-İrsaliyeleri içeri al” ile NES'teki gelen e-İrsaliyeleri çekin." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border"><tr><Th>Gönderen</Th><Th>İrsaliye no</Th><Th>Tarih</Th><Th>Durum</Th><Th className="text-right">İşlem</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td><span className="font-medium uppercase">{r.senderTitle}</span><p className="font-mono text-xs text-text-3">{r.senderTaxNumber}</p></Td>
                    <Td className="font-mono text-xs">
                      {r.documentNumber ?? "—"}
                      <div className="mt-0.5 flex gap-2 font-sans">
                        <a href={`/api/edespatch/incoming/${r.id}/html`} target="_blank" rel="noopener" className="text-accent hover:underline">Görüntüle</a>
                        <a href={`/api/edespatch/incoming/${r.id}/pdf`} className="text-accent hover:underline">PDF</a>
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">{fmtDate(r.issueDate)}</Td>
                    <Td className="text-xs">
                      <span className={r.status === "NEW" ? "text-warning" : r.status === "PROCESSED" ? "text-success" : "text-text-3"}>{INCOMING_DESPATCH_LABELS[r.status]}</span>
                      {r.answer && ANSWER[r.answer] && <p className="text-text-3">{ANSWER[r.answer]}</p>}
                      {r.waybill && <p><Link href={`/gelen-irsaliyeler/${r.waybill.id}`} className="text-accent hover:underline">Gelen irsaliye</Link></p>}
                    </Td>
                    <Td className="text-right">{canWrite && <IncomingDespatchActions id={r.id} status={r.status} warehouses={warehouses} />}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-border px-4 py-2.5 text-xs text-text-2">{rows.length} kayıt{lastSync && ` · Son alma: ${lastSync.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}`}</p>
      </Card>
    </>
  );
}
