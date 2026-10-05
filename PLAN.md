# Ön Muhasebe Uygulaması — Plan (taslak v1)

Hedef: Paraşüt benzeri ön muhasebe, **tek firma** (bizim şirket; birden fazla kullanıcı + yetki). Aynı modüller, benzer görünüm. e-Fatura / e-Arşiv gönderme ve gelen fatura alma **NES** altyapısıyla.
Geliştirme önce localde; canlı ortam Coolify + PostgreSQL.

> ✅ Menü yapısı Paraşüt hesabında canlı incelendi (3 Ekim 2026). İncelenen ekranlar: Güncel Durum, fatura listesi,
> fatura detayı, yeni fatura formu, gider listesi. Diğer ekranlar Faz 0'da incelenecek (tarayıcı sekmesi yanıt vermeyi bıraktı).

## 0. Paraşüt'te görülen yapı

**Sol menü (koyu, daraltılabilir; ikon + büyük harf başlık, açılır alt menü):**

| Ana menü | Alt menüler |
|---|---|
| Güncel Durum | — |
| Satışlar | Teklifler · Faturalar · Müşteriler · Satışlar Raporu · Tahsilatlar Raporu · Gelir Gider Raporu |
| Giderler | Gider Listesi · Gelen e-Faturalar · Tedarikçiler · Çalışanlar · Giderler Raporu · Ödemeler Raporu · KDV Raporu |
| Nakit | Kasa ve Bankalar · Çekler · Kasa / Banka Raporu · Nakit Akışı Raporu |
| Stok | Hizmet ve Ürünler · Depolar · Depolar Arası Transfer · Giden İrsaliyeler · Gelen İrsaliyeler · Fiyat Listeleri · Stok Geçmişi · Stoktaki Ürünler Raporu |
| Ayarlar (altta) | Firma Bilgileri · Kategori ve Etiketler · Kullanıcılar · Yazdırma Şablonları |
| (kapsam dışı) | Asistan (AI), E-Ticaret, Uygulamalar, Pazaryeri |

**Ortak düzen:** üstte sayfa başlığı / breadcrumb, sağ üstte kullanıcı + firma adı; altta ortada yuvarlak **"+" hızlı oluştur** düğmesi.

**Güncel Durum:** "Tahsilatlar" ve "Ödemeler" kartları — her biri 3 halka grafik (Toplam / Gecikmiş / Planlanmamış) + yanda
"yazdırılmamış/gönderilmemiş", "tekrarlayan", "bu ay oluşan KDV (geçen ay)". Sağda zaman çizelgesi: bugün + gecikmiş işlemler
(kaç gün gecikti, tutar). Altta kasa/banka hesapları.

**Liste ekranı (Satış Faturaları):** üstte filtre düğmesi + tarih aralığı + "içerisinde ara"; sağda "YENİ FATURA OLUŞTUR ▾".
Sütunlar: Fatura ismi (+ müşteri), Fatura no, Düzenleme tarihi (+ e-belge türü ve durum rozeti: "Gönderildi", "Resmileşti"),
Vade tarihi (gecikmişse kırmızı "N gün gecikti"), Kalan meblağ (+ genel toplam). Altta: Tüm kayıtlar ▾, dışa aktar, sayfalama,
kayıt sayısı ve toplamlar.

**Fatura detayı:** solda belge (kategori, etiket, müşteri + adres + VKN/TCKN, tarih, no, kalemler, ara toplam / KDV / genel toplam / kalan);
sağda: resmileştirme durumu (e-Arşiv / e-Fatura, tarih) + **Paylaş**, kalan tutar, vade tarihi ekle, müşteri hatırlatma,
tahsilat talep et, **Tahsilat ekle**, stok çıkışı bilgisi, **Fatura geçmişi** (Tümü / Mesajlar / Notlar). Sağ üstte "Düzenle ▾".

