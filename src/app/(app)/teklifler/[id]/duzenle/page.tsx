import type { Metadata } from "next";
import { QuoteFormPage } from "@/components/quote-views";

export const metadata: Metadata = { title: "Teklifi düzenle" };

export default function Page(props: PageProps<"/teklifler/[id]/duzenle">) {
  return <QuoteFormPage params={props.params} />;
}
