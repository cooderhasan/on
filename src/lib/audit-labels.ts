/** İşlem geçmişi (AuditLog.action) için Türkçe etiketler */

export const AUDIT_GROUPS: Record<string, string> = {
  auth: "Giriş / oturum",
  user: "Kullanıcılar",
  company: "Firma",
  contact: "Cariler",
  product: "Ürünler",
  account: "Kasa / banka",
  category: "Kategori / etiket",
  tag: "Kategori / etiket",
  invoice: "Faturalar",
  quote: "Teklifler",
  einvoice: "e-Fatura / e-Arşiv",
  incoming: "Gelen e-faturalar",
  transaction: "Tahsilat / ödeme",
  expense: "Giderler",
  employee: "Çalışanlar",
  stock: "Stok",
  warehouse: "Depolar",
  waybill: "İrsaliyeler",
  price_list: "Fiyat listeleri",
  cheque: "Çekler",
  print_settings: "Yazdırma",
  backup: "Yedek / dışa aktarma",
};

const LABELS: Record<string, string> = {
  "auth.login": "Giriş yaptı",
  "auth.login_failed": "Hatalı giriş denemesi",
  "auth.logout": "Çıkış yaptı",
  "auth.sessions_closed": "Diğer oturumları kapattı",
  "user.setup_admin": "İlk yönetici oluşturuldu",
  "user.created": "Kullanıcı eklendi",
  "user.updated": "Kullanıcı güncellendi",
  "user.password_reset": "Kullanıcı şifresi sıfırlandı",
  "user.password_changed": "Şifresini değiştirdi",
  "einvoice.sent": "e-Belge gönderildi",
  "einvoice.failed": "e-Belge gönderilemedi",
  "einvoice.archive_cancelled": "e-Arşiv iptal edildi",
  "einvoice.settings_updated": "e-Fatura ayarları değişti",
  "invoice.created": "Fatura oluşturuldu",
  "invoice.updated": "Fatura güncellendi",
  "invoice.deleted": "Fatura silindi",
  "transaction.collection": "Tahsilat eklendi",
  "transaction.payment": "Ödeme eklendi",
  "transaction.transfer": "Virman yapıldı",
  "transaction.deposit": "Para girişi",
  "transaction.withdrawal": "Para çıkışı",
  "transaction.deleted": "Hareket silindi",
  "cheque.received": "Çek alındı",
  "cheque.issued": "Çek verildi",
  "cheque.collect": "Çek tahsil edildi",
  "cheque.endorse": "Çek ciro edildi",
  "cheque.bounce": "Çek karşılıksız",
  "cheque.pay": "Çek ödendi",
  "cheque.reverted": "Çek işlemi geri alındı",
  "cheque.deleted": "Çek silindi",
  "incoming.synced": "Gelen faturalar alındı",
  "incoming.answered": "Gelen faturaya yanıt verildi",
  "incoming.processed": "Gelen fatura gidere işlendi",
  "backup.exported": "Tüm veriler dışa aktarıldı",
};

const VERBS: Record<string, string> = { created: "eklendi", updated: "güncellendi", deleted: "silindi", archived: "arşivlendi", unarchived: "arşivden çıkarıldı" };

export function auditLabel(action: string): string {
  if (LABELS[action]) return LABELS[action]!;
  const [group, verb] = action.split(".");
  const g = AUDIT_GROUPS[group ?? ""];
  return g ? `${g}: ${VERBS[verb ?? ""] ?? verb}` : action;
}
