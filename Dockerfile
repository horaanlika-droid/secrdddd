# дибитишка · телеграм-бот (Docker)
#
#   сборка:  docker build -t dibitishka-bot .
#   запуск:  docker run -d --name dibitishka-bot --restart unless-stopped \
#               -e TG_TOKEN=... -e ADMIN_IDS=... [-e TRIBUTE_API=... -e OPENAI_API_KEY=...] \
#               -p 8080:8080 -v dibitishka-data:/data dibitishka-bot
#
# все три переменные (и PORT при необходимости) — см. docs/SETUP.md
#
# Три рубежа защиты от «Cannot find package 'grammy'»:
#   1. npm ci в стадии deps + копия node_modules в финальный образ;
#   2. RUN node bot/src/ensure-deps.js — проверяет и при нужде ДОСТАВЛЯЕТ
#      зависимости прямо на сборке, а --check роняет сборку, если не вышло;
#   3. RUN node scripts/smoke.mjs — образ обязан реально подняться и
#      ответить на /health ещё до деплоя.
# А если образ всё же уедет куда-то без node_modules, bot/src/index.js
# поставит их сам при старте (терминал не нужен).

FROM node:20-alpine AS deps
WORKDIR /app/bot
COPY bot/package.json bot/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DB_FILE=/data/db.json
WORKDIR /app

# манифесты — отдельно, чтобы слой с зависимостями пережил правки кода
COPY package.json package-lock.json ./
COPY bot/package.json bot/package-lock.json ./bot/
# Копируем исходники бота СНАЧАЛА, затем зависимости — так зависимости из deps
# гарантированно не будут перезатёрты локальной папкой bot/node_modules
# (которая исключена через .dockerignore, но порядок всё равно важен для кэша).
COPY bot/ ./bot/
COPY scripts/ ./scripts/
COPY --from=deps /app/bot/node_modules ./bot/node_modules

# Рубеж 2: зависимости обязаны резолвиться из bot/src — ровно так, как их
# ищет приложение. Если чего-то нет, ensure-deps доставит это сам, а --check
# не даст собрать образ с дырой.
RUN node bot/src/ensure-deps.js \
 && node bot/src/ensure-deps.js --check \
 && echo "--- node_modules ---" && ls -1 /app/bot/node_modules | head -n 20

# Рубеж 3: настоящий запуск бота (без polling, в Telegram не лезет).
# Не поднимется — сборка падает здесь, а не в проде.
RUN NO_POLLING=1 TG_TOKEN=build-check ADMIN_IDS=1 SMOKE_TIMEOUT_MS=60000 \
    node scripts/smoke.mjs

RUN mkdir -p /data && addgroup -S bot && adduser -S bot -G bot && chown -R bot:bot /app /data
USER bot
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bot/src/index.js"]
