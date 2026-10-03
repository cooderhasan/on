import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "e-Fatura Ayarları (NES)" };

export default async function Page() {
  await requireUser();
  return <ComingSoon title="e-Fatura Ayarları (NES)" phase={3} />;
}
