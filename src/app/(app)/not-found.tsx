import { Card, EmptyState, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <Card className="mt-4">
      <EmptyState title="Kayıt bulunamadı" description="Aradığınız kayıt silinmiş veya adres hatalı olabilir." action={<LinkButton href="/" variant="secondary">Güncel Durum&apos;a dön</LinkButton>} />
    </Card>
  );
}
