/* Tenor-поиск через бот: ключ остаётся только в окружении сервера. */
export function createGifApi({ json, env = process.env, fetcher = fetch }) {
  const key = env.TENOR_API_KEY || '', cache = new Map(), rate = new Map();
  const safeUrl = raw => { try { const u = new URL(raw); return u.protocol === 'https:' && (u.hostname === 'tenor.com' || u.hostname.endsWith('.tenor.com')) ? u.href : ''; } catch { return ''; } };
  return async (req, res, url) => {
    if (req.method !== 'GET' || url.pathname !== '/gif') return false;
    const q = (url.searchParams.get('q') || '').trim().slice(0, 120);
    if (!key || !q) { json(res, 200, { ok: true, enabled: !!key, items: [] }); return true; }
    const now = Date.now(), ip = req.socket.remoteAddress || '?';
    for (const [k, entry] of rate) if (now - entry.time >= 60000) rate.delete(k);
    const entry = rate.get(ip) || { time: now, count: 0 }; entry.count++; rate.set(ip, entry);
    if (entry.count > 30) { json(res, 429, { ok: false, error: 'rate_limit' }); return true; }
    if (cache.has(q) && now - cache.get(q).time < 600000) { json(res, 200, cache.get(q).body); return true; }
    try {
      const params = new URLSearchParams({ key, q, client_key: 'dibitishka', limit: '12', contentfilter: 'high', media_filter: 'gif,tinygif', locale: 'ru_RU' });
      const result = await fetcher('https://tenor.googleapis.com/v2/search?' + params, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (!result.ok) throw new Error('provider_unavailable');
      const data = await result.json();
      const items = (Array.isArray(data.results) ? data.results : []).slice(0, 12).map(item => ({
        id: String(item.id), title: String(item.content_description || 'GIF').slice(0, 140),
        url: safeUrl(item.media_formats?.gif?.url), preview: safeUrl(item.media_formats?.tinygif?.url)
      })).filter(item => item.url && item.preview);
      const body = { ok: true, enabled: true, items };
      cache.set(q, { time: now, body });
      while (cache.size > 100) cache.delete(cache.keys().next().value);
      json(res, 200, body);
    } catch { json(res, 503, { ok: false, error: 'gif_unavailable' }); }
    return true;
  };
}
