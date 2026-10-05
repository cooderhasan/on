import type { Metadata } from "next";
import { InvoiceDetailPage } from "@/components/invoice-views";

export const metadata: Metadata = { title: "Alış Faturası" };

export default function Page(props: PageProps<"/giderler/[id]">) {
  return <InvoiceDetailPage direction="PURCHASE" params={props.params} searchParams={props.searchParams} />;
}
