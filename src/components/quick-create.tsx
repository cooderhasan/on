"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";

export interface QuickItem { href: string; label: string }

/** Paraşüt'teki altta ortada duran "+" hızlı oluştur menüsü (öğeler role göre sunucuda süzülür) */
export function QuickCreate({ items }: { items: QuickItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Sayfa değişince menü kapanır
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  if (!items.length) return null;
  return (
    <div ref={ref} className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 print:hidden">
      {open && (
        <ul className="absolute bottom-14 left-1/2 w-56 -translate-x-1/2 overflow-hidden rounded border border-border bg-white py-1 text-sm shadow-lg">
          {items.map((i) => (
            <li key={i.href}><Link href={i.href} className="block px-4 py-2 hover:bg-card-muted">{i.label}</Link></li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Hızlı oluştur"
        title="Hızlı oluştur"
        className={cn("grid size-12 place-items-center rounded-full text-white shadow-lg transition-colors", open ? "bg-text" : "bg-accent hover:bg-primary")}
      >
        {open ? <X className="size-5" /> : <Plus className="size-6" />}
      </button>
    </div>
  );
}
