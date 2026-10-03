import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Gelen e-Faturalar" };

export default async function Page() {
  await requireUser();
  return <ComingSoon title="Gelen e-Faturalar" phase={4} />;
}
