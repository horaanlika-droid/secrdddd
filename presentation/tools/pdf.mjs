#!/usr/bin/env node
/* Печатает дек в PDF (1920×1080 на лист) и снимает контрольные png слайдов.
   Запуск: node presentation/tools/pdf.mjs [--shots 1,5,7] */
import { chromium as pw } from '@playwright/test';
import sparticuz from '@sparticuz/chromium';
import http from 'node:http';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import cp from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!await fs.stat('/tmp/al2023/lib/libnspr4.so').catch(() => null)) {
  const br = path.join(ROOT, '..', 'node_modules', '@sparticuz', 'chromium', 'bin', 'al2023.tar.br');
  await fs.writeFile('/tmp/al2023.tar', zlib.brotliDecompressSync(await fs.readFile(br)));
  cp.execSync('mkdir -p /tmp/al2023 && tar -xf /tmp/al2023.tar -C /tmp/al2023');
}
process.env.LD_LIBRARY_PATH = '/tmp/al2023/lib:' + (process.env.LD_LIBRARY_PATH || '');
process.env.FONTCONFIG_PATH = '/tmp/fonts';

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.woff2':'font/woff2' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const name = url.pathname === '/' ? 'deck/index.html' : url.pathname.slice(1);
  const file = path.resolve(ROOT, name);
  if (!file.startsWith(path.resolve(ROOT) + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const bytes = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const exe = await sparticuz.executablePath();
const browser = await pw.launch({ executablePath: exe, args: sparticuz.args, headless: true, env: { ...process.env } });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`${origin}/deck/index.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

const want = (process.argv.find(a => a.startsWith('--shots=')) || '').split('=')[1];
if (want) {
  const slides = await page.$$('.slide');
  for (const i of want.split(',').map(Number)) {
    await slides[i - 1].screenshot({ path: `/tmp/deck-${String(i).padStart(2, '0')}.png` });
    console.log('deckshot', i);
  }
}
const out = path.join(ROOT, 'yo-kit-presentation.pdf');
await page.pdf({ path: out, width: '1920px', height: '1080px', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 }, preferCSSPageSize: false });
console.log('PDF', out);
await browser.close();
server.close();
