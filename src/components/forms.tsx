"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { Alert, Button } from "./ui";
import { cn } from "@/lib/cn";

export function SubmitButton({ children, pendingText, variant = "primary", className }: { children: ReactNode; pendingText?: string; variant?: "primary" | "accent" | "success" | "danger"; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} className={className}>
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

/** Server action formu; alan hataları render prop ile alanlara dağıtılır. */
export function ActionForm({ action, children, className }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; children: (state: ActionState) => ReactNode; className?: string }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={cn("flex flex-col gap-4", className)} noValidate>
      {children(state)}
    </form>
  );
}
