import type { Metadata } from "next";
import { ProductDetailPage } from "@/components/product-views";

export const metadata: Metadata = { title: "Hizmet ve Ürünler" };

export default function Page(props: PageProps<"/hizmet-ve-urunler/[id]">) {
  return <ProductDetailPage params={props.params} />;
}
