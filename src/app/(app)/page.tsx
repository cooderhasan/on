import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/ui";
import { Dashboard } from "@/components/dashboard";

export const metadata: Metadata = { title: "Güncel Durum" };

export default async function DashboardPage() {
  const user = await requireUser("dashboard.read");
  return (
    <>
      <PageHeader title="Güncel Durum" />
      <Dashboard user={user} />
    </>
  );
}
