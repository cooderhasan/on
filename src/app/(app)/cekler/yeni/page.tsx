import type { Metadata } from "next";
import { ChequeFormPage } from "@/components/cheque-views";

export const metadata: Metadata = { title: "Yeni çek" };

export default function Page(props: PageProps<"/cekler/yeni">) {
  return <ChequeFormPage searchParams={props.searchParams} />;
}
