import type { Metadata } from "next";
import { EmployeeDetailPage } from "@/components/expense-views";

export const metadata: Metadata = { title: "Çalışan" };

export default function Page(props: PageProps<"/calisanlar/[id]">) {
  return <EmployeeDetailPage params={props.params} />;
}
