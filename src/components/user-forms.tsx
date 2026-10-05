"use client";

import { KeyRound, Mail, Shield, User } from "lucide-react";
import { changeOwnPasswordAction, closeOtherSessionsAction, createUserAction, resetPasswordAction, updateOwnNameAction, updateUserAction } from "@/app/actions/users";
import { ActionForm, FormMessage, SubmitButton } from "./forms";
import { FormHeader } from "./record-forms";
import { FormRow, Input, Select } from "./ui";

type Role = "ADMIN" | "ACCOUNTANT" | "SALES" | "VIEWER";
const ROLES: Array<[Role, string, string]> = [
  ["ADMIN", "Yönetici", "Her şey: kullanıcılar, ayarlar, e-Fatura gönderimi"],
  ["ACCOUNTANT", "Muhasebe", "Tüm kayıtlar, e-Fatura gönderimi, raporlar; kullanıcı ve ayar yönetimi yok"],
  ["SALES", "Satış", "Teklif, satış faturası, müşteri, tahsilat; gider ve rapor yok"],
  ["VIEWER", "Görüntüleyici", "Yalnızca görüntüleme ve raporlar"],
];
const PW_HINT = "En az 10 karakter. Kullanıcıya güvenli bir yoldan iletin.";

function RoleSelect({ value }: { value: Role }) {
  return (
    <div className="flex flex-col gap-1.5">
      {ROLES.map(([k, l, d]) => (
        <label key={k} className="flex cursor-pointer items-start gap-2 rounded-sm border border-[#d6d6d6] px-3 py-2 text-sm">
          <input type="radio" name="role" value={k} defaultChecked={value === k} className="mt-1 accent-accent" />
          <span><b className="font-medium">{l}</b><span className="block text-xs text-text-3">{d}</span></span>
        </label>
      ))}
    </div>
  );
}

export function UserCreateForm() {
  return (
    <ActionForm action={createUserAction} className="gap-0">
      {(s) => (
        <>
          <FormHeader cancelHref="/kullanicilar">
            <FormRow label="Ad soyad" htmlFor="name" icon={<User />} error={s.fieldErrors?.name}>
              <Input id="name" name="name" required maxLength={100} />
            </FormRow>
          </FormHeader>
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          <div className="py-2">
            <FormRow label="E-posta" htmlFor="email" icon={<Mail />} error={s.fieldErrors?.email} hint="Giriş için kullanılır.">
              <Input id="email" name="email" type="email" required autoComplete="off" maxLength={200} />
            </FormRow>
            <FormRow label="Rol" icon={<Shield />} error={s.fieldErrors?.role}>
              <RoleSelect value="VIEWER" />
            </FormRow>
            <FormRow label="İlk şifre" htmlFor="password" icon={<KeyRound />} error={s.fieldErrors?.password} hint={`${PW_HINT} Kullanıcı girişten sonra Hesabım'dan değiştirebilir.`}>
              <Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="max-w-72" />
            </FormRow>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function UserEditForm({ id, name, role, isActive, self }: { id: string; name: string; role: Role; isActive: boolean; self: boolean }) {
  return (
    <ActionForm action={updateUserAction} className="gap-0">
      {(s) => (
        <>
          <input type="hidden" name="id" value={id} />
          {(s.error || s.message) && <div className="px-4 pt-3"><FormMessage state={s} /></div>}
          <div className="py-2">
            <FormRow label="Ad soyad" htmlFor="name" icon={<User />} error={s.fieldErrors?.name}>
              <Input id="name" name="name" required maxLength={100} defaultValue={name} />
            </FormRow>
            <FormRow label="Rol" icon={<Shield />} error={s.fieldErrors?.role} hint={self ? "Kendi rolünüzü düşüremezsiniz." : undefined}>
              <RoleSelect value={role} />
            </FormRow>
            <FormRow label="Durum" icon={<Shield />} hint="Pasif kullanıcı giriş yapamaz; açık oturumları hemen kapanır.">
              <Select name="isActive" defaultValue={isActive ? "1" : "0"} className="max-w-48" disabled={self}>
                <option value="1">Aktif</option>
                <option value="0">Pasif</option>
              </Select>
              {self && <input type="hidden" name="isActive" value="1" />}
            </FormRow>
          </div>
          <div className="flex justify-end border-t border-border px-4 py-3">
            <SubmitButton variant="accent" pendingText="Kaydediliyor…">Kaydet</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function PasswordResetForm({ id }: { id: string }) {
  return (
    <ActionForm action={resetPasswordAction} resetOnSuccess className="gap-2">
      {(s) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Input name="password" type="password" minLength={10} required autoComplete="new-password" placeholder="Yeni şifre" aria-label="Yeni şifre" />
          <p className="text-[11px] text-text-3">{PW_HINT}</p>
          {s.fieldErrors?.password && <p className="text-xs text-danger">{s.fieldErrors.password}</p>}
          <FormMessage state={s} />
          <SubmitButton variant="danger" pendingText="Değiştiriliyor…">Şifreyi değiştir</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function OwnNameForm({ name }: { name: string }) {
  return (
    <ActionForm action={updateOwnNameAction} className="gap-2">
      {(s) => (
        <>
          <Input name="name" defaultValue={name} required maxLength={100} aria-label="Ad soyad" />
          <FormMessage state={s} />
          <SubmitButton pendingText="Kaydediliyor…">Kaydet</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function OwnPasswordForm() {
  return (
    <ActionForm action={changeOwnPasswordAction} resetOnSuccess className="gap-2">
      {(s) => (
        <>
          <Input name="currentPassword" type="password" required autoComplete="current-password" placeholder="Mevcut şifre" aria-label="Mevcut şifre" />
          {s.fieldErrors?.currentPassword && <p className="text-xs text-danger">{s.fieldErrors.currentPassword}</p>}
          <Input name="password" type="password" required minLength={10} autoComplete="new-password" placeholder="Yeni şifre (en az 10 karakter)" aria-label="Yeni şifre" />
          {s.fieldErrors?.password && <p className="text-xs text-danger">{s.fieldErrors.password}</p>}
          <Input name="passwordConfirm" type="password" required autoComplete="new-password" placeholder="Yeni şifre (tekrar)" aria-label="Yeni şifre tekrar" />
          {s.fieldErrors?.passwordConfirm && <p className="text-xs text-danger">{s.fieldErrors.passwordConfirm}</p>}
          <FormMessage state={s} />
          <SubmitButton variant="accent" pendingText="Değiştiriliyor…">Şifremi değiştir</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function CloseSessionsButton() {
  return (
    <ActionForm action={closeOtherSessionsAction} className="gap-2">
      {(s) => (
        <>
          <SubmitButton variant="danger" pendingText="Kapatılıyor…">Diğer oturumları kapat</SubmitButton>
          <FormMessage state={s} />
        </>
      )}
    </ActionForm>
  );
}
