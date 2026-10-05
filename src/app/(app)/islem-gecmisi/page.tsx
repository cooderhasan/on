import type { Metadata } from "next";
import { AuditPage } from "@/components/user-views";

export const metadata: Metadata = { title: "İşlem Geçmişi" };

export default function Page(props: PageProps<"/islem-gecmisi">) {
  return <AuditPage searchParams={props.searchParams} />;
}
