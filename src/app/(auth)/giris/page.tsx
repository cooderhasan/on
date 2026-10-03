import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { needsSetup } from "@/server/auth/service";
import { LoginForm } from "../auth-forms";

export const metadata: Metadata = { title: "Giriş" };

export default async function LoginPage() {
  // Kurulum / oturum durumu her istekte okunmalı (build anında sabitlenmesin)
  await connection();
  if (await needsSetup()) redirect("/kurulum");
  if (await getCurrentUser()) redirect("/");
  return (
    <>
      <h1 className="text-lg text-text">Hoş geldiniz</h1>
      <p className="mb-5 mt-1 text-sm text-text-2">E-posta adresiniz ve şifrenizle giriş yapın.</p>
      <LoginForm />
    </>
  );
}
