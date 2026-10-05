import type { Metadata } from "next";
import { WaybillListPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Giden İrsaliyeler" };

export default function Page(props: PageProps<"/giden-irsaliyeler">) {
  return <WaybillListPage direction="SALE" searchParams={props.searchParams} />;
}
