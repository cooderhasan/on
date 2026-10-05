import type { Metadata } from "next";
import { WarehouseFormPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Depoyu düzenle" };

export default function Page(props: PageProps<"/depolar/[id]/duzenle">) {
  return <WarehouseFormPage params={props.params} />;
}
