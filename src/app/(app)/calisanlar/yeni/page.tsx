import type { Metadata } from "next";
import { EmployeeFormPage } from "@/components/expense-views";

export const metadata: Metadata = { title: "Yeni çalışan" };

export default function Page() {
  return <EmployeeFormPage />;
}
