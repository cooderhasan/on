import type { Metadata } from "next";
import { UserNewPage } from "@/components/user-views";

export const metadata: Metadata = { title: "Yeni kullanıcı" };

export default function Page() {
  return <UserNewPage />;
}
