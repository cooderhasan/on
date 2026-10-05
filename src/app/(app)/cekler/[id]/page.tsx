import type { Metadata } from "next";
import { ChequeDetailPage } from "@/components/cheque-views";

export const metadata: Metadata = { title: "Çek" };

export default function Page(props: PageProps<"/cekler/[id]">) {
  return <ChequeDetailPage params={props.params} />;
}
