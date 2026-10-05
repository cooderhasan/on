# syntax=docker/dockerfile:1
# Ön Muhasebe — Coolify için üretim imajı (Next.js standalone + Prisma migrate deploy)

FROM node:24-alpine AS deps
WORKDIR /app
# prisma.config.ts DATABASE_URL okur; derleme sırasında gerçek veritabanı gerekmez
ENV DATABASE_URL=postgresql://derleme:derleme@localhost:5432/derleme
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# npm ci yerine install: kilit Windows'ta üretildiğinde Linux'a özgü isteğe bağlı paketler (@emnapi/*) eksik kalıyor;
# install sürümleri kilitten alır, yalnızca eksikleri tamamlar
RUN npm install --no-audit --no-fund

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgresql://derleme:derleme@localhost:5432/derleme
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# Çalışma anında yalnızca migration için Prisma CLI (uygulama paketlerinden ayrı, küçük)
FROM node:24-alpine AS migrator
WORKDIR /migrate
COPY package.json /tmp/package.json
RUN npm init -y >/dev/null \
 && npm install --no-audit --no-fund \
      "prisma@$(node -p "require('/tmp/package.json').devDependencies.prisma")" \
      "dotenv@$(node -p "require('/tmp/package.json').dependencies.dotenv")"

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=migrator --chown=app:app /migrate/node_modules ./migrate/node_modules
COPY --chown=app:app prisma ./migrate/prisma
COPY --chown=app:app prisma.config.ts ./migrate/prisma.config.ts
COPY --chown=app:app docker/entrypoint.sh ./entrypoint.sh
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/saglik >/dev/null || exit 1
ENTRYPOINT ["sh", "./entrypoint.sh"]
