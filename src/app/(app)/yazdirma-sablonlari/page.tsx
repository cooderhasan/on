import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getPrintSettings } from "@/server/services/print-settings";
import { Card, PageHeader } from "@/components/ui";
import { PrintSettingsForm } from "@/components/print-settings-form";

export const metadata: Metadata = { title: "Yazdırma Şablonları" };

export default async function Page() {
  await requireUser("settings.manage");
  const [settings, banks, last] = await Promise.all([
    getPrintSettings(),
    db.account.findMany({ where: { type: "BANK", isArchived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, iban: true, currency: true } }),
    db.invoice.findFirst({ where: { direction: "SALE", eDocStatus: { in: ["NONE", "FAILED"] } }, orderBy: { createdAt: "desc" }, select: { id: true } }),
  ]);
  return (
    <>
      <PageHeader title="Yazdırma Şablonları" />
      <Card className="mb-4 px-4 py-3 text-sm text-text-2">
        Bu ayarlar kağıt fatura, proforma ve teklif çıktılarına uygulanır. e-Fatura / e-Arşiv olarak gönderilen belgelerin resmi görüntüsü NES&apos;ten gelir.
        {last && <> <Link href={`/satislar/${last.id}/yazdir`} target="_blank" className="text-accent hover:underline">Son faturada önizle</Link></>}
      </Card>
      <Card>
        <PrintSettingsForm values={settings} banks={banks} />
      </Card>
    </>
  );
}
