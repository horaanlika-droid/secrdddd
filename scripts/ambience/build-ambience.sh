#!/usr/bin/env bash
# ============================================================
# build-ambience.sh — воспроизводимая сборка записей для тихой музыки
# ------------------------------------------------------------
# Делает всё с нуля: качает открытые записи (CC0), приводит их к
# одному виду, собирает бесшовные петли, кодирует в .m4a и измеряет
# результат (длина, RMS, пик) — цифры, которые лежат в AMBIENT_SCENES
# (bed.seconds и bed.peak) и из которых считается бюджет громкости.
#
# Требуется: bash, node >= 18, git, gh (авторизованный) или curl,
#            ffmpeg (если нет — скрипт поставит его из npm).
#
# Запуск:  bash scripts/ambience/build-ambience.sh
#          FFMPEG=/путь/к/ffmpeg bash scripts/ambience/build-ambience.sh
# Итог:    app/assets/ambience/*.m4a
#          scripts/ambience/files-report.json  (измерения готовых файлов)
#          scripts/ambience/loop-report.json   (метрики петель до кодирования)
# Черновики: test-results/ambience/ (в git не попадает)
#
# После пересборки обязательно:
#   1. npm run ambient-test  — сверит bed.seconds/bed.peak с измерениями;
#   2. npm run check         — сверит вес файлов и отчёт;
#   3. послушать сцены в браузере (npm run browser-test или вручную).
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
WORK="$ROOT/test-results/ambience"
OUT="$ROOT/app/assets/ambience"
mkdir -p "$WORK/raw" "$WORK/out" "$OUT"

say() { printf '\n\033[1;36m%s\033[0m\n' "$1"; }

# ---------- 1. инструменты ----------
say "1/6 инструменты"
command -v node >/dev/null || { echo "нужен node >= 18"; exit 1; }
command -v git  >/dev/null || { echo "нужен git"; exit 1; }

FF="${FFMPEG:-}"
if [ -z "$FF" ]; then FF=$(command -v ffmpeg || true); fi
if [ -z "$FF" ]; then
  for cand in "$ROOT/node_modules/@ffmpeg-installer/linux-x64/ffmpeg" \
              "$ROOT/node_modules/@ffmpeg-installer/darwin-x64/ffmpeg"; do
    [ -x "$cand" ] && FF="$cand" && break
  done
fi
if [ -z "$FF" ]; then
  echo "ffmpeg не найден — ставлю из npm (без сети не выйдет)"
  npm i --no-save --no-audit --no-fund @ffmpeg-installer/ffmpeg >/dev/null 2>&1 || true
  for cand in "$ROOT/node_modules/@ffmpeg-installer/linux-x64/ffmpeg" \
              "$ROOT/node_modules/@ffmpeg-installer/darwin-x64/ffmpeg"; do
    [ -x "$cand" ] && FF="$cand" && break
  done
fi
[ -n "$FF" ] || { echo "ffmpeg так и не появился — поставь его вручную"; exit 1; }
echo "ffmpeg: $FF"

# ---------- 2. исходные записи (CC0) ----------
say "2/6 открытые записи (CC0 1.0)"
SRC="$WORK/src"
mkdir -p "$SRC/freesfx"
if [ ! -d "$SRC/Coolhead-Ambience" ]; then
  echo "· клонирую Coolhead-Ambience (полевые записи: лес, дождь, река, волны, колокольчики)"
  git clone --depth 1 -q https://github.com/biomathcode/Coolhead-Ambience.git "$SRC/Coolhead-Ambience"
fi
# короткие петли костра — из Free-SFX (тоже CC0).
# raw.githubusercontent.com в песочнице недоступен — берём через GitHub API.
R=EternityForest/Free-SFX
get_blob() { # $1 путь в репозитории, $2 куда
  local p="$1" out="$2"
  if [ -f "$out" ]; then echo "· уже есть: $(basename "$out")"; return; fi
  local sha
  sha=$(gh api "repos/$R/git/trees/HEAD?recursive=1" --jq ".tree[]|select(.path==\"$p\")|.sha")
  gh api "repos/$R/git/blobs/$sha" --jq '.content' | tr -d '\n' | base64 -d > "$out"
  echo "· скачано: $(basename "$out") ($(du -h "$out" | cut -f1))"
}
get_blob "PagDev/fire_loop.opus" "$SRC/freesfx/fire_loop.opus"

# ---------- 3. приведение к одному виду ----------
say "3/6 приведение дорожек к 48 кГц / моно / float32"
dec() { # $1 вход, $2 выход, $3 фильтры
  "$FF" -v error -y -i "$1" -af "${3:-anull}" -ac 1 -ar 48000 -f f32le "$WORK/raw/$2"
  printf '· %-14s <- %s\n' "$2" "$(basename "$1")"
}
dec "$SRC/Coolhead-Ambience/WaveLight1.wav"       sea.f32     "highpass=f=45"
dec "$SRC/Coolhead-Ambience/RainDripping1.wav"    rain.f32    "highpass=f=80"
dec "$SRC/Coolhead-Ambience/Forest1.wav"          forest.f32  "highpass=f=90"
dec "$SRC/Coolhead-Ambience/BirdsChirping1.wav"   birds.f32   "highpass=f=250,volume=-7dB"
dec "$SRC/freesfx/fire_loop.opus"                 fire.f32    ""
dec "$SRC/Coolhead-Ambience/VinylCrackle1.wav"    crackle.f32 "highpass=f=400"
dec "$SRC/Coolhead-Ambience/RiverLight1.wav"      river.f32   "lowpass=f=560,highpass=f=50"
dec "$SRC/Coolhead-Ambience/WaterfallStream1.wav" shimmer.f32 "highpass=f=3000,lowpass=f=9500"

# ---------- 4. бесшовные петли ----------
say "4/6 бесшовные петли (кроссфейд + нормировка по RMS)"
RAW_DIR="$WORK/raw" node scripts/ambience/loopify.mjs scripts/ambience/recipes.json "$WORK/out"
cp "$WORK/out/report.json" "$ROOT/scripts/ambience/loop-report.json"

# ---------- 5. кодирование ----------
say "5/6 кодирование в AAC (m4a)"
for n in sea rain hearth forest lullaby space; do
  "$FF" -v error -y -f f32le -ar 48000 -ac 1 -i "$WORK/out/$n.f32" \
    -c:a aac -b:a 80k -profile:a aac_low -movflags +faststart "$OUT/$n.m4a"
done
# настоящие колокольчики — редкие живые акценты поверх музыки
"$FF" -v error -y -i "$SRC/Coolhead-Ambience/Windchimes1.wav" -af "highpass=f=200,volume=-4dB" \
  -ac 1 -ar 48000 -c:a aac -b:a 80k -movflags +faststart "$OUT/chimes.m4a"

# ---------- 6. измерения ----------
say "6/6 измерения готовых файлов"
FFMPEG="$FF" node scripts/ambience/measure.mjs

printf '\nИтог:\n'
ls -la "$OUT" | awk 'NR>3 {printf "  %7.0f КБ  %s\n", $5/1024, $9}'
echo
echo "Проверка громкости (интегрированная, LUFS):"
for f in "$OUT"/*.m4a; do
  printf '  %-14s ' "$(basename "$f")"
  "$FF" -hide_banner -nostats -i "$f" -filter_complex ebur128 -f null - 2>&1 \
    | grep -E "^\s+I:" | tail -1 | tr -s ' '
done
echo
echo "Дальше: npm run ambient-test && npm run check"
echo "Если длины или пики петель изменились — обнови bed.seconds/bed.peak в app/js/ambient.js."
