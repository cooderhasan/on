import type { Metadata } from "next";
import { ContactDetailPage } from "@/components/contact-views";

export const metadata: Metadata = { title: "Tedarikçiler" };

export default function Page(props: PageProps<"/tedarikciler/[id]">) {
  return <ContactDetailPage kind="SUPPLIER" params={props.params} />;
}
