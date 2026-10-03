import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Briefcase, Building2, FileText, Globe, Hash, Mail, MapPin, Phone } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getCompany } from "@/server/company";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { InfoRow } from "@/components/list";

export const metadata: Metadata = { title: "Firma Bilgileri" };

export default async function CompanyPage() {
  const user = await requireUser();
  const company = await getCompany();
  const canEdit = can(user.role, "settings.manage");
  // Henüz girilmediyse doğrudan form
  if (!company && canEdit) redirect("/firma-bilgileri/duzenle");

  return (
    <>
      <PageHeader title="Firma Bilgileri" />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
          <h2 className="flex items-center gap-3 text-lg text-text">
            <Building2 className="size-7 text-text-3" /> {company?.title ?? "Firma bilgisi girilmedi"}
          </h2>
          {canEdit && <LinkButton href="/firma-bilgileri/duzenle" variant="secondary">Düzenle</LinkButton>}
        </div>
        {company && (
          <dl className="py-3">
            <InfoRow label="Ticari unvan" icon={<Building2 />}>{company.title}</InfoRow>
            <InfoRow label="Sektör" icon={<Briefcase />}>{company.sector}</InfoRow>
            <InfoRow label="Açık adres" icon={<MapPin />}>
              {[company.address, [company.district, company.city].filter(Boolean).join(" / "), company.postalCode].filter(Boolean).join(", ")}
            </InfoRow>
            <InfoRow label="Vergi bilgileri" icon={<Hash />}>
              {company.taxOffice || company.taxNumber ? (
                <>
                  {company.taxOffice && <span className="mr-4">V.D. {company.taxOffice}</span>}
                  {company.taxNumber && <span>{company.taxNumber.length === 11 ? "TCKN" : "VKN"} {company.taxNumber}</span>}
                </>
              ) : null}
            </InfoRow>
            <InfoRow label="Mersis / sicil" icon={<FileText />}>{[company.mersisNo, company.tradeRegNo].filter(Boolean).join(" · ")}</InfoRow>
            <InfoRow label="Telefon" icon={<Phone />}>{company.phone}</InfoRow>
            <InfoRow label="E-posta" icon={<Mail />}>{company.email}</InfoRow>
            <InfoRow label="Web sitesi" icon={<Globe />}>{company.website}</InfoRow>
          </dl>
        )}
      </Card>
    </>
  );
}
