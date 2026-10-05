import type { Metadata } from "next";
import { VatReportPage } from "@/components/report-views";

export const metadata: Metadata = { title: "KDV Raporu" };

export default function Page(props: PageProps<"/raporlar/kdv">) {
  return <VatReportPage searchParams={props.searchParams} />;
}
