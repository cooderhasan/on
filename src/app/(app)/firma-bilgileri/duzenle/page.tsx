import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { getCompany } from "@/server/company";
import { Card, PageHeader } from "@/components/ui";
import { CompanyForm } from "@/components/record-forms";

export const metadata: Metadata = { title: "Firma Bilgilerini Düzenle" };

export default async function EditCompanyPage() {
  await requireUser("settings.manage");
  const company = await getCompany();
  return (
    <>
      <PageHeader title="Düzenle" parent={{ href: "/firma-bilgileri", label: "Firma Bilgileri" }} />
      <Card>
        <CompanyForm company={company} />
      </Card>
    </>
  );
}
