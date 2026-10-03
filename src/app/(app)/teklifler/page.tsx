import type { Metadata } from "next";
import { QuoteListPage } from "@/components/quote-views";

export const metadata: Metadata = { title: "Teklifler" };

export default function Page(props: PageProps<"/teklifler">) {
  return <QuoteListPage searchParams={props.searchParams} />;
}
