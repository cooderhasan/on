import type { Metadata } from "next";
import { QuoteDetailPage } from "@/components/quote-views";

export const metadata: Metadata = { title: "Teklif" };

export default function Page(props: PageProps<"/teklifler/[id]">) {
  return <QuoteDetailPage params={props.params} />;
}
