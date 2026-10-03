import type { Metadata } from "next";
import { QuoteFormPage } from "@/components/quote-views";

export const metadata: Metadata = { title: "Yeni teklif" };

export default function Page() {
  return <QuoteFormPage />;
}
