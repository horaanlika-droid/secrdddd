#!/usr/bin/env node
/* ============================================================
   дибитишка · измерение shipped-записей (app/assets/ambience)
   ------------------------------------------------------------
   Запуск: node scripts/ambience/measure.mjs            (нужен ffmpeg)
           node scripts/ambience/measure.mjs --check    (только сверка)

   Зачем: в сценах (app/js/ambient.js) лежат `bed.seconds` и `bed.peak`
   — длина петли и её измеренный линейный пик. Из них считается бюджет
   громкости (сколько места до клиппинга) и проверка «петля не короче
   30 с». Если файл пересобрали, а цифры в сцене остались старыми,
   бюджет начнёт врать молча. Поэтому:

     • без --check скрипт измеряет файлы ffmpeg'ом и пишет
       scripts/ambience/files-report.json;
     • с --check (и в scripts/check-project.mjs) цифры из отчёта
       сверяются с тем, что записано в сценах, а размер файлов — с
       тем, что в отчёте. ffmpeg для сверки не нужен.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'app', 'assets', 'ambience');
const REPORT = path.join(ROOT, 'scripts', 'ambience', 'files-report.json');
const NAMES = ['sea', 'rain', 'hearth', 'forest', 'lullaby', 'space', 'chimes'];

function ffmpeg() {
  const candidates = [
    process.env.FFMPEG,
    'ffmpeg',
    path.join(ROOT, 'node_modules', '@ffmpeg-installer', 'linux-x64', 'ffmpeg')
  ].filter(Boolean);
  for (const bin of candidates) {
    try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return bin; } catch (e) {}
  }
  return null;
}

/**
 * Всё, что ffmpeg говорит про файл. Отчёт volumedetect он печатает в stderr
 * и без выходного файла вовсе падает — поэтому собираем оба потока и не
 * смотрим на код возврата.
 */
function probe(bin, file, args) {
  const r = spawnSync(bin, ['-hide_banner', '-nostats', '-i', file, ...args], { encoding: 'utf8' });
  return String(r.stdout || '') + String(r.stderr || '');
}

function measure() {
  const bin = ffmpeg();
  if (!bin) {
    console.error('ffmpeg не найден. Поставь его или запусти: npm i --no-save @ffmpeg-installer/ffmpeg');
    process.exit(1);
  }
  const out = [];
  for (const name of NAMES) {
    const rel = `assets/ambience/${name}.m4a`;
    const file = path.join(ROOT, 'app', rel);
    const info = probe(bin, file, []);
    const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
    const codec = /Audio: ([^ ,]+)\s*\(([^)]*)\)[^,]*,\s*(\d+) Hz,\s*(\w+)/.exec(info);
    const vol = probe(bin, file, ['-af', 'volumedetect', '-f', 'null', '-']);
    const mean = /mean_volume: (-?[\d.]+) dB/.exec(vol);
    const peak = /max_volume: (-?[\d.]+) dB/.exec(vol);
    out.push({
      file: rel,
      bytes: fs.statSync(file).size,
      seconds: dur ? Math.round(((+dur[1] * 3600 + +dur[2] * 60 + parseFloat(dur[3])) ) * 100) / 100 : null,
      codec: codec ? `${codec[1]} (${codec[2]})` : null,
      sample_rate: codec ? Number(codec[3]) : null,
      channels: codec ? codec[4] : null,
      mean_dbfs: mean ? Number(mean[1]) : null,
      peak_dbfs: peak ? Number(peak[1]) : null,
      peak_linear: peak ? Math.round(Math.pow(10, peak[1] / 20) * 1000) / 1000 : null
    });
  }
  fs.writeFileSync(REPORT, JSON.stringify(out, null, 2) + '\n');
  for (const r of out) {
    console.log(`${path.basename(r.file).padEnd(12)} ${String(r.seconds).padStart(6)} с  ${(r.bytes / 1024).toFixed(0).padStart(4)} КБ  ${r.codec} ${r.sample_rate} Гц ${r.channels}  RMS ${r.mean_dbfs} dBFS  пик ${r.peak_dbfs} dBFS (${r.peak_linear})`);
  }
  console.log(`\nотчёт: ${path.relative(ROOT, REPORT)}`);
}

if (process.argv.includes('--check')) {
  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  let bad = 0;
  for (const r of report) {
    const file = path.join(ROOT, 'app', r.file);
    const bytes = fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (bytes !== r.bytes) { console.error(`✗ ${r.file}: на диске ${bytes} Б, в отчёте ${r.bytes} Б — пересобери и обнови отчёт`); bad++; }
  }
  if (bad) process.exit(1);
  console.log(`✓ записи соответствуют отчёту (${report.length} файлов)`);
} else {
  measure();
}
