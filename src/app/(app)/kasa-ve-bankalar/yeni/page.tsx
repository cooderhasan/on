import type { Metadata } from "next";
import { AccountFormPage } from "@/components/account-views";

export const metadata: Metadata = { title: "Yeni hesap · Kasa ve Bankalar" };

export default function Page(props: PageProps<"/kasa-ve-bankalar/yeni">) {
  return <AccountFormPage searchParams={props.searchParams} />;
}
