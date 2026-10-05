import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { UserRole } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/server/auth/session";
import { hashToken } from "@/server/auth/session";
import { verifyPassword } from "@/server/auth/password";
import { audit, SYSTEM_USER_ID } from "@/server/audit";
import {
  changeOwnPassword, closeOtherSessions, createUser, listAudit, listUsers, ownPasswordSchema, resetPassword, updateUser, userCreateSchema, userUpdateSchema,
} from "@/server/services/users";
import { runScheduledJobs } from "@/server/jobs";
import { EXPORTS } from "@/server/exports";
import { GET as cronGET } from "@/app/api/zamanlayici/route";
import { navFor, NAV, NAV_SETTINGS } from "@/lib/nav";
import { createFirstAdmin, setupSchema } from "@/server/auth/service";
import { auditLabel } from "@/lib/audit-labels";
import { resetDb } from "./helpers";

async function user(role: UserRole = "ADMIN"): Promise<CurrentUser> {
  const u = await db.user.create({ data: { email: `${role}-${Math.random()}@t.local`, name: role, passwordHash: "x:y", role } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, isActive: true };
}
const session = (userId: string, token: string) => db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000) } });
const upd = (o: Record<string, string>) => userUpdateSchema.parse({ name: "Ad Soyad", role: "ADMIN", isActive: "1", ...o });

beforeEach(resetDb);

describe("kullanıcı yönetimi", () => {
  it("yönetici kullanıcı ekler; aynı e-posta ikinci kez eklenemez; şifre kuralı uygulanır", async () => {
    const admin = await user();
    const u = await createUser(admin, userCreateSchema.parse({ name: "Ayşe", email: "Ayse@Firma.test", role: "SALES", password: "cok-gizli-123" }));
    expect(u.email).toBe("ayse@firma.test");
    await expect(createUser(admin, userCreateSchema.parse({ name: "Ayşe 2", email: "ayse@firma.test", role: "VIEWER", password: "cok-gizli-123" }))).rejects.toThrow(/kayıtlı bir kullanıcı/);
    expect(userCreateSchema.safeParse({ name: "X Y", email: "x@y.test", role: "VIEWER", password: "kisa" }).success).toBe(false);
    await expect(listUsers(await user("ACCOUNTANT"))).rejects.toThrow(/yetkiniz yok/);
  });

  it("son aktif yönetici düşürülemez; kendini pasifleştiremez; pasifleşen kullanıcının oturumları kapanır", async () => {
    const admin = await user();
    await expect(updateUser(admin, admin.id, upd({ role: "VIEWER" }))).rejects.toThrow(/En az bir aktif yönetici/);
    const admin2 = await user();
    await expect(updateUser(admin, admin.id, upd({ isActive: "0" }))).rejects.toThrow(/Kendi rolünüzü/);
    await session(admin2.id, "t-admin2");
    await updateUser(admin, admin2.id, upd({ role: "ACCOUNTANT", isActive: "0" }));
    expect(await db.session.count({ where: { userId: admin2.id } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: admin2.id } })).role).toBe("ACCOUNTANT");
  });

  it("şifre sıfırlama tüm oturumları kapatır; kendi şifresini değiştirmede mevcut oturum kalır", async () => {
    const admin = await user();
    const s = await user("SALES");
    await session(s.id, "a");
    await session(s.id, "b");
    await resetPassword(admin, s.id, "yepyeni-sifre-1");
    expect(await db.session.count({ where: { userId: s.id } })).toBe(0);
    expect(await verifyPassword("yepyeni-sifre-1", (await db.user.findUniqueOrThrow({ where: { id: s.id } })).passwordHash)).toBe(true);

    await session(s.id, "bu-cihaz");
    await session(s.id, "baska-cihaz");
    const input = (cur: string) => ownPasswordSchema.parse({ currentPassword: cur, password: "daha-da-yeni-2", passwordConfirm: "daha-da-yeni-2" });
    await expect(changeOwnPassword(s, input("yanlis"), hashToken("bu-cihaz"))).rejects.toThrow(/Mevcut şifre hatalı/);
    await changeOwnPassword(s, input("yepyeni-sifre-1"), hashToken("bu-cihaz"));
    expect((await db.session.findMany({ where: { userId: s.id } })).map((x) => x.tokenHash)).toEqual([hashToken("bu-cihaz")]);
    await session(s.id, "ucuncu");
    expect(await closeOtherSessions(s, hashToken("bu-cihaz"))).toBe(1);
  });

  it("işlem geçmişi: zamanlayıcı kullanıcısız yazılır, gruba göre süzülür; etiketler Türkçe", async () => {
    const admin = await user();
    await audit({ userId: SYSTEM_USER_ID, action: "incoming.synced" });
    await audit({ userId: admin.id, action: "auth.login" });
    const all = await listAudit(admin);
    expect(all.rows.map((r) => [r.action, r.userId])).toEqual([["auth.login", admin.id], ["incoming.synced", null]]);
    expect((await listAudit(admin, { action: "incoming." })).total).toBe(1);
    expect(auditLabel("auth.login_failed")).toBe("Hatalı giriş denemesi");
    expect(auditLabel("warehouse.created")).toBe("Depolar: eklendi");
  });
});

