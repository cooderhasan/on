import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Ödemeler Raporu" };

export default async function Page() {
  await requireUser();
  return <ComingSoon title="Ödemeler Raporu" phase={6} />;
}
