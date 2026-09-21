#!/usr/bin/env node
/* Скриншоты экранов мини-аппа Yo Kit: поднимает локальный сервер, открывает
   каждый экран в headless Chromium (sparticuz) и снимает 390×844 @2x.
   Запуск: node presentation/tools/shot.mjs */
import { chromium as pw } from '@playwright/test';
import sparticuz from '@sparticuz/chromium';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'miniapp');
const OUT = path.join(ROOT, 'screenshots');
await fs.mkdir(OUT, { recursive: true });

/* библиотечный набор sparticuz переживает не каждый перезапуск песочницы —
   распаковываем al2023.tar.br сами, если libnspr4.so на месте нет */
import zlib from 'node:zlib';
import cp from 'node:child_process';
const LIB = '/tmp/al2023/lib/libnspr4.so';
if (!process.env.LD_LIBRARY_PATH?.includes('/tmp/al2023/lib') || !await fs.stat(LIB).catch(() => null)) {
  const br = path.join(ROOT, '..', 'node_modules', '@sparticuz', 'chromium', 'bin', 'al2023.tar.br');
  const tar = '/tmp/al2023.tar';
  await fs.writeFile(tar, zlib.brotliDecompressSync(await fs.readFile(br)));
  cp.execSync(`mkdir -p /tmp/al2023 && tar -xf ${tar} -C /tmp/al2023`);
}
process.env.LD_LIBRARY_PATH = '/tmp/al2023/lib:' + (process.env.LD_LIBRARY_PATH || '');
process.env.FONTCONFIG_PATH = '/tmp/fonts';

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.woff2':'font/woff2' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(APP, name);
  if (!file.startsWith(APP + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const bytes = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const SHOTS = [
  ['01-build',    '#build'],
  ['02-addsheet', '#build?sheet=add'],
  ['03-block',    '#block?sel=1'],
  ['04-project',  '#project'],
  ['05-materials','#materials'],
  ['06-summary',  '#summary'],
  ['07-chat',     '#chat'],
  ['08-orders',   '#orders'],
  ['09-profile',  '#profile'],
];

const exe = await sparticuz.executablePath();
const browser = await pw.launch({
  executablePath: exe, args: sparticuz.args, headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:' + (process.env.LD_LIBRARY_PATH || ''), FONTCONFIG_PATH: '/tmp/fonts' },
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
for (const [name, hash] of SHOTS) {
  const [h, q] = hash.slice(1).split('?');
  await page.goto(`${origin}/index.html?${q || ''}#${h}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('shot', name);
}
await browser.close();
server.close();
console.log('DONE');
