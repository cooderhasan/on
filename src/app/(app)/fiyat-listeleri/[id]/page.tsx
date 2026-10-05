import type { Metadata } from "next";
import { PriceListDetailPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Fiyat listesi" };

export default function Page(props: PageProps<"/fiyat-listeleri/[id]">) {
  return <PriceListDetailPage params={props.params} />;
}
