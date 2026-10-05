import type { Metadata } from "next";
import { PriceListFormPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Fiyat listesini düzenle" };

export default function Page(props: PageProps<"/fiyat-listeleri/[id]/duzenle">) {
  return <PriceListFormPage params={props.params} />;
}
