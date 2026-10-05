import type { Metadata } from "next";
import { InvoiceFormPage } from "@/components/invoice-views";

export const metadata: Metadata = { title: "Yeni alış faturası" };

export default function Page(props: PageProps<"/giderler/yeni">) {
  return <InvoiceFormPage direction="PURCHASE" searchParams={props.searchParams} />;
}
