import type { Metadata } from "next";
import { InvoiceListPage } from "@/components/invoice-views";

export const metadata: Metadata = { title: "Satış Faturaları" };

export default function Page(props: PageProps<"/satislar">) {
  return <InvoiceListPage searchParams={props.searchParams} />;
}
