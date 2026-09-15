/* Tribute — минимальный ежемесячный донат открывает доступ на месяц.
   Ссылка на Donation Request хранится в постоянной базе бота и меняется
   админом командой /tribute set <ссылка> без деплоя и перезапуска.

   Tribute присылает new_donation при первом платеже и recurrent_donation при
   следующих. Мы принимаем только period=monthly и только событие именно той
   Donation Request, чья ссылка сейчас настроена. Разовые/чужие донаты доступ
   не открывают. TRIBUTE_API на хосте нужен для HMAC-проверки вебхуков.

   TRIBUTE_MONTHLY_URL остаётся необязательным стартовым fallback на случай
   пустой базы; обычный способ управления — админ-панель бота.
*/
import crypto from 'node:crypto';

const BASE = (process.env.TRIBUTE_BASE || 'https://tribute.tg').replace(/\/$/, '');
const KEY = () => (process.env.TRIBUTE_API || '').trim();
const SHOP_ID = () => (process.env.TRIBUTE_SHOP_ID || '').trim();

/** Режим динамических заказов через Shops API (по умолчанию выключен). */
export const shopMode = () => process.env.TRIBUTE_SHOP === '1';

let dynamicPayUrl = '';

/** Принимаем только официальный Telegram web_app_link Donation Request. */
export function normalizePayUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, error: 'empty' };
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const telegramHost = host === 't.me' || host === 'telegram.me';
    if (u.protocol !== 'https:' || !telegramHost) return { ok: false, error: 'host' };
    const token = u.searchParams.get('startapp') || '';
    // Берём именно Telegram web_app_link: тот же URL приходит в webhook,
    // поэтому текущую Donation Request можно сопоставить без догадок.
    const tributeDonationLink = /^\/tribute\/app\/?$/i.test(u.pathname) && /^d[\w-]+$/i.test(token);
    if (!tributeDonationLink) return { ok: false, error: 'format' };
    u.hash = '';
    return { ok: true, url: u.toString() };
  } catch { return { ok: false, error: 'url' }; }
}

/** Обновить runtime-ссылку из постоянной базы. Невалидное значение не меняет
    текущую настройку. Пустая строка очищает override и включает env fallback. */
export function setDynamicPayUrl(value) {
  if (!String(value || '').trim()) { dynamicPayUrl = ''; return { ok: true, url: '' }; }
  const parsed = normalizePayUrl(value);
  if (parsed.ok) dynamicPayUrl = parsed.url;
  return parsed;
}

const envPayUrl = () => {
  const parsed = normalizePayUrl(process.env.TRIBUTE_MONTHLY_URL || '');
  return parsed.ok ? parsed.url : '';
};
/* v35: владелец указал один Donation Request на ежемесячную и разовую
   поддержку — dQui. Это дефолт репозитория: админ может заменить его
   через /tribute set <ссылка> или TRIBUTE_MONTHLY_URL в окружении. */
const REPO_PAY_URL = 'https://t.me/tribute/app?startapp=dQui';
const repoPayUrl = () => (normalizePayUrl(REPO_PAY_URL).ok ? REPO_PAY_URL : '');
export const getPayUrl = () => dynamicPayUrl || envPayUrl() || repoPayUrl() || null;

/** Токен ссылки вида startapp=dABC позволяет связать webhook с конкретной
    Donation Request даже если Telegram вернул ссылку с другим доменом. */
const donationToken = (value) => {
  try {
    const u = new URL(String(value || ''));
    const token = u.searchParams.get('startapp');
    if (token) return token.toLowerCase();
    const last = u.pathname.split('/').filter(Boolean).at(-1) || '';
    return /^d[\w-]+$/i.test(last) ? last.toLowerCase() : '';
  } catch { return ''; }
};

/** Платёж готов только когда есть и ссылка, и ключ проверки webhook. Иначе
    нельзя вести человека к оплате, после которой доступ не активируется. */
export const tributeConfigured = () => !!getPayUrl() && !!KEY();

/** Короткий безопасный статус: полную платёжную ссылку в /health не отдаём. */
export const tributeStatus = () => ({
  ok: tributeConfigured(),
  link: !!getPayUrl(),
  key: !!KEY(),
  shop: shopMode(),
  source: dynamicPayUrl ? 'admin' : envPayUrl() ? 'env' : repoPayUrl() ? 'repo' : null,
  donation_token: !!donationToken(getPayUrl())
});

/** Вернуть актуальную ссылку из админ-панели/окружения. Аргументы оставлены
    для совместимости с прежним вызовом тарифов. */
export async function createSubscriptionLink(_userId, _plan) {
  const url = getPayUrl();
  return tributeConfigured() && url ? { url, id: null } : null;
}

/** Разовая оплата (мерч, печатная тетрадь) — только через Shops API. */
export async function createOneTimeLink(userId, amountRub, description) {
  if (!(shopMode() && KEY())) return null;
  return createShopOrder(userId, { id: 'once', label: description || 'Оплата', price: amountRub, days: 0 });
}

/* POST https://tribute.tg/api/v1/shop/orders — динамический заказ.
   Ответ содержит paymentUrl (браузер) и webappPaymentUrl (t.me/tribute/app?startapp=…). */
