import type { Metadata } from "next";
import { AccountListPage } from "@/components/account-views";

export const metadata: Metadata = { title: "Kasa ve Bankalar" };

export default function Page(props: PageProps<"/kasa-ve-bankalar">) {
  return <AccountListPage searchParams={props.searchParams} />;
}
