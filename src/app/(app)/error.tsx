"use client";

import { Card, EmptyState, Button } from "@/components/ui";

/** Beklenmeyen hata / yetkisiz işlem: menü yerinde kalır, kullanıcı tekrar deneyebilir. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = error.message.includes("yetkiniz yok");
  return (
    <Card className="mt-4">
      <EmptyState
        title={forbidden ? "Bu sayfa için yetkiniz yok" : "Bir şeyler ters gitti"}
        description={forbidden ? "Erişim gerekiyorsa yöneticinize başvurun." : "Sayfa yüklenirken hata oluştu. Tekrar deneyin; sorun sürerse yöneticinize bildirin."}
        action={!forbidden ? <Button variant="secondary" onClick={reset}>Tekrar dene</Button> : undefined}
      />
    </Card>
  );
}
