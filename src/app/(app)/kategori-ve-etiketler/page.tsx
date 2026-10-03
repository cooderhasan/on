import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Kategori ve Etiketler" };

export default async function Page() {
  await requireUser();
  return <ComingSoon title="Kategori ve Etiketler" phase={1} />;
}
