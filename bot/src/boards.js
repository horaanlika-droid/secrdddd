/* Приватные доски: CAS-ревизии, валидация, квоты и атомарная запись.
   Метаданные — на постоянном диске рядом с базой, фото — диск или закрытый S3.
   Не используем открытый user_id API для чувствительных записей. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWrite, createBoardMedia } from './board-media.js';
import { readBody, readJson } from './web-auth.js';
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const MAX_FILE = 6 * 1024 * 1024, MAX_TOTAL = 100 * 1024 * 1024;
const BGS = new Set(['sky','peony','grass','sand','lavender','paper','dots','grid','stars','photo']);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const str = (value, max, required = false) => {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail('invalid_text');
  return value;
};
const id = value => { if (typeof value !== 'string' || (!ID.test(value) || ['constructor', 'prototype', '__proto__'].includes(value))) throw fail('invalid_id'); return value; };
const timestamp = value => Number.isFinite(value) && value >= 0 ? value : 0;
const mediaKey = value => {
  if (typeof value !== 'string') throw fail('invalid_media');
  if (/^https?:\/\//.test(value)) {
    const url = new URL(value);
    if (value.length > 2048 || url.username || url.password) throw fail('invalid_media');
    return value;
  }
  return id(value);
};

export function validateBoards(value) {
  if (!Array.isArray(value) || value.length > 60) throw fail('boards_limit');
  const boardIds = new Set(); let count = 0;
  return value.map(b => {
    if (!b || typeof b !== 'object') throw fail('invalid_board');
    const bid = id(b.id);
    if (boardIds.has(bid)) throw fail('duplicate_board'); boardIds.add(bid);
    if (!Array.isArray(b.tiles) || b.tiles.length > 400 || (count += b.tiles.length) > 2000) throw fail('tiles_limit');
    const tileIds = new Set();
    const tiles = b.tiles.map(t => {
      if (!t || typeof t !== 'object') throw fail('invalid_tile');
      const tid = id(t.id);
      if (tileIds.has(tid)) throw fail('duplicate_tile'); tileIds.add(tid);
      if (!['note','photo','gif'].includes(t.kind)) throw fail('invalid_kind');
      if (!Array.isArray(t.tags) || t.tags.length > 8) throw fail('invalid_tags');
      const tile = {
        id: tid, kind: t.kind, tags: t.tags.map(tag => str(tag, 40, true)),
        rot: Math.max(-8, Math.min(8, Number(t.rot) || 0)), size: ['s','m','l'].includes(t.size) ? t.size : 'm', created: timestamp(t.created)
      };
      if (t.kind === 'note') tile.text = str(t.text, 4000);
      else { tile.src = mediaKey(t.src); tile.caption = str(t.caption, 200); }
      return tile;
    });
    const board = { id: bid, title: str(b.title, 80, true), bg: BGS.has(b.bg) ? b.bg : 'sky', tiles, created: timestamp(b.created) };
    if (board.bg === 'photo') board.bgKey = id(b.bgKey);
    return board;
  });
}
function references(boards) {
  const keys = new Set();
  for (const b of boards) {
    if (b.bg === 'photo' && b.bgKey) keys.add(b.bgKey);
    for (const t of b.tiles) if (t.src && !/^https?:/.test(t.src)) keys.add(t.src);
  }
  return keys;
}
function imageType(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  return null; // Не храним SVG/HTML под видом картинки.
}

export function createBoardStore(root, env = process.env) {
  const storage = createBoardMedia(root, env), locks = new Map();
  const file = uid => path.join(root, String(uid), 'boards.json');
  async function read(uid) {
    if (!Number.isSafeInteger(uid) || uid <= 0) throw fail('unauthorized', 401);
    try { return JSON.parse(await fs.readFile(file(uid), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return { revision: 0, boards: [], media: {} }; throw e; }
  }
  const write = (uid, data) => atomicWrite(file(uid), JSON.stringify(data));
  async function lock(uid, action) {
    const before = locks.get(uid) || Promise.resolve();
    const pending = before.catch(() => {}).then(action); locks.set(uid, pending);
    try { return await pending; } finally { if (locks.get(uid) === pending) locks.delete(uid); }
  }
  // Невостребованные загрузки не съедают квоту навсегда. Недельный запас нужен
  // другому офлайн-устройству и повтору после оборванного POST метаданных.
  async function prune(uid, data) {
    const used = references(data.boards), cutoff = Date.now() - 7 * 86400000;
    for (const [key, rec] of Object.entries(data.media)) {
      if (!used.has(key) && (rec.orphanedAt || rec.created) < cutoff) {
        try { await storage.del(uid, key); delete data.media[key]; } catch { /* Повторим в следующей синхронизации. */ }
      }
    }
  }
  return {
    enabled: env.BOARDS_ENABLED !== '0' && storage.ready,
    storage: storage.type,
    async get(uid) {
      const data = await read(uid);
      return { revision: data.revision, boards: data.boards, media: Object.keys(data.media) };
    },
    put(uid, revision, boards) {
      const clean = validateBoards(boards);
      if (!Number.isSafeInteger(revision) || revision < 0) throw fail('invalid_revision');
      return lock(uid, async () => {
        const data = await read(uid);
        if (data.revision !== revision) throw Object.assign(fail('conflict', 409), { current: { revision: data.revision, boards: data.boards, media: Object.keys(data.media) } });
        const refs = references(clean);
        for (const key of refs) if (!data.media[key]) throw fail('missing_media');
        data.boards = clean; data.revision++;
        for (const [key, rec] of Object.entries(data.media)) {
          if (refs.has(key)) delete rec.orphanedAt;
          else rec.orphanedAt ||= Date.now();
        }
        await prune(uid, data); await write(uid, data);
        return { revision: data.revision, boards: clean, media: Object.keys(data.media) };
      });
    },
    upload(uid, key, bytes) {
      id(key);
      if (bytes.length > MAX_FILE) throw fail('file_too_large', 413);
      const type = imageType(bytes);
      if (!type) throw fail('unsupported_image', 415);
      const digest = hash(bytes);
      return lock(uid, async () => {
        const data = await read(uid), existing = data.media[key];
        if (existing) {
          if (existing.hash !== digest) throw fail('media_conflict', 409);
          return { key, type: existing.type }; // Идемпотентный повтор загрузки.
        }
        await prune(uid, data);
        const size = Object.values(data.media).reduce((sum, rec) => sum + rec.size, 0);
        if (size + bytes.length > MAX_TOTAL) throw fail('storage_full', 413);
        await storage.put(uid, key, bytes, type);
        data.media[key] = { hash: digest, size: bytes.length, type, created: Date.now() };
        await write(uid, data);
        return { key, type };
      });
    },
    async download(uid, key) {
      id(key);
      const data = await read(uid), rec = data.media[key];
      if (!rec) throw fail('not_found', 404);
      const bytes = await storage.get(uid, key);
      if (!bytes || bytes.length > MAX_FILE) throw fail('not_found', 404);
      return { bytes, type: rec.type };
    }
  };
}

