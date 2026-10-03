/** Sol menü — Paraşüt'teki sıra ve adlar. `phase`: modülün geliştirileceği faz (henüz yoksa sayfa "yakında" gösterir). */
export interface NavLink {
  href: string;
  label: string;
  phase: number;
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
      { href: "/teklifler", label: "Teklifler", phase: 2 },
      { href: "/satislar", label: "Faturalar", phase: 2 },
      { href: "/musteriler", label: "Müşteriler", phase: 1 },
      { href: "/raporlar/satislar", label: "Satışlar Raporu", phase: 6 },
      { href: "/raporlar/tahsilatlar", label: "Tahsilatlar Raporu", phase: 6 },
      { href: "/raporlar/gelir-gider", label: "Gelir Gider Raporu", phase: 6 },
    ],
  },
  {
    key: "expenses",
    label: "Giderler",
    icon: "expenses",
    children: [
      { href: "/giderler", label: "Gider Listesi", phase: 4 },
      { href: "/gelen-e-faturalar", label: "Gelen e-Faturalar", phase: 4 },
      { href: "/tedarikciler", label: "Tedarikçiler", phase: 1 },
      { href: "/calisanlar", label: "Çalışanlar", phase: 4 },
      { href: "/raporlar/giderler", label: "Giderler Raporu", phase: 6 },
      { href: "/raporlar/odemeler", label: "Ödemeler Raporu", phase: 6 },
      { href: "/raporlar/kdv", label: "KDV Raporu", phase: 6 },
    ],
  },
  {
    key: "cash",
    label: "Nakit",
    icon: "cash",
    children: [
      { href: "/kasa-ve-bankalar", label: "Kasa ve Bankalar", phase: 1 },
      { href: "/cekler", label: "Çekler", phase: 5 },
      { href: "/raporlar/kasa-banka", label: "Kasa / Banka Raporu", phase: 6 },
      { href: "/raporlar/nakit-akisi", label: "Nakit Akışı Raporu", phase: 6 },
    ],
  },
  {
    key: "stock",
    label: "Stok",
    icon: "stock",
    children: [
      { href: "/hizmet-ve-urunler", label: "Hizmet ve Ürünler", phase: 1 },
      { href: "/depolar", label: "Depolar", phase: 5 },
      { href: "/depolar-arasi-transfer", label: "Depolar Arası Transfer", phase: 5 },
      { href: "/giden-irsaliyeler", label: "Giden İrsaliyeler", phase: 5 },
      { href: "/gelen-irsaliyeler", label: "Gelen İrsaliyeler", phase: 5 },
      { href: "/fiyat-listeleri", label: "Fiyat Listeleri", phase: 5 },
      { href: "/stok-hareketleri", label: "Stok Geçmişi", phase: 5 },
      { href: "/raporlar/stoktaki-urunler", label: "Stoktaki Ürünler Raporu", phase: 6 },
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
    { href: "/e-fatura-ayarlari", label: "e-Fatura Ayarları (NES)", phase: 3 },
    { href: "/kategori-ve-etiketler", label: "Kategori ve Etiketler", phase: 1 },
    { href: "/kullanicilar", label: "Kullanıcılar", phase: 7 },
    { href: "/yazdirma-sablonlari", label: "Yazdırma Şablonları", phase: 6 },
  ],
};

export const ALL_LINKS: NavLink[] = [...NAV, NAV_SETTINGS].flatMap((g) => g.children ?? []);

/** Etkin grup: yol bu grubun bir bağlantısıyla başlıyorsa */
export function activeGroupKey(pathname: string): string | null {
  for (const g of [...NAV, NAV_SETTINGS]) {
    if (g.children?.some((c) => pathname === c.href || pathname.startsWith(`${c.href}/`))) return g.key;
  }
  return null;
}
