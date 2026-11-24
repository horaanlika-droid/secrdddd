#!/bin/sh
# дибитишка · запуск в контейнере с самодиагностикой.
# Если хост подменяет /app своим каталогом (так бывает на Bothost), в логе
# сразу видно, откуда идёт запуск и что там лежит, — вместо голого
# «Cannot find module '/app/bot/src/index.js'».
here="$(cd "$(dirname "$0")" && pwd)"
for entry in "$here/src/index.js" "$PWD/bot/src/index.js" "$PWD/src/index.js" /app/bot/src/index.js /app/src/index.js; do
  if [ -f "$entry" ]; then exec node "$entry"; fi
done
echo "[start] точка входа не найдена. pwd=$PWD, скрипт=$here" >&2
echo "[start] содержимое $PWD:" >&2; ls -la "$PWD" >&2
echo "[start] содержимое /app:" >&2; ls -la /app >&2 2>/dev/null
exit 1
