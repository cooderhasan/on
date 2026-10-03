"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  Menu,
  Package,
  Settings,
  X,
} from "lucide-react";
import { activeGroupKey, type NavGroup } from "@/lib/nav";
import { cn } from "@/lib/cn";

const ICONS: Record<NavGroup["icon"], React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  sales: ArrowDownToLine,
  expenses: ArrowUpFromLine,
  cash: Banknote,
  stock: Package,
  settings: Settings,
};

const COLLAPSE_KEY = "menu-dar";

export function Sidebar({ groups, settings }: { groups: NavGroup[]; settings: NavGroup }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(() => activeGroupKey(pathname));
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Daraltılmış menü tercihi bu tarayıcıda hatırlanır
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage yalnızca istemcide okunabilir
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* depolama kapalı */
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sayfa değişince mobil menü kapanır
    setMobileOpen(false);
    const g = activeGroupKey(pathname);
    if (g) setOpen(g);
  }, [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* depolama kapalı */
      }
      return !c;
    });
  };

  const renderGroup = (g: NavGroup) => {
    const Icon = ICONS[g.icon];
    const isActive = g.href ? pathname === g.href : activeGroupKey(pathname) === g.key;
    const isOpen = open === g.key;
    const head = (
      <>
        <Icon className="size-[18px] shrink-0" />
        {!collapsed && <span className="flex-1 truncate">{g.label}</span>}
        {!collapsed && g.children && <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />}
      </>
    );
    const headClass = cn(
      "flex h-11 w-full items-center gap-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wide transition-colors",
      isActive ? "text-white" : "text-sidebar-text hover:bg-sidebar-hover hover:text-white",
      collapsed && "justify-center px-0",
    );
    return (
      <li key={g.key} className="border-b border-black/20">
        {g.href ? (
          <Link href={g.href} className={headClass} title={collapsed ? g.label : undefined}>
            {head}
          </Link>
        ) : (
          <button
            type="button"
            className={headClass}
            aria-expanded={isOpen}
            title={collapsed ? g.label : undefined}
            onClick={() => {
              if (collapsed) toggleCollapsed();
              setOpen(isOpen ? null : g.key);
            }}
          >
            {head}
          </button>
        )}
        {g.children && isOpen && !collapsed && (
          <ul className="bg-sidebar-sub pb-2">
            {g.children.map((c) => {
              const active = pathname === c.href || pathname.startsWith(`${c.href}/`);
              return (
                <li key={c.href}>
                  <Link
                    href={c.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block py-1.5 pl-[50px] pr-3 text-xs transition-colors",
                      active ? "font-semibold text-white" : "text-sidebar-text hover:text-white",
                    )}
                  >
                    {c.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  const nav = (
    <nav aria-label="Ana menü" className="flex h-full flex-col">
      <Link href="/" className={cn("flex h-16 shrink-0 items-center gap-2 px-4 text-white", collapsed && "justify-center px-0")}>
        <span className="grid size-8 place-items-center rounded-full bg-danger text-sm font-bold">Ö</span>
        {!collapsed && <span className="text-sm font-semibold tracking-wide">Ön Muhasebe</span>}
      </Link>
      <ul className="flex-1 overflow-y-auto">{groups.map(renderGroup)}</ul>
      <ul className="border-t border-black/30">
        <li className="hidden border-b border-black/20 lg:block">
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(
              "flex h-10 w-full items-center gap-3 px-4 text-[11px] font-semibold uppercase tracking-wide text-sidebar-text hover:text-white",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            {!collapsed && "Menüyü sakla"}
          </button>
        </li>
        {renderGroup(settings)}
      </ul>
    </nav>
  );

  return (
    <>
      {/* Mobil: üst çubukta menü düğmesi */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-30 grid size-10 place-items-center rounded bg-sidebar text-white shadow lg:hidden"
        aria-label="Menüyü aç"
      >
        <Menu className="size-5" />
      </button>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-sidebar shadow-xl">
            <button type="button" onClick={() => setMobileOpen(false)} className="absolute right-2 top-4 p-1 text-sidebar-text" aria-label="Menüyü kapat">
              <X className="size-5" />
            </button>
            {nav}
          </aside>
        </div>
      )}
      <aside className={cn("sticky top-0 hidden h-dvh shrink-0 bg-sidebar transition-[width] lg:block", collapsed ? "w-[60px]" : "w-[200px]")}>{nav}</aside>
    </>
  );
}
