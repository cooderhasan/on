import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { Card, EmptyState, LinkButton } from "@/components/ui";

export const metadata: Metadata = { title: "Yetkiniz yok" };

/** requireUser(izin) yetkisiz kullanıcıyı buraya yönlendirir */
export default async function Page() {
  await requireUser();
  return (
    <Card className="mt-4">
      <EmptyState title="Bu sayfa için yetkiniz yok" description="Erişim gerekiyorsa yöneticinize başvurun." action={<LinkButton href="/" variant="secondary">Güncel Durum&apos;a dön</LinkButton>} />
    </Card>
  );
}