describe("ilk kurulum anahtarı", () => {
  const prev = process.env.SETUP_TOKEN;
  afterEach(() => { if (prev === undefined) delete process.env.SETUP_TOKEN; else process.env.SETUP_TOKEN = prev; });
  const input = (token?: string) => setupSchema.parse({ name: "Yönetici", email: "y@firma.test", password: "cok-gizli-123", passwordConfirm: "cok-gizli-123", setupToken: token });

  it("SETUP_TOKEN tanımlıysa doğru anahtar olmadan yönetici oluşturulamaz", async () => {
    process.env.SETUP_TOKEN = "kurulum-anahtari-123";
    await expect(createFirstAdmin(input("yanlis"))).rejects.toThrow(/anahtarı hatalı/);
    await expect(createFirstAdmin(input())).rejects.toThrow(/anahtarı hatalı/);
    expect(await db.user.count()).toBe(0);
    const u = await createFirstAdmin(input("kurulum-anahtari-123"));
    expect(u.role).toBe("ADMIN");
  });
});

describe("menü ve yetki", () => {
  it("satış rolü gider, rapor ve ayar bağlantılarını görmez", () => {
    const hrefs = (role: UserRole) => navFor(role, [...NAV, NAV_SETTINGS]).flatMap((g) => g.children?.map((c) => c.href) ?? []);
    const sales = hrefs("SALES");
    expect(sales).toContain("/satislar");
    expect(sales).not.toContain("/giderler");
    expect(sales.some((h) => h.startsWith("/raporlar"))).toBe(false);
    expect(sales).not.toContain("/kullanicilar");
    expect(navFor("SALES", NAV).map((g) => g.key)).not.toContain("cash");
    expect(hrefs("ADMIN")).toContain("/islem-gecmisi");
    expect(hrefs("VIEWER")).toContain("/raporlar/kdv");
  });
});

describe("zamanlayıcı ve yedek", () => {
  const prev = process.env.CRON_SECRET;
  afterEach(() => { if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev; });

  it("anahtar tanımlı değilse uç kapalı; yanlış anahtar 401; NES ayarı yoksa işler atlanır", async () => {
    delete process.env.CRON_SECRET;
    expect((await cronGET(new Request("http://x/api/zamanlayici"))).status).toBe(404);
    process.env.CRON_SECRET = "test-anahtari-uzun-12345";
    expect((await cronGET(new Request("http://x/api/zamanlayici", { headers: { authorization: "Bearer yanlis" } }))).status).toBe(401);
    const ok = await cronGET(new Request("http://x/api/zamanlayici", { headers: { authorization: "Bearer test-anahtari-uzun-12345" } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ skipped: true });
    expect(await runScheduledJobs()).toMatchObject({ skipped: true });
  });

  it("tüm veriler dışa aktarımı yalnızca yöneticiye; işlem geçmişine yazılır", async () => {
    const admin = await user();
    await expect(EXPORTS["tum-veriler"]!(await user("ACCOUNTANT"), new URLSearchParams())).rejects.toThrow(/yetkiniz yok/);
    const r = await EXPORTS["tum-veriler"]!(admin, new URLSearchParams());
    expect(r.sheets.map((s) => s.name)).toEqual(["Müşteriler", "Tedarikçiler", "Hizmet ve ürünler", "Satış faturaları", "Giderler", "Çekler", "Fatura satırları", "Kasa banka hareketleri"]);
    expect(await db.auditLog.count({ where: { action: "backup.exported" } })).toBe(1);
  });
});
