import type { Metadata } from "next";
import { WaybillFormPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "İrsaliyeyi düzenle" };

export default function Page(props: PageProps<"/gelen-irsaliyeler/[id]/duzenle">) {
  return <WaybillFormPage direction="PURCHASE" params={props.params} />;
}
