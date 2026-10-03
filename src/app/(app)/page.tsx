import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getCompany } from "@/server/company";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Güncel Durum" };

export default async function DashboardPage() {
  await requireUser("dashboard.read");
  const company = await getCompany();

  // Kurulum adımları: yalnızca gerçekten kontrol edilebilenler
  const steps = [
    { done: Boolean(company?.title && company.taxNumber), label: "Firma bilgilerini girin (unvan, VKN, vergi dairesi, adres)", href: "/firma-bilgileri" },
  ];

  return (
    <>
      <PageHeader title="Güncel Durum" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={<span className="text-teal">Tahsilatlar</span>} />
            <EmptyState title="Henüz satış faturası yok" description="Toplam tahsil edilecek, gecikmiş ve planlanmamış tutarlar faturalar eklendikçe burada görünecek." />
          </Card>
          <Card>
            <CardHeader title={<span className="text-[#8a6d5a]">Ödemeler</span>} />
            <EmptyState title="Henüz gider kaydı yok" description="Toplam ödenecek, gecikmiş ve planlanmamış tutarlar giderler eklendikçe burada görünecek." />
          </Card>
        </div>
        <aside className="flex flex-col gap-4">
          <Card>
            <div className="rounded-t bg-teal px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white">
              Bugün · {new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", timeZone: "Europe/Istanbul" })}
            </div>
            <p className="px-4 py-4 text-sm text-text-3">Vadesi gelen ve geciken işlemler burada listelenecek.</p>
          </Card>
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
    </>
  );
}
