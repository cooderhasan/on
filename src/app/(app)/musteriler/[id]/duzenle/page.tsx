import type { Metadata } from "next";
import { ContactFormPage } from "@/components/contact-views";

export const metadata: Metadata = { title: "Düzenle · Müşteriler" };

export default function Page(props: PageProps<"/musteriler/[id]/duzenle">) {
  return <ContactFormPage kind="CUSTOMER" params={props.params} />;
}
