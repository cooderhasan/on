import type { Metadata } from "next";
import { ProductFormPage } from "@/components/product-views";

export const metadata: Metadata = { title: "Yeni · Hizmet ve Ürünler" };

export default function Page() {
  return <ProductFormPage />;
}
