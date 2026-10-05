import type { Metadata } from "next";
import { InvoiceFormPage } from "@/components/invoice-views";

export const metadata: Metadata = { title: "Alış faturasını düzenle" };

export default function Page(props: PageProps<"/giderler/[id]/duzenle">) {
  return <InvoiceFormPage direction="PURCHASE" params={props.params} />;
}
