# дибитишка · телеграм-бот (Docker)
#
#   сборка:  docker build -t dibitishka-bot .
#   запуск:  docker run -d --name dibitishka-bot --restart unless-stopped \
#               -e TG_TOKEN=... -e ADMIN_IDS=... [-e TRIBUTE_API=...] \
#               -p 8080:8080 -v dibitishka-data:/data dibitishka-bot
#
# все три переменные (и PORT при необходимости) — см. docs/SETUP.md

FROM node:20-alpine AS deps
WORKDIR /app/bot
COPY bot/package.json bot/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && echo "--- deps installed ---" && ls -1 node_modules | head -n 20 \
 && test -d node_modules/grammy || (echo "ERROR: grammy not installed in deps stage" && exit 1) \
 && test -f node_modules/grammy/package.json && echo "✓ grammy ok" \
 && test -d node_modules/pngjs && echo "✓ pngjs ok" \
 && test -d node_modules/jpeg-js && echo "✓ jpeg-js ok"

FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DB_FILE=/data/db.json
WORKDIR /app
# Копируем исходники бота СНАЧАЛА, затем зависимости — так зависимости из deps
# гарантированно не будут перезатёрты локальной папкой bot/node_modules
# (которая исключена через .dockerignore, но порядок всё равно важен для кэша).
COPY bot/ ./bot/
COPY --from=deps /app/bot/node_modules ./bot/node_modules
# Верификация что зависимости на месте в финальном образе
RUN test -d /app/bot/node_modules/grammy || (echo "ERROR: grammy missing in final image" && ls -la /app/bot/ && ls -la /app/bot/node_modules 2>&1 | head -n 50 && exit 1) \
 && echo "✓ final image: grammy, pngjs, jpeg-js present" && ls -1 /app/bot/node_modules | head -n 20
RUN mkdir -p /data && addgroup -S bot && adduser -S bot -G bot && chown -R bot:bot /app /data
USER bot
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bot/src/index.js"]
