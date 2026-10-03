import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Giden İrsaliyeler" };

export default async function Page() {
  await requireUser();
  return <ComingSoon title="Giden İrsaliyeler" phase={5} />;
}
