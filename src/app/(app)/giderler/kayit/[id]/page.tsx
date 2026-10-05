import type { Metadata } from "next";
import { ExpenseDetailPage } from "@/components/expense-views";

export const metadata: Metadata = { title: "Gider" };

export default function Page(props: PageProps<"/giderler/kayit/[id]">) {
  return <ExpenseDetailPage params={props.params} />;
}
