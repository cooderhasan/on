import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Satışlar Raporu" };

export default async function Page() {
  await requireUser();
  return <ComingSoon title="Satışlar Raporu" phase={6} />;
}
