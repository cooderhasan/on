import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Kasa ve Bankalar" };

export default async function Page() {
  await requireUser();
  return <ComingSoon title="Kasa ve Bankalar" phase={1} />;
}
