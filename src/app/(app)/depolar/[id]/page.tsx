import type { Metadata } from "next";
import { WarehouseDetailPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Depo" };

export default function Page(props: PageProps<"/depolar/[id]">) {
  return <WarehouseDetailPage params={props.params} />;
}