export function createBoardApi({ root, auth, json, env = process.env }) {
  const store = createBoardStore(root, env), counts = new Map();
  return async (req, res, url) => {
    if (url.pathname !== '/board' && !url.pathname.startsWith('/board/')) return false;
    try {
      if (url.pathname === '/board/status' && req.method === 'GET') { json(res, 200, { ok: true, enabled: store.enabled }); return true; }
      if (!store.enabled) throw fail('boards_unavailable', 503);
      const uid = auth.authenticate(req);
      if (!uid) throw fail('unauthorized', 401);
      const minute = Math.floor(Date.now() / 60000), key = `${uid}:${minute}`;
      const count = (counts.get(key) || 0) + 1; counts.set(key, count);
      for (const k of counts.keys()) if (!k.endsWith(':' + minute)) counts.delete(k);
      if (count > 300) throw fail('rate_limit', 429);
      const match = url.pathname.match(/^\/board\/media\/([\w-]{1,100})$/);
      if (match && req.method === 'GET') {
        const media = await store.download(uid, match[1]);
        res.writeHead(200, { 'Content-Type': media.type, 'Content-Length': media.bytes.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' });
        res.end(media.bytes);
      } else if (match && req.method === 'POST') {
        json(res, 200, { ok: true, ...await store.upload(uid, match[1], await readBody(req, MAX_FILE)) });
      } else if (url.pathname === '/board' && req.method === 'GET') {
        json(res, 200, { ok: true, ...await store.get(uid) });
      } else if (url.pathname === '/board' && req.method === 'POST') {
        const body = await readJson(req, 2 * 1024 * 1024);
        json(res, 200, { ok: true, ...await store.put(uid, body.base_revision, body.boards) });
      } else json(res, 404, { ok: false, error: 'not_found' });
    } catch (e) {
      const status = e.status || 503;
      if (!res.headersSent) json(res, status, { ok: false, error: e.status ? e.message : 'boards_unavailable', ...(e.current ? { current: e.current } : {}) });
    }
    return true;
  };
}
