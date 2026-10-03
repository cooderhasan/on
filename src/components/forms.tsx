"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { Alert, Button } from "./ui";
import { cn } from "@/lib/cn";

/** ActionForm içindeki gönderim durumu (useFormStatus, onSubmit ile gönderimde çalışmaz) */
const PendingContext = createContext<boolean | null>(null);

/** Sayfa hidrasyonu tamamlandı mı (öncesinde form React tarafından yönetilmez) */
const subscribe = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribe, () => true, () => false);

export function SubmitButton({ children, pendingText, variant = "primary", className }: { children: ReactNode; pendingText?: string; variant?: "primary" | "accent" | "success" | "danger"; className?: string }) {
  const ctx = useContext(PendingContext);
  const status = useFormStatus();
  const pending = ctx ?? status.pending;
  // JS yüklenmeden basılırsa form tarayıcının varsayılanıyla gönderilirdi → yüklenene kadar pasif
  const hydrated = useHydrated();
  return (
    <Button type="submit" variant={variant} disabled={pending || !hydrated} className={className}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

/**
 * Server action formu. `action` prop'u yerine onSubmit ile gönderir: React 19 form action'ı, sunucu hata
 * döndürse bile formu sıfırlar ve kullanıcının yazdıkları kaybolur. Böylece hata durumunda alanlar korunur.
 */
export function ActionForm({ action, children, className, resetOnSuccess = false }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; children: (state: ActionState) => ReactNode; className?: string; resetOnSuccess?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      // Güvenlik: JS'siz / hidrasyon öncesi gönderimde alanlar (şifre!) adres çubuğuna yazılmasın
      method="post"
      className={cn("flex flex-col gap-4", className)}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      <PendingContext.Provider value={pending}>{children(state)}</PendingContext.Provider>
    </form>
  );
}
