import type { Metadata } from "next";
import { AccountPage } from "@/components/user-views";

export const metadata: Metadata = { title: "Hesabım" };

export default function Page() {
  return <AccountPage />;
}
