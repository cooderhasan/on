import { LogOut } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { ROLE_LABELS } from "@/server/auth/permissions";
import { getCompanyName } from "@/server/company";
import { Sidebar } from "@/components/sidebar";
import Link from "next/link";
import { NAV, NAV_SETTINGS, navFor } from "@/lib/nav";
import { logoutAction } from "@/app/actions/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const companyName = await getCompanyName();
  return (
    <div className="flex min-h-dvh">
      <Sidebar groups={navFor(user.role, NAV)} settings={navFor(user.role, [NAV_SETTINGS])[0] ?? NAV_SETTINGS} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-end gap-3 px-4 pl-16 lg:px-6">
          <Link href="/hesabim" className="min-w-0 text-right leading-tight hover:opacity-80" title="Hesabım">
            <p className="truncate text-sm text-text">{user.name}</p>
            <p className="truncate text-[11px] uppercase text-text-2">
              {companyName ?? "Firma bilgisi girilmedi"} · {ROLE_LABELS[user.role]}
            </p>
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="grid size-9 place-items-center rounded-full bg-card text-text-2 hover:text-danger" title="Çıkış yap" aria-label="Çıkış yap">
              <LogOut className="size-4" />
            </button>
          </form>
        </header>
        <main className="flex-1 px-4 pb-24 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
