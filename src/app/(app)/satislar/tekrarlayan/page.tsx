import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listRecurring } from "@/server/services/recurring";
import { Card, EmptyState, PageHeader, Td, Th } from "@/components/ui";
import { Money } from "@/components/money";
import { fmtDate } from "@/components/invoice-views";

export const metadata: Metadata = { title: "Tekrarlayan faturalar" };

export default async function Page() {
  const user = await requireUser("sales.read");
  const rows = await listRecurring(user);
  return (
    <>
      <PageHeader title="Tekrarlayan faturalar" parent={{ href: "/satislar", label: "Satış Faturaları" }} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Tekrarlayan fatura yok" description="Bir satış faturasının sayfasında “Tekrarlayan yap” ile aylık / yıllık kopyalanmasını sağlayabilirsiniz." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="border-b border-border"><tr><Th>Şablon fatura</Th><Th>Sıklık</Th><Th>Sonraki</Th><Th className="text-right">Oluşan</Th><Th className="text-right">Tutar</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className={r.isActive ? undefined : "opacity-60"}>
                    <Td>
                      <Link href={`/satislar/${r.template.id}`} className="font-medium hover:text-accent">{r.template.name || r.template.invoiceNo || "Satış faturası"}</Link>
                      <p className="text-xs uppercase text-text-3">{r.template.contact.title}</p>
                    </Td>
                    <Td className="text-text-2">{r.interval > 1 ? `${r.interval} ` : ""}{r.period === "MONTHLY" ? "ayda" : "yılda"} bir{r.isActive ? "" : " · durduruldu"}</Td>
                    <Td className="whitespace-nowrap">{r.isActive ? fmtDate(r.nextDate) : "—"}{r.endDate && <span className="block text-[11px] text-text-3">bitiş {fmtDate(r.endDate)}</span>}</Td>
                    <Td className="text-right">{r.createdCount}</Td>
                    <Td className="text-right"><Money value={r.template.payableTotal} currency={r.template.currency} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
