@AGENTS.md

# Ön Muhasebe — geliştirme kuralları

Bağımsız proje (repo: github.com/cooderhasan/on). LEAD / LEAD_BEN / finans projeleriyle kod, repo veya veritabanı paylaşmaz.
Dil: kullanıcı ile ve UI metinlerinde **Türkçe**. Kod tanımlayıcıları İngilizce. Plan: `PLAN.md`.

## Kesin kurallar
- Tek firma uygulaması. Firma bilgisi `Company` tablosunda tek satır (`id = "firma"`).
- **Para her zaman Decimal**: veritabanında `Decimal(18,2)` (kur `Decimal(18,6)`), kodda `decimal.js` (`src/lib/money.ts`). `number` ile tutar hesabı yapma.
- Her sayfa `requireUser(izin)`, her server action `assertCan` ile başlar (`src/server/auth/permissions.ts` tek yetki tablosu). `proxy.ts` yalnızca iyimser yönlendirmedir.
- Server action dosyalarında yalnızca `export async function`; gövde `safeAction`, girdi `parseForm(zodŞema, fd)`.
- Kritik işlemler (resmileştirme, silme, ayar, giriş) `audit()` ile kaydedilir.
- Resmi belge (e-Fatura / e-Arşiv) **önce taslak olarak kaydedilir, UUID sabitlenir, sonra NES'e gönderilir** — yarıda kalan gönderim aynı UUID ile tekrar denenir, çift fatura kesilmez.
- XML'e giren her metin kaçışlanır (unvandaki `&` faturayı bozar).
- NES API anahtarı veritabanında `ENCRYPTION_KEY` ile şifreli saklanır; loglara / istemciye yazılmaz. Geliştirme ve testlerde **NES test ortamı** (`https://apitest.nes.com.tr/`, doküman: https://developertest.nes.com.tr/docs).
- Sahte rakam / uydurma veri gösterme; veri yoksa boş durum mesajı.
- Mobil görünüm her ekranda çalışmalı (sol menü mobilde çekmece).

## Next.js 16 notları
- Middleware → `src/proxy.ts`. `params`, `searchParams`, `cookies()`, `headers()` asenkron.
- Veritabanı okuyup istek başına değişen ama `cookies()` kullanmayan sayfalarda `await connection()` (yoksa build'de statik sabitlenir).
- `LayoutProps` / `PageProps` tipleri `next typegen` ile üretilir (typecheck script'i bunu çalıştırır).

## Ortam
- Yerel Postgres: `docker compose up -d` → port **55452** (diğer projeler 55432 / 55442).
- Testler `TEST_DATABASE_URL` (muhasebe_test) kullanır ve her testte tabloları siler.
- Prisma 7: bağlantı adresi `prisma.config.ts`, istemci `src/generated/prisma` (git dışı, `npm install` üretir).

## Faz sonu
`npm run check` (typecheck + lint + test + build) temiz geçmeden sonraki faza geçme.
