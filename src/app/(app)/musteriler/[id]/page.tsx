import type { Metadata } from "next";
import { ContactDetailPage } from "@/components/contact-views";

export const metadata: Metadata = { title: "Müşteriler" };

export default function Page(props: PageProps<"/musteriler/[id]">) {
  return <ContactDetailPage kind="CUSTOMER" params={props.params} />;
}
