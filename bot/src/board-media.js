/* Приватные файлы досок: постоянный диск или закрытый S3-совместимый бакет.
   Никаких публичных ссылок/ключей в вебе: скачивание только через авторизованный API. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export async function atomicWrite(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try { await fs.writeFile(temp, data, { mode: 0o600 }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}
export function createBoardMedia(root, env = process.env) {
  const s3Configured = !!(env.BOARDS_S3_ENDPOINT || env.BOARDS_S3_BUCKET || env.BOARDS_S3_ACCESS_KEY || env.BOARDS_S3_SECRET_KEY);
  const s3Ready = !!(env.BOARDS_S3_ENDPOINT && env.BOARDS_S3_BUCKET && env.BOARDS_S3_ACCESS_KEY && env.BOARDS_S3_SECRET_KEY);
  const region = env.BOARDS_S3_REGION || 'auto';
  async function s3(method, key, body = Buffer.alloc(0), type) {
    if (!s3Ready) throw new Error('Object storage is not configured');
    const url = new URL(env.BOARDS_S3_ENDPOINT);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search) throw new Error('Invalid object storage endpoint');
    url.pathname = url.pathname.replace(/\/$/, '') + '/' + encode(env.BOARDS_S3_BUCKET) + '/' + key.split('/').map(encode).join('/');
    const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''), date = now.slice(0, 8), digest = sha(body);
    const headers = { 'x-amz-date': now, 'x-amz-content-sha256': digest };
    const signed = 'host;x-amz-content-sha256;x-amz-date';
    const canonical = [method, url.pathname, '', `host:${url.host}\nx-amz-content-sha256:${digest}\nx-amz-date:${now}\n`, signed, digest].join('\n');
    const scope = `${date}/${region}/s3/aws4_request`;
    const key1 = hmac('AWS4' + env.BOARDS_S3_SECRET_KEY, date);
    const signing = hmac(hmac(hmac(key1, region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signing).update(`AWS4-HMAC-SHA256\n${now}\n${scope}\n${sha(canonical)}`).digest('hex');
    headers.Authorization = `AWS4-HMAC-SHA256 Credential=${env.BOARDS_S3_ACCESS_KEY}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
    if (type) headers['Content-Type'] = type;
    const response = await fetch(url, { method, headers, ...(method === 'PUT' ? { body } : {}), signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (method === 'GET' && response.status === 404) return null;
    if (!response.ok) throw new Error('Object storage unavailable'); // Не логируем подписанный URL/ответ провайдера.
    return method === 'GET' ? Buffer.from(await response.arrayBuffer()) : null;
  }
  const file = (uid, key) => path.join(root, String(uid), 'media', key);
  return {
    type: s3Configured ? 's3' : 'disk',
    ready: !s3Configured || s3Ready,
    put: (uid, key, bytes, type) => s3Configured ? s3('PUT', `${uid}/${key}`, bytes, type) : atomicWrite(file(uid, key), bytes),
    async get(uid, key) {
      if (s3Configured) return s3('GET', `${uid}/${key}`);
      try { return await fs.readFile(file(uid, key)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    del: (uid, key) => s3Configured ? s3('DELETE', `${uid}/${key}`) : fs.rm(file(uid, key), { force: true })
  };
}