**Yeni fatura formu:** Fatura ismi; Müşteri (ara veya yeni isim yaz); Tahsilat durumu (Tahsil edilecek / Tahsil edildi);
Düzenleme tarihi; Vade (Aynı gün / 7 / 14 / 30 / 60 gün + tarih); "+ Fatura no ekle", "Döviz değiştir", "+ Sipariş bilgisi ekle";
Fatura notu (+ müşteri bakiyesini not olarak ekle); Stok takibi (stok çıkışı yapılsın / yapılmasın); sağda Kategori ve Etiketler.
Kalemler: Hizmet/Ürün (ara) · Miktar · Birim · Br. fiyat · Vergi (KDV %) · Toplam · [+] menüsü:
**Açıklama, İndirim, ÖTV, ÖİV, Tevkifat, Konaklama vergisi, İhraç kayıtlı kod** · sil. Altta ara toplam (+ genel indirim), toplam KDV, genel toplam, toplam kâr.
Üstte Vazgeç / Kaydet ▾.

**Hızlı oluştur (+) menüsü:** Satış faturası · Hızlı fiş/fatura · Alış faturası · Müşteri.

**Müşteriler listesi:** ikon (kişi / firma), Ünvan (+ telefon), VKN/TCKN, Bakiye (+ "Tahsil edilecek"); sağ üst "Yeni müşteri oluştur";
altta kayıt sayısı, ödenecek / tahsil edilecek toplamları.

**Yeni müşteri formu:** VKN/TCKN (girilince bilgiler sorgulanır — NES mükellef sorgusu ile yapılacak); Türü (Tüzel / Gerçek kişi);
Firma unvanı, Kısa isim, Vergi dairesi, Kategori; e-posta, telefon, faks, açık adres (+ yurt dışında), posta kodu, ilçe / il;
IBAN (+ yeni IBAN), Fiyat listesi, Döviz kuru (alış / satış — bakiye hesabında), Açılış bakiyesi; Yetkili kişiler tablosu (ad, e-posta, telefon, not).

**Kasa ve Bankalar:** sütunlar Hesap ismi, IBAN, Döviz cinsi, Bakiye; "Kasa ekle", "Banka ekle" (banka bağlama kapsam dışı).

**Hizmet ve Ürünler listesi:** Adı, Stok miktarı (+ birim), Alış (vergiler hariç), Satış (vergiler hariç); "Stok güncelle", "Hizmet / ürün ekle".
**Yeni ürün formu:** Adı; Ürün/stok kodu, Barkod, Kategori, Fotoğraf, Alış/satış birimi, GTİP kodu; Stok takibi (yapılsın / yapılmasın),
Başlangıç stok miktarı, Kritik stok uyarısı; Vergiler hariç alış / satış fiyatı (döviz seçilebilir); KDV (+ diğer vergi);
Vergiler dahil alış / satış fiyatı (karşılıklı otomatik hesap).

**Çekler:** Düzenleyen, Çek bilgileri, Vade tarihi, Kalan meblağ; çek "Tahsilat ekle" ekranından oluşturulur.

**Gelen e-Faturalar:** Gönderen unvan, Fatura no (+ "Ticari e-Fatura / Satış" türü), Fatura tarihi (+ durum rozeti:
"Kabul edildi", "Onay bekliyor"), Fatura tutarı; sağ üst **"Faturaları içeri al"**.

**Firma Bilgileri:** logo, ticari unvan, evrak türü, sektör, açık adres, vergi dairesi + VKN; "Düzenle".

**KDV Raporu:** "Aylara göre KDV" tablosu (Ay, Hesaplanan KDV, İndirilecek KDV, Net KDV; daha fazla göster) +
seçili ayın satış/gider KDV dökümü (Tümü / Satışlar / Giderler; işlem türü, fatura no, kayıt ismi, cari, tarih, KDV; dışarı aktar).

**Gider listesi:** sütunlar Kayıt ismi, Düzenlenme tarihi, Kalan meblağ; oluştur: **Detaylı fiş/fatura**, **Hızlı fiş/fatura**,
Diğer ▾ (**Maaş / Prim**, **Vergi / SGK primi**, **Banka gideri**).

---

## 1. Teknoloji

