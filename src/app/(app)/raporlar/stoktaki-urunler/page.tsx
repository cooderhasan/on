import type { Metadata } from "next";
import { StockReportPage } from "@/components/report-views";

export const metadata: Metadata = { title: "Stoktaki Ürünler Raporu" };

export default function Page(props: PageProps<"/raporlar/stoktaki-urunler">) {
  return <StockReportPage searchParams={props.searchParams} />;
}
