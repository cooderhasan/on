import type { Metadata } from "next";
import { ExpenseReportPage } from "@/components/report-views";

export const metadata: Metadata = { title: "Giderler Raporu" };

export default function Page(props: PageProps<"/raporlar/giderler">) {
  return <ExpenseReportPage searchParams={props.searchParams} />;
}