async function createShopOrder(userId, plan) {
  const amountRub = Number(plan.price) || 0;
  if (amountRub <= 0) return null;
  const body = {
    amount: Math.round(amountRub * 100), // копейки
    currency: 'rub',
    title: `Дибитишка · ${plan.label || 'подписка'}`.slice(0, 100),
    description: `Подписка Дибитишки: ${plan.label || ''}${plan.days ? ` (${plan.days} дн.)` : ''}`.slice(0, 300),
    customerId: String(userId),
    period: plan.period || 'onetime'
  };
  if (SHOP_ID()) body.shopId = Number(SHOP_ID()) || SHOP_ID();
  try {
    const r = await fetch(`${BASE}/api/v1/shop/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Api-Key': KEY() },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    if (!r.ok) { console.error('[tribute] shop order error', r.status, text.slice(0, 500)); return null; }
    const j = JSON.parse(text);
    const url = j.webappPaymentUrl || j.paymentUrl || null;
    if (!url) { console.error('[tribute] shop order: нет ссылки в ответе', text.slice(0, 500)); return null; }
    return { url, id: j.uuid || null };
  } catch (e) { console.error('[tribute] shop order exception', e.message); return null; }
}

/** Проверить ключ: дёргаем безобидный GET /api/v1/products (1 шт.).
    Возвращает { ok, reason } — reason: 'no_key' | 'bad_key' | 'network' | null. */
export async function checkApiKey() {
  if (!KEY()) return { ok: false, reason: 'no_key' };
  try {
    const r = await fetch(`${BASE}/api/v1/products?page=1&size=1`, { headers: { 'Api-Key': KEY() } });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: 'bad_key' };
    if (!r.ok) return { ok: false, reason: 'http_' + r.status };
    return { ok: true, reason: null };
  } catch (e) { return { ok: false, reason: 'network' }; }
}

/* ---------- вебхуки ---------- */

/** Проверить подпись вебхука: заголовок trbt-signature = HMAC-SHA256 hex/base64
    от сырого тела запроса на API-ключе. Без ключа fail closed: иначе любой,
    кто знает публичный webhook URL, смог бы выдать себе доступ. */
export function verifySignature(rawBody, sigHeader) {
  const key = KEY();
  if (!key) return { ok: false, reason: 'no_key' };
  const sig = String(sigHeader || '').trim();
  if (!sig) return { ok: false, reason: 'no_signature' };
  const hex = crypto.createHmac('sha256', key).update(rawBody, 'utf8').digest('hex');
  const b64 = crypto.createHmac('sha256', key).update(rawBody, 'utf8').digest('base64');
  const target = Buffer.from(sig);
  for (const candidate of [hex, b64]) {
    const buf = Buffer.from(candidate);
    if (buf.length === target.length && crypto.timingSafeEqual(buf, target)) return { ok: true };
  }
  return { ok: false, reason: 'bad_signature' };
}

/** Webhook должен относиться к той же Donation Request, которую админ
    поставил в /tribute set. Сравниваем startapp-токен, числовой id или URL. */
export function matchesConfiguredDonation(payload = {}) {
  const configured = getPayUrl();
  if (!configured) return false;
  const expectedToken = donationToken(configured);
  const eventToken = donationToken(payload.web_app_link);
  if (expectedToken && eventToken) return expectedToken === eventToken;
  const id = String(payload.donation_request_id || '');
  if (expectedToken && id && expectedToken === ('d' + id).toLowerCase()) return true;
  try {
    const clean = value => { const u = new URL(value); u.hash = ''; return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}`; };
    return !!payload.web_app_link && clean(configured) === clean(payload.web_app_link);
  } catch { return false; }
}

/** Минимум задаётся в самом Donation Request на стороне Tribute. В коде нет
    цены: важны положительный платёж, ежемесячный период и совпавшая ссылка. */
export const isMonthlyDonation = (payload = {}) => (
  String(payload.period || '').toLowerCase() === 'monthly'
  && Number(payload.amount) > 0
  && matchesConfiguredDonation(payload)
);

export const isPaidEvent = (name, payload = {}) => (
  (name === 'new_donation' || name === 'recurrent_donation')
  && isMonthlyDonation(payload)
);

/** Ключ для защиты от повторной обработки. У donation-webhook нет transaction_id,
    поэтому пара request_id + created_at отличает новый месяц от ретрая события. */
export const webhookDedupeKey = (event = {}) => {
  const p = event.payload || {};
  const id = p.purchase_id || p.transaction_id || p.order_id || p.uuid;
  if (event.name && id) return `${event.name}:${id}`;
  if (event.name && p.subscription_id && event.created_at) {
    return `${event.name}:${p.subscription_id}:${event.created_at}`;
  }
  if (event.name && p.donation_request_id && event.created_at) {
    return `${event.name}:${p.donation_request_id}:${event.created_at}`;
  }
  return null;
};

/** Donation Request одна и ежемесячная: если Tribute не прислал expires_at,
    каждый подтверждённый платёж даёт ровно один 30-дневный цикл доступа. */
export function daysForTributePayload(_payload = {}) {
  return 30;
}
