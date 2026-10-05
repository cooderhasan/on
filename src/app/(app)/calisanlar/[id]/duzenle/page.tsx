import type { Metadata } from "next";
import { EmployeeFormPage } from "@/components/expense-views";

export const metadata: Metadata = { title: "Çalışanı düzenle" };

export default function Page(props: PageProps<"/calisanlar/[id]/duzenle">) {
  return <EmployeeFormPage params={props.params} />;
}
