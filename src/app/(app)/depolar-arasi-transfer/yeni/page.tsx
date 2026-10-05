import type { Metadata } from "next";
import { TransferFormPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Yeni transfer" };

export default function Page() {
  return <TransferFormPage />;
}
