import type { Metadata } from "next";
import { ExpenseListPage } from "@/components/expense-views";

export const metadata: Metadata = { title: "Gider Listesi" };

export default function Page(props: PageProps<"/giderler">) {
  return <ExpenseListPage searchParams={props.searchParams} />;
}
