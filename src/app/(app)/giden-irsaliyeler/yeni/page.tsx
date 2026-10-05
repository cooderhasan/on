import type { Metadata } from "next";
import { WaybillFormPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Yeni irsaliye" };

export default function Page(props: PageProps<"/giden-irsaliyeler/yeni">) {
  return <WaybillFormPage direction="SALE" searchParams={props.searchParams} />;
}
