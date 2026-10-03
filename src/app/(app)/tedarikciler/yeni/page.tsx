import type { Metadata } from "next";
import { ContactFormPage } from "@/components/contact-views";

export const metadata: Metadata = { title: "Yeni · Tedarikçiler" };

export default function Page() {
  return <ContactFormPage kind="SUPPLIER" />;
}
