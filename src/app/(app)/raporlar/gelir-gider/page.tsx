import type { Metadata } from "next";
import { IncomeExpenseReportPage } from "@/components/report-views";

export const metadata: Metadata = { title: "Gelir Gider Raporu" };

export default function Page(props: PageProps<"/raporlar/gelir-gider">) {
  return <IncomeExpenseReportPage searchParams={props.searchParams} />;
}
