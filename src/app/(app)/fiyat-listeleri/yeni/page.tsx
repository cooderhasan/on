import type { Metadata } from "next";
import { PriceListFormPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Yeni fiyat listesi" };

export default function Page() {
  return <PriceListFormPage />;
}
