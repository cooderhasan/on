import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

// ── Düğmeler (Paraşüt: büyük harf, küçük punto, köşeleri hafif yuvarlak) ──
type Variant = "primary" | "secondary" | "accent" | "success" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "border border-border bg-card text-text-2 hover:bg-card-muted",
  accent: "bg-accent text-white hover:brightness-95",
  success: "bg-success text-white hover:brightness-95",
  danger: "bg-danger text-white hover:brightness-95",
  ghost: "text-text-2 hover:bg-card-muted",
};
export function buttonClass(variant: Variant = "primary", size: "sm" | "md" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded font-semibold uppercase tracking-wide transition-colors disabled:opacity-60 disabled:pointer-events-none",
    size === "sm" ? "h-8 px-3 text-[11px]" : "h-9 px-4 text-xs",
    variants[variant],
  );
}
export function Button({ variant, size, className, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md" }) {
  return <button className={cn(buttonClass(variant, size), className)} {...props} />;
}
export function LinkButton({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" | "md" }) {
  return <Link className={cn(buttonClass(variant, size), className)} {...props} />;
}

// ── Kartlar ──
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded bg-card shadow-sm", className)} {...props} />;
}
export function CardHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-border px-4 py-3", className)}>
      <h2 className="text-[15px] font-normal text-text">{title}</h2>
      {action}
    </div>
  );
}

// ── Sayfa başlığı (breadcrumb: "Müşteriler › Yeni") ──
export function PageHeader({ title, parent, actions }: { title: string; parent?: { href: string; label: string }; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-light text-text sm:text-[22px]">
        {parent && (
          <>
            <Link href={parent.href} className="text-text-3 hover:text-text-2">{parent.label}</Link>
            <span className="mx-2 text-text-3">›</span>
          </>
        )}
        {title}
      </h1>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Form alanları ──
const fieldBase =
  "w-full rounded-sm border border-[#d6d6d6] bg-white px-2.5 text-sm text-text placeholder:text-text-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-card-muted";
export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldBase, "h-9", className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldBase, "py-2", className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(fieldBase, "h-9", className)} {...props} />;
}

/** Paraşüt form satırı: solda ikon + büyük harf etiket, sağda alan */
export function FormRow({ label, htmlFor, icon, hint, error, children }: { label: string; htmlFor?: string; icon?: ReactNode; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 px-4 py-2.5 sm:grid-cols-[200px_minmax(0,540px)] sm:gap-6">
      <label htmlFor={htmlFor} className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-2 sm:pt-2.5 sm:items-start">
        <span className="w-4 text-text-3 [&>svg]:size-3.5">{icon}</span>
        {label}
      </label>
      <div>
        {children}
        {hint && !error && <p className="mt-1 text-[11px] italic text-text-3">{hint}</p>}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}

export function Alert({ tone = "info", className, ...props }: ComponentProps<"div"> & { tone?: "info" | "success" | "danger" | "warning" }) {
  const tones = {
    info: "border-accent/30 bg-accent/5 text-text",
    success: "border-success/30 bg-success/10 text-text",
    danger: "border-danger/40 bg-danger/10 text-text",
    warning: "border-warning/40 bg-warning/10 text-text",
  };
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded border px-3 py-2 text-sm", tones[tone], className)} {...props} />;
}

// ── Tablo ──
export function Th({ className, ...props }: ComponentProps<"th">) {
  return <th className={cn("px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-text-3", className)} {...props} />;
}
export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-base text-text">{title}</p>
      {description && <p className="max-w-md text-sm text-text-3">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
