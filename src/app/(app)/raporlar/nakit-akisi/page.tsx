import type { Metadata } from "next";
import { CashFlowReportPage } from "@/components/report-views";

export const metadata: Metadata = { title: "Nakit Akışı Raporu" };

export default function Page() {
  return <CashFlowReportPage />;
}
