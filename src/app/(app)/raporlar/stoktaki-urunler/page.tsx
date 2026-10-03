import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Stoktaki Ürünler Raporu" };

export default async function Page() {
  await requireUser();
  return <ComingSoon title="Stoktaki Ürünler Raporu" phase={6} />;
}
