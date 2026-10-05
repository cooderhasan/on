import Link from "next/link";
import { cookies } from "next/headers";
import { Download, ShieldCheck, User as UserIcon } from "lucide-react";
import type { UserRole } from "@/generated/prisma/enums";
import { requireUser, hashToken, SESSION_COOKIE } from "@/server/auth/session";
import { ROLE_LABELS } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { getUser, listAudit, listOwnSessions, listUsers } from "@/server/services/users";
import { orNotFound, pageParam, strParam } from "@/server/page-helpers";
import { AUDIT_GROUPS, auditLabel } from "@/lib/audit-labels";
import { buttonClass, Card, CardHeader, EmptyState, LinkButton, PageHeader, Td, Th } from "./ui";
import { buildHref, InfoRow, ListFooter } from "./list";
import { CloseSessionsButton, OwnNameForm, OwnPasswordForm, PasswordResetForm, UserCreateForm, UserEditForm } from "./user-forms";
import { cn } from "@/lib/cn";

type SP = Record<string, string | string[] | undefined>;
const dt = (d: Date) => d.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Tarayıcı adını kısaca (oturum listesi) */
function agent(ua: string | null) {
  if (!ua) return "Bilinmeyen cihaz";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Tarayıcı";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" · ");
}

const RoleBadge = ({ role }: { role: UserRole }) => (
  <span className={cn("rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white", role === "ADMIN" ? "bg-danger" : role === "ACCOUNTANT" ? "bg-accent" : role === "SALES" ? "bg-teal" : "bg-text-3")}>{ROLE_LABELS[role]}</span>
);

// ── Kullanıcılar ───────────────────────────────────────────

export async function UserListPage() {
  const user = await requireUser("users.manage");
  const rows = await listUsers(user);
  return (
    <>
      <PageHeader title="Kullanıcılar" actions={<LinkButton href="/kullanicilar/yeni">Kullanıcı ekle</LinkButton>} />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="border-b border-border"><tr><Th>Ad soyad</Th><Th>Rol</Th><Th>Son giriş</Th><Th className="text-right">Açık oturum</Th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((u) => (
                <tr key={u.id} className={cn("hover:bg-card-muted", !u.isActive && "opacity-60")}>
                  <Td>
                    <Link href={`/kullanicilar/${u.id}`} className="font-medium hover:text-accent">{u.name}</Link>
                    {u.id === user.id && <span className="ml-2 text-[11px] text-text-3">(siz)</span>}
                    <p className="text-xs text-text-3">{u.email}{!u.isActive && " · pasif"}</p>
                  </Td>
                  <Td><RoleBadge role={u.role} /></Td>
                  <Td className="whitespace-nowrap text-text-2">{u.lastLoginAt ? dt(u.lastLoginAt) : "—"}</Td>
                  <Td className="text-right">{u._count.sessions}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ListFooter total={rows.length} page={1} pages={1} href={() => "/kullanicilar"} summary={<Link href="/islem-gecmisi" className="text-accent hover:underline">İşlem geçmişi</Link>} />
      </Card>
    </>
  );
}

export async function UserNewPage() {
  await requireUser("users.manage");
  return (
    <>
      <PageHeader title="Yeni kullanıcı" parent={{ href: "/kullanicilar", label: "Kullanıcılar" }} />
      <Card><UserCreateForm /></Card>
    </>
  );
}

export async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser("users.manage");
  const u = await orNotFound(getUser(me, (await params).id));
  return (
    <>
      <PageHeader title={u.name} parent={{ href: "/kullanicilar", label: "Kullanıcılar" }} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
            <h2 className="flex items-center gap-3 text-lg text-text"><UserIcon className="size-7 text-text-3" /> {u.name}</h2>
            <RoleBadge role={u.role} />
          </div>
          <dl className="border-b border-border py-3">
            <InfoRow label="E-posta">{u.email}</InfoRow>
            <InfoRow label="Son giriş">{u.lastLoginAt ? dt(u.lastLoginAt) : null}</InfoRow>
            <InfoRow label="Eklendi">{dt(u.createdAt)}</InfoRow>
          </dl>
          <UserEditForm id={u.id} name={u.name} role={u.role} isActive={u.isActive} self={u.id === me.id} />
        </Card>
        <aside className="flex flex-col gap-4">
          {u.id !== me.id && (
            <Card className="p-4">
              <p className="mb-2 text-[11px] font-semibold uppercase text-text-2">Şifre belirle</p>
              <PasswordResetForm id={u.id} />
            </Card>
          )}
          <LinkButton href={buildHref("/islem-gecmisi", { kullanici: u.id })} variant="secondary">Bu kullanıcının işlemleri</LinkButton>
        </aside>
      </div>
    </>
  );
}

// ── Hesabım ────────────────────────────────────────────────

export async function AccountPage() {
  const user = await requireUser();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const current = token ? hashToken(token) : null;
  const sessions = await listOwnSessions(user);
  return (
    <>
      <PageHeader title="Hesabım" />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Bilgilerim" />
          <dl className="py-3">
            <InfoRow label="E-posta">{user.email}</InfoRow>
            <InfoRow label="Rol"><RoleBadge role={user.role} /></InfoRow>
          </dl>
          <div className="border-t border-border p-4"><p className="mb-2 text-[11px] font-semibold uppercase text-text-2">Ad soyad</p><OwnNameForm name={user.name} /></div>
        </Card>
        <Card>
          <CardHeader title="Şifre değiştir" />
          <div className="p-4"><OwnPasswordForm /></div>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Açık oturumlar" />
          <ul className="divide-y divide-border">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span>{agent(s.userAgent)}{s.tokenHash === current && <span className="ml-2 rounded-sm bg-success px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Bu cihaz</span>}</span>
                <span className="text-xs text-text-3">{dt(s.createdAt)}{s.ip ? ` · ${s.ip}` : ""}</span>
              </li>
            ))}
          </ul>
          {sessions.length > 1 && <div className="border-t border-border p-4"><CloseSessionsButton /></div>}
        </Card>
      </div>
    </>
  );
}

