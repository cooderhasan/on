import type { Metadata } from "next";
import { PriceListListPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Fiyat Listeleri" };

export default function Page(props: PageProps<"/fiyat-listeleri">) {
  return <PriceListListPage searchParams={props.searchParams} />;
}
