import type { Metadata } from "next";
import { IncomingListPage } from "@/components/expense-views";

export const metadata: Metadata = { title: "Gelen e-Faturalar" };

export default function Page(props: PageProps<"/gelen-e-faturalar">) {
  return <IncomingListPage searchParams={props.searchParams} />;
}
