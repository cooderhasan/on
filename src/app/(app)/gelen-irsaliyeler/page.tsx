import type { Metadata } from "next";
import { WaybillListPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Gelen İrsaliyeler" };

export default function Page(props: PageProps<"/gelen-irsaliyeler">) {
  return <WaybillListPage direction="PURCHASE" searchParams={props.searchParams} />;
}
