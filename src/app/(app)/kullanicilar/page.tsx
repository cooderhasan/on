import type { Metadata } from "next";
import { UserListPage } from "@/components/user-views";

export const metadata: Metadata = { title: "Kullanıcılar" };

export default function Page() {
  return <UserListPage />;
}