| Katman | Seçim | Neden |
|---|---|---|
| Uygulama | Next.js (App Router) + TypeScript | LEAD / finans ile aynı; tek repo, tek deploy |
| Veritabanı | PostgreSQL + Prisma | Coolify'da hazır servis |
| UI | Tailwind + shadcn/ui (Radix) | Paraşüt tarzı sade liste / form ekranları |
| Doğrulama | Zod | form + API ortak şema |
| PDF | Fatura PDF'i NES'ten; kendi belgelerimiz (teklif, tahsilat makbuzu) için sunucu tarafı PDF |
| Excel | Liste dışa aktarma (xlsx) |
| Kuyruk | Gelen fatura senkronu, e-fatura durum sorgusu için zamanlayıcı (ayrı worker gerekmeden uygulama içi cron + DB kilidi) |
| Deploy | Dockerfile + Coolify (PostgreSQL servisi, env değişkenleri) |

Para birimi tutarları **Decimal** (asla float). Döviz: TRY, USD, EUR + kur (TCMB) kaydı.

---

## 2. Modüller (Paraşüt yapısı)

### 2.1 Güncel Durum (ana sayfa)
- Tahsil edilecekler / ödenecekler (vadesi geçen, bu hafta, sonra)
- Kasa ve banka bakiyeleri
- Nakit akışı grafiği (son / gelecek 3 ay)
- Satış – gider özeti, KDV durumu
- Son işlemler

### 2.2 Satışlar
- **Teklifler** — oluştur, PDF / e-posta ile gönder, faturaya dönüştür
- **Faturalar** — satış faturası, iade faturası, proforma; taslak → resmileştir (e-Fatura / e-Arşiv / kağıt)
  - kalem: ürün/hizmet, miktar, birim, fiyat, iskonto, KDV, ÖTV/stopaj/tevkifat
  - tahsilat ekle (kısmi / tam), vade, etiket, kategori
  - tekrarlayan fatura (aylık / yıllık)
- **Müşteriler** — cari kartı, bakiye, ekstre, tahsilat/ödeme geçmişi, iletişim kişileri
- Satış raporları: satışlar, tahsilatlar, müşteri bazlı

### 2.3 Giderler
- **Gider listesi** — fiş/fatura, maaş, vergi/SGK primi, banka gideri
- **Gelen e-Faturalar** — NES'ten otomatik çekilir; kabul / ret (ticari), gidere / stoka işle
- **Tedarikçiler** — cari kartı (müşteri ile aynı model, tür alanı)
- **Çalışanlar** — maaş / avans takibi
- Gider raporları: giderler, ödemeler, kategori bazlı

### 2.4 Nakit
- **Kasa ve Bankalar** — hesap tanımı, bakiye, hareketler, hesaplar arası transfer
- **Çek / Senet** — alınan / verilen, vade, durum (portföyde, tahsil edildi, ciro, karşılıksız)
- Nakit akışı raporu

### 2.5 Stok
- **Hizmet ve Ürünler** — kod, barkod, birim, alış/satış fiyatı, KDV, kritik stok
- **Depolar** ve depolar arası transfer
- **Fiyat listeleri** (müşteri grubuna göre farklı fiyat)
- **İrsaliyeler** — giden / gelen (e-İrsaliye ileri faz)
- Stok hareketleri, stoktaki ürünler raporu

### 2.6 Raporlar
Gelir-gider, KDV (hesaplanan / indirilecek), tahsilat, ödeme, nakit akışı, cari yaşlandırma, stok, satış/gider kategori.
Tümü tarih aralığı + Excel/PDF dışa aktarma.

### 2.7 Ayarlar
- Firma bilgileri (unvan, VKN/TCKN, vergi dairesi, adres, logo)
- Kullanıcılar ve yetkiler (yönetici, muhasebeci, satış, sadece görüntüleme)
- Kategoriler, etiketler, birimler, KDV oranları
- Fatura seri / numara ve şablon
- **e-Fatura ayarları (NES)**: API base URL, API anahtarı (şifreli saklanır), gönderici etiketi, e-Arşiv seri, test bağlantısı
- Döviz ve kur ayarı
- Muhasebeciye erişim / veri dışa aktarma

