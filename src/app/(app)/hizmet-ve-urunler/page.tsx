import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Hizmet ve Ürünler" };

export default async function Page() {
  await requireUser();
  return <ComingSoon title="Hizmet ve Ürünler" phase={1} />;
}
