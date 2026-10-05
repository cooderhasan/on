import type { Metadata } from "next";
import { SalesReportPage } from "@/components/report-views";

export const metadata: Metadata = { title: "Satışlar Raporu" };

export default function Page(props: PageProps<"/raporlar/satislar">) {
  return <SalesReportPage searchParams={props.searchParams} />;
}
