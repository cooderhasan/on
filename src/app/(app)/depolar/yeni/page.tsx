import type { Metadata } from "next";
import { WarehouseFormPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Yeni depo" };

export default function Page() {
  return <WarehouseFormPage />;
}
