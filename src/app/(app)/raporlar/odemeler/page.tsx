import type { Metadata } from "next";
import { PaymentsReportPage } from "@/components/report-views";

export const metadata: Metadata = { title: "Ödemeler Raporu" };

export default function Page(props: PageProps<"/raporlar/odemeler">) {
  return <PaymentsReportPage searchParams={props.searchParams} />;
}
