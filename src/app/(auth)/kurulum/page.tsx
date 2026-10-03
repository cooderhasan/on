import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { needsSetup } from "@/server/auth/service";
import { SetupForm } from "../auth-forms";

export const metadata: Metadata = { title: "İlk kurulum" };

/** Yalnızca hiç kullanıcı yokken açılır; ilk hesap yönetici olur. */
export default async function SetupPage() {
  // Kurulum / oturum durumu her istekte okunmalı (build anında sabitlenmesin)
  await connection();
  if (!(await needsSetup())) redirect("/giris");
  return (
    <>
      <h1 className="text-lg text-text">İlk kurulum</h1>
      <p className="mb-5 mt-1 text-sm text-text-2">
        Yönetici hesabını oluşturun. Diğer kullanıcıları sonra Ayarlar › Kullanıcılar&apos;dan ekleyebilirsiniz.
      </p>
      <SetupForm />
    </>
  );
}
