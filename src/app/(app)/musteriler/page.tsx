import type { Metadata } from "next";
import { ContactListPage } from "@/components/contact-views";

export const metadata: Metadata = { title: "Müşteriler" };

export default function Page(props: PageProps<"/musteriler">) {
  return <ContactListPage kind="CUSTOMER" searchParams={props.searchParams} />;
}
