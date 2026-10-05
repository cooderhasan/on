import type { Metadata } from "next";
import { ExpenseFormPage } from "@/components/expense-views";

export const metadata: Metadata = { title: "Yeni gider" };

export default function Page(props: PageProps<"/giderler/kayit/yeni">) {
  return <ExpenseFormPage searchParams={props.searchParams} />;
}
