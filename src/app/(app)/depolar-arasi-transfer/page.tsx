import type { Metadata } from "next";
import { TransferListPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Depolar Arası Transfer" };

export default function Page(props: PageProps<"/depolar-arasi-transfer">) {
  return <TransferListPage searchParams={props.searchParams} />;
}
