/* Авторизация приватных досок. user_id из URL/JSON НИКОГДА не является входом. */
import { createHmac, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
const hash = text => createHash('sha256').update(text).digest('hex');
const validId = id => Number.isSafeInteger(Number(id)) && Number(id) > 0;
export const loginCode = () => String(randomInt(100000, 1000000));

export function verifyTelegram(initData, token, now = Date.now()) {
  try {
    if (!token || !initData || initData.length > 16000) return null;
    const fields = new URLSearchParams(initData);
    if (new Set(fields.keys()).size !== [...fields.keys()].length) return null;
    const given = fields.get('hash') || '';
    if (!/^[a-f\d]{64}$/i.test(given)) return null;
    const date = Number(fields.get('auth_date')) * 1000;
    if (!date || date > now + 60000 || now - date > 86400000) return null;
    fields.delete('hash');
    const check = [...fields.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    const expected = createHmac('sha256', secret).update(check).digest();
    if (!timingSafeEqual(expected, Buffer.from(given, 'hex'))) return null;
    const user = JSON.parse(fields.get('user') || '{}');
    return validId(user.id) ? Number(user.id) : null;
  } catch { return null; }
}

export function createWebAuth({ token, db, save }) {
  db.web_sessions ||= {};
  const prune = () => {
    for (const [key, rec] of Object.entries(db.web_sessions)) if (rec.expires <= Date.now()) delete db.web_sessions[key];
  };
  return {
    issue(userId) {
      if (!validId(userId)) throw new Error('Invalid user');
      prune();
      const session = randomBytes(32).toString('base64url'), expires = Date.now() + 30 * 86400000;
      // В базе только хеш; готовый bearer не попадает в логи/health.
      db.web_sessions[hash(session)] = { userId: Number(userId), expires };
      // Не держим сотни сессий на одном аккаунте.
      const keys = Object.keys(db.web_sessions).filter(k => db.web_sessions[k].userId === Number(userId));
      for (const key of keys.slice(0, -20)) delete db.web_sessions[key];
      save(); return { session, expires };
    },
    authenticate(req) {
      const authorization = String(req.headers.authorization || '');
      if (authorization.startsWith('tma ')) return verifyTelegram(authorization.slice(4), token);
      if (!/^Bearer [\w-]{43}$/.test(authorization)) return null;
      const rec = db.web_sessions[hash(authorization.slice(7))];
      return rec && rec.expires > Date.now() && validId(rec.userId) ? rec.userId : null;
    }
  };
}

export async function readBody(req, limit = 1024 * 1024) {
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) { const e = new Error('Request too large'); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function readJson(req, limit) {
  try { return JSON.parse((await readBody(req, limit)).toString() || '{}'); }
  catch (e) { e.status ||= 400; throw e; }
}