// ── İşlem geçmişi ──────────────────────────────────────────

export async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("users.manage");
  const sp = await searchParams;
  const userId = strParam(sp.kullanici);
  const group = strParam(sp.grup);
  const [{ rows, total, page, pages }, users] = await Promise.all([
    listAudit(user, { userId, action: group ? `${group}.` : undefined, page: pageParam(sp.sayfa) }),
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const sel = "h-8 rounded-sm bg-[#e4e4e4] px-2 text-xs";
  return (
    <>
      <PageHeader title="İşlem Geçmişi" />
      <form action="/islem-gecmisi" className="mb-3 flex flex-wrap items-center gap-2 rounded bg-[#d4d4d4] p-1.5">
        <select name="kullanici" defaultValue={userId ?? ""} aria-label="Kullanıcı" className={sel}>
          <option value="">Tüm kullanıcılar</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select name="grup" defaultValue={group ?? ""} aria-label="İşlem türü" className={sel}>
          <option value="">Tüm işlemler</option>
          {Object.entries(AUDIT_GROUPS).filter(([k]) => k !== "tag").map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button type="submit" className={buttonClass("secondary", "sm")}>Filtrele</button>
      </form>
      <Card>
        {rows.length === 0 ? <EmptyState title="Kayıt yok" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="border-b border-border"><tr><Th>Zaman</Th><Th>Kullanıcı</Th><Th>İşlem</Th><Th>Ayrıntı</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap text-text-2">{dt(r.createdAt)}</Td>
                    <Td>{r.user?.name ?? <span className="text-text-3">—</span>}</Td>
                    <Td className={cn(r.action === "auth.login_failed" && "text-danger")}>{auditLabel(r.action)}</Td>
                    <Td className="max-w-72 truncate font-mono text-[11px] text-text-3" title={r.metadata ? JSON.stringify(r.metadata) : undefined}>
                      {r.metadata ? JSON.stringify(r.metadata) : ""}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListFooter total={total} page={page} pages={pages} href={(p) => buildHref("/islem-gecmisi", { kullanici: userId, grup: group, sayfa: p > 1 ? p : undefined })} />
      </Card>
    </>
  );
}

// ── Yedek ve dışa aktarma ──────────────────────────────────

export async function DataExportPage() {
  await requireUser("users.manage");
  return (
    <>
      <PageHeader title="Yedek ve Dışa Aktarma" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Tüm veriler (Excel)" />
          <div className="flex flex-col gap-3 p-4 text-sm text-text-2">
            <p>Müşteriler, tedarikçiler, ürünler, satış ve alış faturaları (satırlarıyla), giderler, kasa / banka hareketleri ve çekler tek Excel dosyasında. Mali müşavirinize göndermek veya arşiv için.</p>
            {/* Dosya indirme: istemci tarafı gezinme (Link) değil, düz bağlantı */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/api/disa-aktar/tum-veriler" className={cn(buttonClass("accent"), "self-start")}><Download className="size-3.5" /> Excel olarak indir</a>
          </div>
        </Card>
        <Card>
          <CardHeader title="Veritabanı yedeği" />
          <div className="flex flex-col gap-2 p-4 text-sm text-text-2">
            <p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /> Asıl yedek veritabanı yedeğidir: tüm kayıtları birebir geri yükler.</p>
            <ul className="ml-6 list-disc text-xs">
              <li>Sunucuda (Coolify): PostgreSQL servisinde <b>Backups</b> sekmesinden günlük zamanlanmış yedek açın (S3 / harici depolama önerilir).</li>
              <li>Yerelde: proje klasöründeki <code>yedek-al.bat</code> <code>yedekler/</code> klasörüne SQL yedeği alır.</li>
              <li>ENCRYPTION_KEY değerini de güvenli bir yerde saklayın; o olmadan yedekteki NES anahtarı çözülemez.</li>
            </ul>
          </div>
        </Card>
      </div>
    </>
  );
}
