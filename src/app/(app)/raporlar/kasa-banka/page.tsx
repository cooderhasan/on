import type { Metadata } from "next";
import { CashReportPage } from "@/components/report-views";

export const metadata: Metadata = { title: "Kasa / Banka Raporu" };

export default function Page(props: PageProps<"/raporlar/kasa-banka">) {
  return <CashReportPage searchParams={props.searchParams} />;
}
