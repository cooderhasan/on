import type { Metadata } from "next";
import { WarehouseListPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Depolar" };

export default function Page(props: PageProps<"/depolar">) {
  return <WarehouseListPage searchParams={props.searchParams} />;
}
