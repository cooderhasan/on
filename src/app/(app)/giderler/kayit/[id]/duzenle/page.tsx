import type { Metadata } from "next";
import { ExpenseFormPage } from "@/components/expense-views";

export const metadata: Metadata = { title: "Gideri düzenle" };

export default function Page(props: PageProps<"/giderler/kayit/[id]/duzenle">) {
  return <ExpenseFormPage params={props.params} />;
}
