import type { Metadata } from "next";
import { InvoiceDetailPage } from "@/components/invoice-views";

export const metadata: Metadata = { title: "Satış Faturası" };

export default function Page(props: PageProps<"/satislar/[id]">) {
  return <InvoiceDetailPage params={props.params} searchParams={props.searchParams} />;
}
