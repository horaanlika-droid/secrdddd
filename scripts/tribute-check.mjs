#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizePayUrl,
  setDynamicPayUrl,
  getPayUrl,
  tributeStatus,
  isPaidEvent,
  webhookDedupeKey,
  verifySignature
} from '../bot/src/tribute.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'bot', 'src', 'index.js');
const url = 'https://t.me/tribute/app?startapp=dMonthlyDemo';

/* Быстрые unit-проверки правил ссылки и событий. */
assert.equal(normalizePayUrl(url).ok, true, 'официальная Donation Request должна приниматься');
assert.equal(normalizePayUrl('https://evil.example/tribute/app?startapp=dMonthlyDemo').ok, false, 'чужой домен нельзя сохранить');
assert.equal(normalizePayUrl('https://t.me/tribute/app?startapp=pOldProduct').ok, false, 'ссылка старого цифрового товара не подходит');
assert.equal(normalizePayUrl('javascript:alert(1)').ok, false, 'нужен https URL');
assert.equal(getPayUrl(), 'https://t.me/tribute/app?startapp=dQui', 'без админ-ссылки и env работает дефолт репозитория dQui');
assert.equal(tributeStatus().source, 'repo', 'источник дефолта виден в статусе');
assert.equal(setDynamicPayUrl(url).ok, true);
assert.equal(getPayUrl(), url);
assert.equal(tributeStatus().source, 'admin');
const previousKey = process.env.TRIBUTE_API;
delete process.env.TRIBUTE_API;
assert.equal(verifySignature('{}', '').reason, 'no_key', 'без API-ключа webhook должен быть закрыт');
if (previousKey === undefined) delete process.env.TRIBUTE_API;
else process.env.TRIBUTE_API = previousKey;

const monthly = {
  donation_request_id: 42,
  web_app_link: url,
  period: 'monthly',
  amount: 1,
  currency: 'rub',
  telegram_user_id: 777
};
assert.equal(isPaidEvent('new_donation', monthly), true, 'первый monthly-донат открывает доступ');
assert.equal(isPaidEvent('recurrent_donation', monthly), true, 'повторный monthly-донат продлевает доступ');
assert.equal(isPaidEvent('new_donation', { ...monthly, period: 'once' }), false, 'разовый донат не открывает доступ');
assert.equal(isPaidEvent('new_donation', { ...monthly, web_app_link: 'https://t.me/tribute/app?startapp=dOther' }), false, 'другая Donation Request не открывает доступ');
assert.equal(isPaidEvent('new_donation', { ...monthly, amount: 0 }), false, 'нулевой платёж не открывает доступ');

const first = { name: 'recurrent_donation', created_at: '2026-09-15T10:00:00Z', payload: monthly };
const retry = structuredClone(first);
const nextMonth = { ...first, created_at: '2026-10-15T10:00:00Z' };
assert.equal(webhookDedupeKey(first), webhookDedupeKey(retry), 'ретрай имеет тот же ключ');
assert.notEqual(webhookDedupeKey(first), webhookDedupeKey(nextMonth), 'новый месяц не считается дублем');

/* Интеграция: настоящая точка входа читает URL из db.json, проверяет подпись,
   активирует доступ и сразу сохраняет его. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = await freePort();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dibitishka-tribute-'));
const dbFile = path.join(dir, 'db.json');
const secret = 'tribute-test-secret';
fs.writeFileSync(dbFile, JSON.stringify({
  settings: { tribute_monthly_url: url },
  content: {
    version: 7,
    meta: { price_note: 'СТАРАЯ ЦЕНА', mascot_lines: { paywall: ['СТАРАЯ ЦЕНА', 'вторая строка'] } },
    blocks: []
  },
  users: {
    777: { id: 777, name: 'Тест', joined: Date.now(), trial_start: Date.now(), premium_until: 0, reminder: { on: false, time: '09:00', tz: 3 } }
  }
}));

const child = spawn(process.execPath, [ENTRY], {
  cwd: ROOT,
  env: {
    ...process.env,
    TG_TOKEN: '123456:tribute-test-token',
    ADMIN_IDS: '1',
    TRIBUTE_API: secret,
    PORT: String(port),
    DB_FILE: dbFile,
    NO_POLLING: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
child.stdout.on('data', d => { logs += d; });
child.stderr.on('data', d => { logs += d; });
let exited = null;
child.on('exit', (code, signal) => { exited = { code, signal }; });

const postEvent = async (event, signature) => {
  const body = JSON.stringify(event);
  const sig = signature ?? crypto.createHmac('sha256', secret).update(body).digest('hex');
  const response = await fetch(`http://127.0.0.1:${port}/tribute/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'trbt-signature': sig },
    body
  });
  return { status: response.status, body: await response.json() };
};
const readUser = () => JSON.parse(fs.readFileSync(dbFile, 'utf8')).users['777'];

try {
  const deadline = Date.now() + 15000;
  let health;
  while (Date.now() < deadline && !exited) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) { health = await response.json(); break; }
    } catch { /* сервер ещё запускается */ }
    await sleep(100);
  }
  assert(!exited, `бот завершился до теста: ${JSON.stringify(exited)}\n${logs}`);
  assert(health?.ok, `бот не поднялся\n${logs}`);
  assert.equal(health.tribute.source, 'admin', 'runtime-ссылка должна загрузиться из постоянной базы');
  assert.equal(health.tribute.ok, true, 'ссылка и ключ вместе должны включить /pay');

  const contentResponse = await fetch(`http://127.0.0.1:${port}/content.json`);
  const migratedContent = await contentResponse.json();
  assert.equal(migratedContent.version, 9, 'постоянная копия контента должна мигрировать');
  assert.equal(migratedContent.merch.length, 2);
  assert.equal(migratedContent.merch[0].id, 'cap');
  assert.match(migratedContent.meta.price_note, /минимальный донат/i, 'старая цена должна исчезнуть из постоянной копии');

  const event = { name: 'new_donation', created_at: '2026-09-15T12:00:00Z', payload: monthly };
  const paid = await postEvent(event);
  assert.equal(paid.status, 200);
  assert.equal(paid.body.ok, true);
  const firstUntil = readUser().premium_until;
  assert(firstUntil > Date.now() + 29 * 86400000, 'webhook должен открыть месяц доступа');

  const duplicate = await postEvent(event);
  assert.equal(duplicate.body.dup, true, 'ретрай должен распознаться как дубль');
  assert.equal(readUser().premium_until, firstUntil, 'ретрай не должен начислить второй месяц');

  const wrongRequest = {
    ...event,
    created_at: '2026-09-16T12:00:00Z',
    payload: { ...monthly, web_app_link: 'https://t.me/tribute/app?startapp=dOther' }
  };
  assert.equal((await postEvent(wrongRequest)).body.ignored, 'new_donation');
  assert.equal(readUser().premium_until, firstUntil, 'чужая Donation Request не меняет доступ');

  const oneTime = { ...event, created_at: '2026-09-17T12:00:00Z', payload: { ...monthly, period: 'once' } };
  assert.equal((await postEvent(oneTime)).body.ignored, 'new_donation');
  assert.equal(readUser().premium_until, firstUntil, 'разовый донат не меняет доступ');

  assert.equal((await postEvent(event, 'bad-signature')).status, 401, 'неверная подпись должна отклоняться');
} finally {
  const exitPromise = exited ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve));
  if (!exited) child.kill('SIGKILL');
  await Promise.race([exitPromise, sleep(1000)]);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('✓ Tribute: база, runtime-ссылка, подпись, monthly-фильтр и дедупликация работают');
