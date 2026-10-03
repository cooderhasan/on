import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Yazdırma Şablonları" };

export default async function Page() {
  await requireUser();
  return <ComingSoon title="Yazdırma Şablonları" phase={6} />;
}
