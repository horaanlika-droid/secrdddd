/* Tribute API для бизнеса — тонкий клиент-заглушка.
   Ключ вписывается ПОСЛЕ запуска приложения в переменную окружения
   TRIBUTE_API на бот-хосте. Пока ключа нет — бот честно говорит,
   что платежи подключаются.

   Важно: точные эндпоинты Tribute могут отличаться от приведённых
   ниже (см. актуальную документацию Tribute для бизнеса). Все пути
   вынесены в константы — поправь при подключении, логика не изменится.
*/
const BASE = process.env.TRIBUTE_BASE || 'https://api.tribute.dev';
const KEY = () => process.env.TRIBUTE_API || '';

export const tributeConfigured = () => !!KEY();

/** Создать ссылку на оплату подписки. Возвращает { url } или null. */
export async function createSubscriptionLink(userId, amountRub = 200, period = 'month') {
  if (!tributeConfigured()) return null;
  try {
    const r = await fetch(`${BASE}/v1/payments/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY()}` },
      body: JSON.stringify({
        amount: amountRub * 100, currency: 'RUB',
        description: 'Дибитишка · подписка на месяц',
        payload: JSON.stringify({ user_id: userId, period }),
        type: 'subscription', period_days: 30, trial_days: 0
      })
    });
    if (!r.ok) { console.error('[tribute] link error', r.status, await r.text()); return null; }
    const j = await r.json();
    return { url: j.url || j.link || null, id: j.id || j.uuid || null };
  } catch (e) { console.error('[tribute] link exception', e.message); return null; }
}

/** Разовая оплата (мерч, печатная тетрадь). */
export async function createOneTimeLink(userId, amountRub, description) {
  if (!tributeConfigured()) return null;
  try {
    const r = await fetch(`${BASE}/v1/payments/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY()}` },
      body: JSON.stringify({ amount: amountRub * 100, currency: 'RUB', description, payload: JSON.stringify({ user_id: userId }) })
    });
    if (!r.ok) return null;
    const j = await r.json();
    return { url: j.url || j.link || null, id: j.id || j.uuid || null };
  } catch (e) { return null; }
}
