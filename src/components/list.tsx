import Link from "next/link";
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";

/** Paraşüt liste üstü: gri çubukta arama (+ isteğe bağlı filtreler) — GET formu, sonuç URL'de */
export function ListToolbar({ action, q, placeholder = "Ara…", hidden, filters, actions }: { action: string; q?: string; placeholder?: string; hidden?: Record<string, string | undefined>; filters?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <form action={action} className="flex min-w-0 flex-1 items-center gap-2 rounded bg-[#d4d4d4] p-1.5">
        {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        {filters}
        <div className="relative min-w-40 flex-1">
          <input name="q" defaultValue={q} placeholder={placeholder} aria-label="Ara" className="h-8 w-full rounded-sm bg-[#e4e4e4] px-2.5 pr-8 text-sm placeholder:text-text-3 focus:bg-white focus:outline-none" />
          <button type="submit" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-3" aria-label="Ara">
            <Search className="size-4" />
          </button>
        </div>
      </form>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Liste altı: kayıt sayısı + sayfalama + (isteğe bağlı) toplamlar */
export function ListFooter({ total, page, pages, href, summary }: { total: number; page: number; pages: number; href: (p: number) => string; summary?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-text-2">
      <div className="flex items-center gap-1">
        {pages > 1 &&
          Array.from({ length: pages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 2)
            .map((p, i, arr) => (
              <span key={p} className="flex items-center gap-1">
                {i > 0 && p - arr[i - 1]! > 1 && <span className="px-1">…</span>}
                <Link href={href(p)} aria-current={p === page ? "page" : undefined} className={cn("grid size-7 place-items-center rounded-sm", p === page ? "bg-primary text-white" : "bg-card hover:bg-card-muted")}>
                  {p}
                </Link>
              </span>
            ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span>{total} kayıt</span>
        {summary}
      </div>
    </div>
  );
}

export function CategoryBadge({ category }: { category: { name: string; color: string } | null }) {
  if (!category) return <span className="rounded-sm bg-[#bdbdbd] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Kategorisiz</span>;
  return (
    <span className="rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white" style={{ background: category.color }}>
      {category.name}
    </span>
  );
}

/** Detay sayfası bilgi satırı (Paraşüt firma bilgileri görünümü) */
export function InfoRow({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-2 sm:grid-cols-[200px_1fr] sm:gap-6">
      <dt className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-2">
        <span className="w-4 text-text-3 [&>svg]:size-3.5">{icon}</span>
        {label}
      </dt>
      <dd className="text-sm text-text">{children || <span className="text-text-3">—</span>}</dd>
    </div>
  );
}

export function buildHref(base: string, params: Record<string, string | number | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}
