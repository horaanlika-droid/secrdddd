/* Tribute — приём оплаты подписки.
   Как это устроено по-настоящему (см. https://wiki.tribute.tg):
   - ссылки на оплату НЕ создаются запросом «дай ссылку», а берутся готовыми
     из кабинета Tribute: создаёшь цифровой товар / подписку под каждый тариф
     (1/3/6 мес.) и копируешь его ссылку вида https://t.me/tribute/app?startapp=p123;
   - API-ключ нужен боту в первую очередь чтобы ПРОВЕРЯТЬ вебхуки Tribute
     (подпись HMAC-SHA256 в заголовке trbt-signature), а не чтобы создавать ссылки;
   - после оплаты Tribute сам шлёт POST на наш /tribute/webhook с telegram_user_id
     покупателя — бот активирует подписку по этому id.
   Переменные на бот-хосте:
     TRIBUTE_API           — ключ из кабинета Tribute (Настройки → API Keys)
     TRIBUTE_M1_URL        — ссылка на товар «1 месяц» (обязательно для тарифа m1)
     TRIBUTE_M3_URL        — ссылка на товар «3 месяца»
     TRIBUTE_M6_URL        — ссылка на товар «6 месяцев»
     TRIBUTE_PAY_URL       — запасная ссылка на все тарифы (если товар пока один)
     TRIBUTE_PRODUCT_DAYS  — соответствие «id товара/подписки → дни», напр. "456=30,457=90,458=180"
                             (id видно в кабинете и в вебхуках; без него — 30 дней по умолчанию,
                             а для подписок с expires_at срок берётся из вебхука)
     TRIBUTE_SHOP=1        — РЕДКИЙ режим: создавать заказ через Shops API
                             (POST /api/v1/shop/orders) вместо статичных ссылок.
                             Нужен настроенный магазин Tribute; обычно не нужен.
     TRIBUTE_BASE          — переопределить хост (по умолчанию https://tribute.tg)
     TRIBUTE_SHOP_ID       — id магазина для Shops API (если их несколько)
*/
import crypto from 'node:crypto';

const BASE = (process.env.TRIBUTE_BASE || 'https://tribute.tg').replace(/\/$/, '');
const KEY = () => (process.env.TRIBUTE_API || '').trim();
const SHOP_ID = () => (process.env.TRIBUTE_SHOP_ID || '').trim();

/** Режим динамических заказов через Shops API (по умолчанию выключен). */
export const shopMode = () => process.env.TRIBUTE_SHOP === '1';

/** Статичная ссылка на оплату тарифа из кабинета Tribute (или общая запасная). */
export const getPayUrl = (planId) => (
  (process.env[`TRIBUTE_${String(planId || '').toUpperCase()}_URL`] || '').trim()
  || (process.env.TRIBUTE_PAY_URL || '').trim()
  || null
);

/** Оплата считается настроенной, если есть хоть одна ссылка — или включён Shops API с ключом. */
export const tributeConfigured = () => (
  !!getPayUrl('m1') || !!getPayUrl('m3') || !!getPayUrl('m6')
  || (shopMode() && !!KEY())
);

/** Короткий статус для /health и админской команды /tribute. */
export const tributeStatus = () => ({
  ok: tributeConfigured(),
  key: !!KEY(),
  shop: shopMode(),
  urls: { m1: !!getPayUrl('m1'), m3: !!getPayUrl('m3'), m6: !!getPayUrl('m6') }
});

/** Создать ссылку на оплату подписки на выбранный тариф.
    plan: { id: 'm1'|'m3'|'m6', label, price, days } (см. PLANS в bot/src/app.js).
    Возвращает { url, id } или null. */
export async function createSubscriptionLink(userId, plan = { id: 'm1', label: '1 месяц', price: 200, days: 30 }) {
  const planId = plan.id || 'm1';
  // 1) обычный путь: готовая ссылка из кабинета Tribute
  const staticUrl = getPayUrl(planId);
  if (staticUrl) return { url: staticUrl, id: null };
  // 2) редкий путь: динамический заказ через Shops API
  if (shopMode() && KEY()) return createShopOrder(userId, plan);
  return null;
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
    period: 'onetime'
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
    от сырого тела запроса на API-ключе. Без ключа проверять нечего — принимаем,
    но помечаем skipped, чтобы в логе было видно, что так нельзя оставлять. */
export function verifySignature(rawBody, sigHeader) {
  const key = KEY();
  if (!key) return { ok: true, skipped: true };
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

/** События, означающие «деньги пришли»: цифровой товар куплен, подписка
    оформлена или продлена. Остальное (отмены, донаты, возвраты) подписку не даёт. */
export const isPaidEvent = (name) => (
  name === 'new_digital_product' || name === 'new_subscription' || name === 'renewed_subscription'
);

/** Ключ для защиты от повторной обработки: Tribute шлёт ретраи до суток,
    если мы не ответили 200. Без дедупа повтор вебхука накинет дни дважды. */
export const webhookDedupeKey = (event = {}) => {
  const p = event.payload || {};
  const id = p.purchase_id || p.period_id || p.transaction_id || p.order_id || p.uuid;
  return event.name && id ? `${event.name}:${id}` : null;
};

/** Сколько дней дать за вебхук: сначала смотрим карту TRIBUTE_PRODUCT_DAYS
    по product_id/subscription_id, потом период подписки, иначе 30. */
export function daysForTributePayload(payload = {}) {
  const map = {};
  for (const part of String(process.env.TRIBUTE_PRODUCT_DAYS || '').split(',')) {
    const m = part.trim().match(/^(\d+)\s*[=:]\s*(\d+)$/);
    if (m) map[m[1]] = Number(m[2]);
  }
  for (const k of ['product_id', 'subscription_id']) {
    const id = payload[k];
    if (id !== undefined && id !== null && map[String(id)]) return map[String(id)];
  }
  const byPeriod = { weekly: 7, monthly: 30, quarterly: 90, halfyearly: 180, yearly: 365 };
  if (payload.period && byPeriod[payload.period]) return byPeriod[payload.period];
  return 30;
}
