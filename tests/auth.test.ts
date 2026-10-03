import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { authenticate, createFirstAdmin, needsSetup } from "@/server/auth/service";
import { resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

const admin = { name: "Yönetici", email: "yonetici@test.local", password: "uzun-sifre-123", passwordConfirm: "uzun-sifre-123" };

describe("ilk kurulum ve giriş (gerçek veritabanı)", () => {
  it("kullanıcı yokken kurulum gerekir; ilk kullanıcı yönetici olur", async () => {
    expect(await needsSetup()).toBe(true);
    const u = await createFirstAdmin(admin);
    expect(u.role).toBe("ADMIN");
    expect(u.passwordHash).not.toContain(admin.password);
    expect(await needsSetup()).toBe(false);
  });

  it("ikinci kurulum reddedilir (kurulum ekranı sonradan yönetici açmak için kullanılamaz)", async () => {
    await createFirstAdmin(admin);
    await expect(createFirstAdmin({ ...admin, email: "saldirgan@test.local" })).rejects.toThrow(/zaten yapılmış/);
    expect(await db.user.count()).toBe(1);
  });

  it("aynı anda iki kurulum isteğinden yalnızca biri başarılı olur", async () => {
    const results = await Promise.allSettled([createFirstAdmin(admin), createFirstAdmin({ ...admin, email: "iki@test.local" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.user.count()).toBe(1);
  });

  it("doğru şifreyle girer; yanlış şifre ve bilinmeyen e-posta aynı mesajı verir", async () => {
    await createFirstAdmin(admin);
    const u = await authenticate(admin.email, admin.password);
    expect(u.email).toBe(admin.email);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).lastLoginAt).not.toBeNull();
    await expect(authenticate(admin.email, "yanlis")).rejects.toThrow("E-posta veya şifre hatalı.");
    await expect(authenticate("yok@test.local", "yanlis")).rejects.toThrow("E-posta veya şifre hatalı.");
    expect(await db.auditLog.count({ where: { action: "auth.login_failed" } })).toBe(2);
  });

  it("pasif kullanıcı giremez", async () => {
    const u = await createFirstAdmin(admin);
    await db.user.update({ where: { id: u.id }, data: { isActive: false } });
    await expect(authenticate(admin.email, admin.password)).rejects.toThrow(/pasif/);
  });
});
