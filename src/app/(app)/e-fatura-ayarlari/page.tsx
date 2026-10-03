import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { getEInvoiceSettings } from "@/server/services/einvoice";
import { Alert, Card, PageHeader } from "@/components/ui";
import { EInvoiceSettingsForm } from "@/components/einvoice-forms";

export const metadata: Metadata = { title: "e-Fatura Ayarları" };

export default async function EInvoiceSettingsPage() {
  const user = await requireUser("settings.manage");
  const s = await getEInvoiceSettings(user);
  return (
    <>
      <PageHeader title="e-Fatura Ayarları (NES)" />
      {s.apiUrl.includes("api.nes.com.tr") && !s.apiUrl.includes("apitest") && (
        <Alert tone="warning" className="mb-4">Canlı ortam seçili: kesilen her e-Fatura / e-Arşiv GİB&apos;e iletilen resmi belgedir.</Alert>
      )}
      <Card>
        <EInvoiceSettingsForm s={s} />
      </Card>
    </>
  );
}
