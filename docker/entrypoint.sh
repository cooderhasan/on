#!/bin/sh
# Container başlangıcı: zorunlu ayarları kontrol et, migration'ları uygula, uygulamayı başlat.
set -e
: "${DATABASE_URL:?DATABASE_URL tanımlı değil}"
: "${ENCRYPTION_KEY:?ENCRYPTION_KEY tanımlı değil (32 byte base64; sonradan değiştirmeyin)}"

echo "[başlangıç] veritabanı migration'ları uygulanıyor…"
cd /app/migrate
node node_modules/prisma/build/index.js migrate deploy
cd /app

echo "[başlangıç] uygulama başlıyor (port ${PORT:-3000})"
exec node server.js
