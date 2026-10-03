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

## Komutlar

| Komut | İş |
|---|---|
| `npm run check` | typecheck + lint + test + build (her faz sonunda temiz olmalı) |
| `npm test` | testler (ayrı `muhasebe_test` veritabanında) |
| `npm run db:migrate` | şema değişikliği sonrası yeni migration |
