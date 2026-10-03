import type { Metadata } from "next";
import { InvoiceFormPage } from "@/components/invoice-views";

export const metadata: Metadata = { title: "Yeni fatura" };

export default function Page(props: PageProps<"/satislar/yeni">) {
  return <InvoiceFormPage searchParams={props.searchParams} />;
}
