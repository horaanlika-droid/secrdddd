/* Простое JSON-хранилище бота (файл db.json рядом с ботом). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.DB_FILE || path.join(__dirname, '..', 'db.json');

const seed = () => ({
  users: {},        // id -> { id, name, username, joined, trial_start, premium_until, reminder:{on,time,tz}, chat:[...] (память чата в TG), web_chat:[...] (память чата в вебе) }
  codes: {},        // code -> { user_id, exp }
  content: null,    // рабочая копия контента (редактируется админами)
  broadcast: null,  // черновик рассылки админа
  stats: { sent: 0 }
});

let db = seed();
try {
  if (fs.existsSync(FILE)) db = Object.assign(seed(), JSON.parse(fs.readFileSync(FILE, 'utf8')));
} catch (e) { console.error('[db] read error, starting fresh:', e.message); }

let t;
const writeNow = () => {
  clearTimeout(t);
  t = null;
  try { fs.writeFileSync(FILE, JSON.stringify(db)); return true; }
  catch (e) { console.error('[db] write error:', e.message); return false; }
};
export const save = () => {
  clearTimeout(t);
  t = setTimeout(() => {
    try { fs.writeFileSync(FILE, JSON.stringify(db)); } catch (e) { console.error('[db] write error:', e.message); }
  }, 250);
};
/** Немедленная запись: зовётся при SIGTERM, чтобы деплой не потерял данные
    (обычный save() отложен на 250 мс и при быстром останове не успевает). */
export const flush = () => (t ? writeNow() : true);
export const getDB = () => db;
export const resetDB = (v) => { db = v; save(); };
