import { chromium as pw } from '@playwright/test';
import sparticuz from '@sparticuz/chromium';
const exe = await sparticuz.executablePath();
const browser = await pw.launch({
  executablePath: exe, args: sparticuz.args, headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:' + (process.env.LD_LIBRARY_PATH || ''), FONTCONFIG_PATH: '/tmp/fonts' },
});
const page = await browser.newPage({ viewport: { width: 390, height: 260 }, deviceScaleFactor: 2 });
await page.setContent(`<body style="margin:0;background:#17212b;color:#fff;font-family:'Open Sans',sans-serif"><div style="padding:24px;font-size:34px;font-weight:700">Привет, Столярочка Yo!<br><span style="font-weight:400;font-size:20px">Конструктор мебели · yo kit · 0123456789 ₽</span></div></body>`);
await page.screenshot({ path: '/tmp/probe.png' });
await browser.close();
console.log('OK');
