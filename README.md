# Ön Muhasebe

Paraşüt benzeri ön muhasebe uygulaması (tek firma). e-Fatura / e-Arşiv ve gelen faturalar NES altyapısıyla.
Yol haritası: [PLAN.md](PLAN.md).

## Yerelde çalıştırma

Gerekenler: Node.js 24, Docker Desktop.

```bash
npm install
cp .env.example .env        # ENCRYPTION_KEY'i doldurun (dosyadaki komutla üretin)
docker compose up -d        # PostgreSQL, port 55452
npm run db:deploy
npm run dev                 # http://localhost:3000
```

İlk açılışta **İlk kurulum** ekranı gelir; oluşturduğunuz hesap yönetici olur.

Windows'ta kısayol: `baslat.bat` (veritabanı + migration + uygulama), `yedek-al.bat` (yerel SQL yedeği → `yedekler/`).

## Komutlar

| Komut | İş |
|---|---|
| `npm run check` | typecheck + lint + test + build (her faz sonunda temiz olmalı) |
| `npm test` | testler (ayrı `muhasebe_test` veritabanında) |
| `npm run db:migrate` | şema değişikliği sonrası yeni migration |

## Canlıya alma (Coolify)

Uygulama tek Docker imajıdır (`Dockerfile`): Next.js standalone çıktısı + başlangıçta `prisma migrate deploy`.

1. **PostgreSQL**: Coolify'da *New Resource → Database → PostgreSQL 17* oluşturun. İç bağlantı adresini (Internal URL) kopyalayın.
   *Backups* sekmesinden günlük zamanlanmış yedeği açın (mümkünse S3 / harici depolama).
2. **Uygulama**: *New Resource → Application → GitHub* (bu repo, `main`), *Build Pack: Dockerfile*, port **3000**.
3. **Ortam değişkenleri** (*Environment Variables*):

   | Değişken | Değer |
   |---|---|
   | `DATABASE_URL` | 1. adımdaki iç bağlantı adresi |
   | `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — **bir kez üretin, değiştirmeyin, ayrıca güvenli bir yerde saklayın** (değişirse kayıtlı NES anahtarı çözülemez) |
   | `CRON_SECRET` | `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` |
   | `APP_URL` | `https://alan-adiniz` |
   | `SETUP_TOKEN` | İlk kurulum anahtarı (en az 12 karakter). Canlıda zorunlu: kurulum ekranı bu anahtarı ister; böylece sunucu açılır açılmaz başkası yönetici olamaz. Kurulumdan sonra silinebilir. |

4. **Alan adı**: *Domains* alanına `https://…` yazın; Coolify TLS sertifikasını alır.
5. **Sağlık kontrolü**: `/api/saglik` (imaj içinde HEALTHCHECK tanımlı).
6. **Zamanlanmış görev** (e-belge durum takibi + gelen e-faturalar): uygulamada *Scheduled Tasks → Add*,
   sıklık `*/15 * * * *`, komut:

   ```sh
   wget -qO- --header="Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/zamanlayici
   ```

7. İlk açılışta **İlk kurulum** ile (kurulum anahtarı = `SETUP_TOKEN`) yönetici hesabını oluşturun, ardından *Ayarlar › e-Fatura Ayarları*'na NES anahtarını girin
   ve *Ayarlar › Kullanıcılar*'dan diğer kullanıcıları ekleyin.

Güncelleme: `main`'e gönderilen her commit Coolify'da yeniden derlenir (otomatik dağıtım açıksa); migration'lar container başlarken uygulanır.

### Yedekten geri yükleme

```sh
psql "$DATABASE_URL" < yedek.sql
```

Yedekle birlikte `ENCRYPTION_KEY` de gerekir.