---

## 3. NES entegrasyonu (finans uygulamasında çalışan uçlar)

| İş | Uç |
|---|---|
| Mükellef sorgu (e-Fatura mı e-Arşiv mi) | `GET einvoice/v1/users/{vkn}/All` |
| e-Fatura gönder | `POST einvoice/v1/uploads/document` (multipart: File=UBL XML, IsDirectSend, SenderAlias, ReceiverAlias) |
| e-Arşiv gönder | `POST earchive/v1/uploads/document` |
| Gelen faturalar | `GET einvoice/v1/incoming/invoices` → detay `/{uuid}` → kalemler `/{uuid}/ubl` |
| Görüntü / PDF | `.../invoices/{uuid}/html` · `.../pdf` (einvoice: incoming/outgoing, earchive) |

Finans uygulamasından **farklı** yapılacaklar:
- UBL XML string birleştirme yerine tip güvenli UBL üretici + **XML kaçışlama** (unvanda `&` faturayı bozuyor)
- Tutar hesabı Decimal, satır/toplam yuvarlama GİB kurallarına göre; iskonto, tevkifat, istisna kodları, döviz
- Fatura numarası NES'ten dönen değerle; gönderim **önce kayıt (taslak) → sonra NES** (yarıda kalırsa tekrar denenebilir, çift fatura kesilmez — UUID sabit)
- Durum takibi: gönderildi / kabul / ret / hata (zamanlayıcı ile sorgu)
- Gelen fatura senkronu sayfalı + artımlı (son tarih), tedarikçi VKN ile eşleşir
- Test ortamı: `https://apitest.nes.com.tr/` — geliştirme bununla. Geliştirici dokümanı: https://developertest.nes.com.tr/docs

---

## 4. Veri modeli (özet)
Company, User, Membership(role) · Contact (müşteri/tedarikçi) · Product, Warehouse, StockMovement ·
SalesInvoice + lines (tür: satış/iade/proforma; e-belge alanları: uuid, profile, nesStatus, documentNumber) ·
Quote · Expense / PurchaseInvoice (+ gelen e-fatura bağlantısı) · Employee, Payroll ·
Account (kasa/banka) · Transaction (tahsilat/ödeme/transfer) · Cheque · Category, Tag · ExchangeRate · AuditLog · Setting

---

## 5. Fazlar

Durum: Faz 0–7 ✅ (5 Ekim 2026). Kalan: Coolify üzerinde ilk kurulum; e-İrsaliye ileri faz.


| Faz | Kapsam | Bitti sayılır |
|---|---|---|
| 0 | Kalan Paraşüt ekranlarının incelenmesi (müşteri, kasa/banka, stok, raporlar, ayarlar); proje iskeleti, giriş, Paraşüt düzeninde layout (sol menü, + hızlı oluştur), Docker Postgres | iskelet localde açılıyor |
| 1 | Ayarlar (firma), Müşteri/Tedarikçi, Ürün/Hizmet, Kasa/Banka | CRUD + liste/filtre/Excel |
| 2 | Satış faturası (taslak), teklif, tahsilat, cari bakiye/ekstre | fatura → tahsilat → bakiye doğru |
| 3 | **NES**: mükellef sorgu, e-Fatura / e-Arşiv gönder, PDF, durum takibi | test ortamında gerçek fatura kesiliyor |
| 4 | Giderler + **gelen e-fatura** senkronu, ödeme, çalışan/maaş | gelen fatura gidere işleniyor |
| 5 | Stok, depo, irsaliye, çek/senet | stok hareketleri faturadan otomatik |
| 6 | Raporlar + Güncel Durum paneli | KDV ve gelir-gider tutarlı |
| 7 | Kullanıcı/yetki, audit, yedek, Coolify deploy | canlıda çalışıyor |

Her faz sonunda: typecheck + lint + test + build temiz.
