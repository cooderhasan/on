import type { Metadata } from "next";
import { ContactFormPage } from "@/components/contact-views";

export const metadata: Metadata = { title: "Düzenle · Tedarikçiler" };

export default function Page(props: PageProps<"/tedarikciler/[id]/duzenle">) {
  return <ContactFormPage kind="SUPPLIER" params={props.params} />;
}
