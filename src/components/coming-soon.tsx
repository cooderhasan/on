import { Card, EmptyState, PageHeader } from "./ui";

const PHASE_LABELS: Record<number, string> = {
  1: "Faz 1 — temel kayıtlar",
  2: "Faz 2 — satış ve tahsilat",
  3: "Faz 3 — e-Fatura / e-Arşiv (NES)",
  4: "Faz 4 — giderler ve gelen e-faturalar",
  5: "Faz 5 — stok, irsaliye, çek",
  6: "Faz 6 — raporlar ve güncel durum",
  7: "Faz 7 — kullanıcılar ve canlıya alma",
};

/** Henüz geliştirilmemiş modül: menü ve yönlendirme çalışır, içerik ilgili fazda gelir. */
export function ComingSoon({ title, phase }: { title: string; phase: number }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState title="Bu ekran henüz hazır değil" description={`${PHASE_LABELS[phase] ?? `Faz ${phase}`} kapsamında geliştirilecek.`} />
      </Card>
    </>
  );
}
