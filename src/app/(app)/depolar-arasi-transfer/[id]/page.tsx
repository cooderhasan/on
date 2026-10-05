import type { Metadata } from "next";
import { TransferDetailPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Transfer" };

export default function Page(props: PageProps<"/depolar-arasi-transfer/[id]">) {
  return <TransferDetailPage params={props.params} />;
}
