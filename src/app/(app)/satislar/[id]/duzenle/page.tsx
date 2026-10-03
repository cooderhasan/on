import type { Metadata } from "next";
import { InvoiceFormPage } from "@/components/invoice-views";

export const metadata: Metadata = { title: "Faturayı düzenle" };

export default function Page(props: PageProps<"/satislar/[id]/duzenle">) {
  return <InvoiceFormPage params={props.params} />;
}
