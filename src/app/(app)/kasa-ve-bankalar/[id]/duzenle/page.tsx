import type { Metadata } from "next";
import { AccountFormPage } from "@/components/account-views";

export const metadata: Metadata = { title: "Düzenle · Kasa ve Bankalar" };

export default function Page(props: PageProps<"/kasa-ve-bankalar/[id]/duzenle">) {
  return <AccountFormPage params={props.params} />;
}
