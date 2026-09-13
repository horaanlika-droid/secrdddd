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
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DB_FILE=/data/db.json
WORKDIR /app
COPY --from=deps /app/bot/node_modules /app/bot/node_modules
COPY bot/ /app/bot/
RUN mkdir -p /data && addgroup -S bot && adduser -S bot -G bot && chown -R bot:bot /app /data
USER bot
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bot/src/index.js"]
