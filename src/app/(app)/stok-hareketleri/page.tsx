import type { Metadata } from "next";
import { MovementListPage } from "@/components/stock-views";

export const metadata: Metadata = { title: "Stok Geçmişi" };

export default function Page(props: PageProps<"/stok-hareketleri">) {
  return <MovementListPage searchParams={props.searchParams} />;
}
