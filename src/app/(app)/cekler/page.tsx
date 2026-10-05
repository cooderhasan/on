import type { Metadata } from "next";
import { ChequeListPage } from "@/components/cheque-views";

export const metadata: Metadata = { title: "Çekler" };

export default function Page(props: PageProps<"/cekler">) {
  return <ChequeListPage searchParams={props.searchParams} />;
}
