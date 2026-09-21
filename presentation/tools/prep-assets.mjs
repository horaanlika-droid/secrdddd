#!/usr/bin/env node
/* Ужимает AI-рендеры мебели до jpeg шириной 1000px средствами canvas в Chromium. */
import { chromium as pw } from '@playwright/test';
import sparticuz from '@sparticuz/chromium';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../miniapp/assets');
const names = (await fs.readdir(DIR)).filter(f => /^render-.*\.png$/.test(f));
const exe = await sparticuz.executablePath();
const browser = await pw.launch({ executablePath: exe, args: sparticuz.args, headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:' + (process.env.LD_LIBRARY_PATH || ''), FONTCONFIG_PATH: '/tmp/fonts' } });
const page = await browser.newPage();
for (const n of names) {
  const b64 = (await fs.readFile(path.join(DIR, n))).toString('base64');
  const out = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const w = 1000, h = Math.round(img.height * w / img.width);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.82).split(',')[1];
  }, b64);
  const dst = path.join(DIR, n.replace(/\.png$/, '.jpg'));
  await fs.writeFile(dst, Buffer.from(out, 'base64'));
  await fs.unlink(path.join(DIR, n));
  console.log('compressed', n, '->', path.basename(dst));
}
await browser.close();
console.log('DONE');
