"use client";

import { loginAction, setupAction } from "@/app/actions/auth";
import { ActionForm, FormMessage, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui";

function Field({ id, label, error, ...props }: { id: string; label: string; error?: string } & React.ComponentProps<"input">) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-text-2">{label}</label>
      <Input id={id} name={id} aria-invalid={Boolean(error)} className="h-11 bg-[#f2f2f2]" {...props} />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function LoginForm() {
  return (
    <ActionForm action={loginAction}>
      {(s) => (
        <>
          <FormMessage state={s} />
          <Field id="email" label="E-posta" type="email" autoComplete="username" required error={s.fieldErrors?.email} />
          <Field id="password" label="Şifre" type="password" autoComplete="current-password" required error={s.fieldErrors?.password} />
          <SubmitButton variant="accent" pendingText="Giriş yapılıyor…" className="self-end">Giriş yap</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function SetupForm() {
  return (
    <ActionForm action={setupAction}>
      {(s) => (
        <>
          <FormMessage state={s} />
          <Field id="name" label="Adınız soyadınız" autoComplete="name" required error={s.fieldErrors?.name} />
          <Field id="email" label="E-posta" type="email" autoComplete="username" required error={s.fieldErrors?.email} />
          <Field id="password" label="Şifre (en az 10 karakter)" type="password" autoComplete="new-password" required error={s.fieldErrors?.password} />
          <Field id="passwordConfirm" label="Şifre (tekrar)" type="password" autoComplete="new-password" required error={s.fieldErrors?.passwordConfirm} />
          <SubmitButton variant="accent" pendingText="Oluşturuluyor…" className="self-end">Yönetici hesabını oluştur</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
