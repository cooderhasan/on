import type { Metadata } from "next";
import { AccountDetailPage } from "@/components/account-views";

export const metadata: Metadata = { title: "Kasa ve Bankalar" };

export default function Page(props: PageProps<"/kasa-ve-bankalar/[id]">) {
  return <AccountDetailPage params={props.params} />;
}
