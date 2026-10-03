import type { Metadata } from "next";
import { ContactListPage } from "@/components/contact-views";

export const metadata: Metadata = { title: "Tedarikçiler" };

export default function Page(props: PageProps<"/tedarikciler">) {
  return <ContactListPage kind="SUPPLIER" searchParams={props.searchParams} />;
}
