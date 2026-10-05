import type { Metadata } from "next";
import { WaybillDetailPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Giden İrsaliye" };

export default function Page(props: PageProps<"/giden-irsaliyeler/[id]">) {
  return <WaybillDetailPage direction="SALE" params={props.params} />;
}
