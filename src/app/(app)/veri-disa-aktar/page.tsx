import type { Metadata } from "next";
import { DataExportPage } from "@/components/user-views";

export const metadata: Metadata = { title: "Yedek ve Dışa Aktarma" };

export default function Page() {
  return <DataExportPage />;
}
