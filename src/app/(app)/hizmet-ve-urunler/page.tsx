import type { Metadata } from "next";
import { ProductListPage } from "@/components/product-views";

export const metadata: Metadata = { title: "Hizmet ve Ürünler" };

export default function Page(props: PageProps<"/hizmet-ve-urunler">) {
  return <ProductListPage searchParams={props.searchParams} />;
}
