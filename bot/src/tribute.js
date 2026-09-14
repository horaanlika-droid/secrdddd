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

/** Создать ссылку на оплату подписки на выбранный тариф.
    plan: { id: 'm1'|'m3'|'m6', label, price, days } (см. PLANS в bot/src/app.js).
    Возвращает { url } или null. */
export async function createSubscriptionLink(userId, plan = { id: 'm1', label: '1 месяц', price: 200, days: 30 }) {
  if (!tributeConfigured()) return null;
  const amountRub = plan.price || 200;
  const periodDays = plan.days || 30;
  try {
    const r = await fetch(`${BASE}/v1/payments/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY()}` },
      body: JSON.stringify({
        amount: amountRub * 100, currency: 'RUB',
        description: `Дибитишка · подписка ${plan.label || 'на месяц'}`,
        payload: JSON.stringify({ user_id: userId, plan: plan.id || 'm1', days: periodDays }),
        type: 'subscription', period_days: periodDays, trial_days: 0
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
