import type { Metadata } from "next";
import { CollectionsReportPage } from "@/components/report-views";

export const metadata: Metadata = { title: "Tahsilatlar Raporu" };

export default function Page(props: PageProps<"/raporlar/tahsilatlar">) {
  return <CollectionsReportPage searchParams={props.searchParams} />;
}
