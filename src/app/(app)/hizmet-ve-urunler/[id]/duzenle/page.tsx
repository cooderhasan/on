import type { Metadata } from "next";
import { ProductFormPage } from "@/components/product-views";

export const metadata: Metadata = { title: "Düzenle · Hizmet ve Ürünler" };

export default function Page(props: PageProps<"/hizmet-ve-urunler/[id]/duzenle">) {
  return <ProductFormPage params={props.params} />;
}
