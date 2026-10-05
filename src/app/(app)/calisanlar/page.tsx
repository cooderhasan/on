import type { Metadata } from "next";
import { EmployeeListPage } from "@/components/expense-views";

export const metadata: Metadata = { title: "Çalışanlar" };

export default function Page(props: PageProps<"/calisanlar">) {
  return <EmployeeListPage searchParams={props.searchParams} />;
}
