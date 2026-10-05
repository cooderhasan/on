import { can, type Permission } from "@/server/auth/permissions";
import type { UserRole } from "@/generated/prisma/enums";

/** Sol menü — Paraşüt'teki sıra ve adlar. `phase`: modülün geliştirildiği faz. `perm`: bağlantıyı görmek için gereken yetki. */
export interface NavLink {
  href: string;
  label: string;
  phase: number;
  perm?: Permission;
}

export interface NavGroup {
  key: string;
  label: string;
  icon: "dashboard" | "sales" | "expenses" | "cash" | "stock" | "settings";
  href?: string;
  phase?: number;
  children?: NavLink[];
}

export const NAV: NavGroup[] = [
  { key: "dashboard", label: "Güncel Durum", icon: "dashboard", href: "/", phase: 6 },
  {
    key: "sales",
    label: "Satışlar",
    icon: "sales",
    children: [
      { href: "/teklifler", label: "Teklifler", phase: 2, perm: "sales.read" },
      { href: "/satislar", label: "Faturalar", phase: 2, perm: "sales.read" },
      { href: "/musteriler", label: "Müşteriler", phase: 1, perm: "sales.read" },
      { href: "/raporlar/satislar", label: "Satışlar Raporu", phase: 6, perm: "reports.read" },
      { href: "/raporlar/tahsilatlar", label: "Tahsilatlar Raporu", phase: 6, perm: "reports.read" },
      { href: "/raporlar/gelir-gider", label: "Gelir Gider Raporu", phase: 6, perm: "reports.read" },
    ],
  },
  {
    key: "expenses",
    label: "Giderler",
    icon: "expenses",
    children: [
      { href: "/giderler", label: "Gider Listesi", phase: 4, perm: "expenses.read" },
      { href: "/gelen-e-faturalar", label: "Gelen e-Faturalar", phase: 4, perm: "expenses.read" },
      { href: "/tedarikciler", label: "Tedarikçiler", phase: 1, perm: "expenses.read" },
      { href: "/calisanlar", label: "Çalışanlar", phase: 4, perm: "expenses.read" },
      { href: "/raporlar/giderler", label: "Giderler Raporu", phase: 6, perm: "reports.read" },
      { href: "/raporlar/odemeler", label: "Ödemeler Raporu", phase: 6, perm: "reports.read" },
      { href: "/raporlar/kdv", label: "KDV Raporu", phase: 6, perm: "reports.read" },
    ],
  },
  {
    key: "cash",
    label: "Nakit",
    icon: "cash",
    children: [
      { href: "/kasa-ve-bankalar", label: "Kasa ve Bankalar", phase: 1, perm: "cash.read" },
      { href: "/cekler", label: "Çekler", phase: 5, perm: "cash.read" },
      { href: "/raporlar/kasa-banka", label: "Kasa / Banka Raporu", phase: 6, perm: "reports.read" },
      { href: "/raporlar/nakit-akisi", label: "Nakit Akışı Raporu", phase: 6, perm: "reports.read" },
    ],
  },
  {
    key: "stock",
    label: "Stok",
    icon: "stock",
    children: [
      { href: "/hizmet-ve-urunler", label: "Hizmet ve Ürünler", phase: 1, perm: "stock.read" },
      { href: "/depolar", label: "Depolar", phase: 5, perm: "stock.read" },
      { href: "/depolar-arasi-transfer", label: "Depolar Arası Transfer", phase: 5, perm: "stock.read" },
      { href: "/giden-irsaliyeler", label: "Giden İrsaliyeler", phase: 5, perm: "sales.read" },
      { href: "/gelen-irsaliyeler", label: "Gelen İrsaliyeler", phase: 5, perm: "expenses.read" },
      { href: "/fiyat-listeleri", label: "Fiyat Listeleri", phase: 5, perm: "stock.read" },
      { href: "/stok-hareketleri", label: "Stok Geçmişi", phase: 5, perm: "stock.read" },
      { href: "/raporlar/stoktaki-urunler", label: "Stoktaki Ürünler Raporu", phase: 6, perm: "reports.read" },
    ],
  },
];

/** Altta duran ayarlar grubu */
export const NAV_SETTINGS: NavGroup = {
  key: "settings",
  label: "Ayarlar",
  icon: "settings",
  children: [
    { href: "/firma-bilgileri", label: "Firma Bilgileri", phase: 1 },
    { href: "/e-fatura-ayarlari", label: "e-Fatura Ayarları (NES)", phase: 3, perm: "settings.manage" },
    { href: "/kategori-ve-etiketler", label: "Kategori ve Etiketler", phase: 1 },
    { href: "/kullanicilar", label: "Kullanıcılar", phase: 7, perm: "users.manage" },
    { href: "/islem-gecmisi", label: "İşlem Geçmişi", phase: 7, perm: "users.manage" },
    { href: "/veri-disa-aktar", label: "Yedek ve Dışa Aktarma", phase: 7, perm: "users.manage" },
    { href: "/yazdirma-sablonlari", label: "Yazdırma Şablonları", phase: 6, perm: "settings.manage" },
  ],
};

/** Rolün görebileceği menü (boş kalan grup gizlenir) */
export function navFor(role: UserRole, groups: NavGroup[]): NavGroup[] {
  return groups
    .map((g) => ({ ...g, children: g.children?.filter((c) => !c.perm || can(role, c.perm)) }))
    .filter((g) => !g.children || g.children.length > 0);
}

export const ALL_LINKS: NavLink[] = [...NAV, NAV_SETTINGS].flatMap((g) => g.children ?? []);

/** Etkin grup: yol bu grubun bir bağlantısıyla başlıyorsa */
export function activeGroupKey(pathname: string): string | null {
  for (const g of [...NAV, NAV_SETTINGS]) {
    if (g.children?.some((c) => pathname === c.href || pathname.startsWith(`${c.href}/`))) return g.key;
  }
  return null;
}
