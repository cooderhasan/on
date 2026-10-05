import type { Metadata } from "next";
import { WaybillDetailPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Gelen İrsaliye" };

export default function Page(props: PageProps<"/gelen-irsaliyeler/[id]">) {
  return <WaybillDetailPage direction="PURCHASE" params={props.params} />;
}
