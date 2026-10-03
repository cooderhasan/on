import type { UserRole } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";

/** Tek yetki tablosu. Sayfalar, server action'lar ve menü aynı kontrolü kullanır. */
const PERMISSIONS = {
  "dashboard.read": ["ADMIN", "ACCOUNTANT", "SALES", "VIEWER"],
  "sales.read": ["ADMIN", "ACCOUNTANT", "SALES", "VIEWER"],
  "sales.write": ["ADMIN", "ACCOUNTANT", "SALES"],
  /** e-Fatura / e-Arşiv resmileştirme (geri alınamaz) */
  "einvoice.send": ["ADMIN", "ACCOUNTANT"],
  "expenses.read": ["ADMIN", "ACCOUNTANT", "VIEWER"],
  "expenses.write": ["ADMIN", "ACCOUNTANT"],
  "cash.read": ["ADMIN", "ACCOUNTANT", "VIEWER"],
  "cash.write": ["ADMIN", "ACCOUNTANT"],
  "stock.read": ["ADMIN", "ACCOUNTANT", "SALES", "VIEWER"],
  "stock.write": ["ADMIN", "ACCOUNTANT"],
  "reports.read": ["ADMIN", "ACCOUNTANT", "VIEWER"],
  "settings.manage": ["ADMIN"],
  "users.manage": ["ADMIN"],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Yönetici",
  ACCOUNTANT: "Muhasebe",
  SALES: "Satış",
  VIEWER: "Görüntüleyici",
};

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

export function assertCan(user: { role: UserRole }, permission: Permission): void {
  if (!can(user.role, permission)) throw new AppError("FORBIDDEN", "Bu işlem için yetkiniz yok.");
}
