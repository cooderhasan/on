import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Gider Listesi" };

export default async function Page() {
  await requireUser();
  return <ComingSoon title="Gider Listesi" phase={4} />;
}
