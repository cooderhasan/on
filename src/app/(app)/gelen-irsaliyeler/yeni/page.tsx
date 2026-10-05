import type { Metadata } from "next";
import { WaybillFormPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Yeni irsaliye" };

export default function Page(props: PageProps<"/gelen-irsaliyeler/yeni">) {
  return <WaybillFormPage direction="PURCHASE" searchParams={props.searchParams} />;
}
