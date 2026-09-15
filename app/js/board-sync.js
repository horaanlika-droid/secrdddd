/* Offline-first sync: данные остаются локально до подтверждённого ответа.
   3-way merge + CAS не позволяют двум телефонам затереть изменения друг друга. */
const copy = value => JSON.parse(JSON.stringify(value));
const stable = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const same = (a, b) => stable(a) === stable(b);
const shortHash = value => { let h = 2166136261; for (const ch of stable(value) || '') h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };
const duplicateId = entity => entity.id.slice(0, 80) + '-copy-' + shortHash(entity);
export function normalizeBoards(boards) {
  return (boards || []).map(b => ({
    id: b.id, title: b.title, bg: b.bg || 'sky', ...(b.bg === 'photo' && b.bgKey ? { bgKey: b.bgKey } : {}), created: b.created || 0,
    tiles: (b.tiles || []).map(t => ({
      id: t.id, kind: t.kind, tags: t.tags || [], rot: Number(t.rot) || 0, size: t.size || 'm', created: t.created || 0,
      ...(t.kind === 'note' ? { text: t.text || '' } : { src: t.src, caption: t.caption || '' })
    }))
  }));
}

export function mergeBoardSnapshots(base, local, remote) {
  let conflicts = 0;
  const mergeList = (bs, ls, rs, isBoard) => {
    const bm = new Map(bs.map(x => [x.id, x])), lm = new Map(ls.map(x => [x.id, x])), rm = new Map(rs.map(x => [x.id, x]));
    const ids = new Set([...lm.keys(), ...rm.keys(), ...bm.keys()]), result = [];
    for (const id of ids) {
      const b = bm.get(id), l = lm.get(id), r = rm.get(id);
      if (!l && !r) continue;
      if (!l || !r) {
        const alive = l || r;
        if (!b || !same(alive, b)) { result.push(copy(alive)); if (b) conflicts++; }
        continue; // Одна сторона удалила, другая не меняла — удаление сохраняем.
      }
      if (same(l, r) || same(r, b)) { result.push(copy(l)); continue; }
      if (same(l, b)) { result.push(copy(r)); continue; }
      const merged = { id }, fields = new Set([...Object.keys(l), ...Object.keys(r)]);
      let collision = false;
      for (const key of fields) {
        if (key === 'id') continue;
        if (isBoard && key === 'tiles') { merged.tiles = mergeList(b?.tiles || [], l.tiles, r.tiles, false); continue; }
        if (same(l[key], r[key]) || same(r[key], b?.[key])) merged[key] = l[key];
        else if (same(l[key], b?.[key])) merged[key] = r[key];
        else { merged[key] = l[key]; collision = true; }
      }
      result.push(merged);
      if (collision) {
        // Обе версии текста/фона важны. Не выбираем победителя по часам телефона.
        const duplicate = { ...copy(r), id: duplicateId(r) };
        if (isBoard) duplicate.title = (r.title.slice(0, 57) + ' · другая версия').slice(0, 80);
        if (!ids.has(duplicate.id) && !result.some(x => x.id === duplicate.id)) result.push(duplicate);
        conflicts++;
      }
    }
    return result;
  };
  return { boards: mergeList(normalizeBoards(base), normalizeBoards(local), normalizeBoards(remote), true), conflicts };
}
export const boardMediaKeys = boards => [...new Set((boards || []).flatMap(b => [b.bg === 'photo' ? b.bgKey : '', ...(b.tiles || []).map(t => t.src)]).filter(src => src && !/^(https?:|data:|blob:)/i.test(src)))];

const ERRORS = {
  unauthorized: 'Войди по коду ещё раз или заново открой приложение в Telegram. Локальные доски сохранены.',
  storage_full: 'Хранилище досок заполнено. Локальные изменения не потеряны.',
  file_too_large: 'Одно из фото слишком большое для синхронизации.',
  missing_media: 'Не удалось найти одно из фото. Добавь его заново — остальное осталось на устройстве.',
  media_conflict: 'Имя одного из фото уже занято. Добавь его заново — доска осталась на устройстве.',
  boards_unavailable: 'Синхронизация пока недоступна на боте. Всё остаётся на этом устройстве.',
  rate_limit: 'Немного подождём перед следующей синхронизацией.',
  boards_limit: 'Для синхронизации доступно до 60 досок. Локальные доски не удалены.',
  tiles_limit: 'Для синхронизации доступно до 400 плиток на доску и 2000 на аккаунт. Локальные данные не удалены.',
  conflict: 'Доску меняют на другом устройстве. Попробуй синхронизировать ещё раз.'
};

export class BoardSync {
  constructor({ storage, key, getBoards, setBoards, getMedia, putMedia, authHeaders, apiUrl, onStatus = () => {}, canApply = () => true, fetcher = fetch }) {
    Object.assign(this, { storage, key, getBoards, setBoards, getMedia, putMedia, authHeaders, apiUrl, onStatus, canApply, fetcher });
    let saved; try { saved = JSON.parse(storage.getItem(key)); } catch { /* Новый аккаунт. */ }
    this.state = { enabled: false, pending: false, revision: 0, base: [], lastSynced: 0, ...saved };
    this.disposed = false; this.controller = new AbortController(); this.running = null; this.timer = null;
    this.status = { phase: this.state.enabled ? 'waiting' : 'local', lastSynced: this.state.lastSynced };
  }
  persist() { this.storage.setItem(this.key, JSON.stringify(this.state)); }
  report(phase, extra = {}) { if (this.disposed) return; this.status = { phase, lastSynced: this.state.lastSynced, ...extra }; this.onStatus(this.status); }
  enable() { this.state.enabled = true; this.state.pending = true; this.persist(); this.report('waiting'); return this.sync(); }
  disable() { this.state.enabled = false; this.persist(); this.dispose(); this.report('local'); }
  changed() {
    if (!this.state.enabled || this.disposed) return;
    this.state.pending = true;
    try { this.persist(); } catch { this.report('error', { error: 'Не удалось сохранить очередь. Сама доска остаётся на устройстве.' }); }
    clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), 900);
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.controller.abort(); }
  async request(path, options = {}) {
    const headers = this.authHeaders();
    if (!headers.Authorization) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
    const controller = new AbortController(), abort = () => controller.abort();
    if (this.disposed) throw new Error('disposed');
    this.controller.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 20000);
    try {
      const r = await this.fetcher(this.apiUrl(path), { ...options, headers: { ...headers, ...options.headers }, signal: controller.signal, cache: 'no-store' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw Object.assign(new Error(body.error || 'network'), { code: body.error || (r.status === 401 ? 'unauthorized' : 'network'), status: r.status });
      }
      return r;
    } finally { clearTimeout(timer); this.controller.signal.removeEventListener('abort', abort); }
  }
  async downloadMedia(key) {
    if (!this.state.enabled || this.disposed) return null;
    const r = await this.request('/board/media/' + encodeURIComponent(key));
    const blob = await r.blob();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(blob.type) || blob.size > 6 * 1024 * 1024) return null;
    if (!this.disposed) await this.putMedia(key, blob);
    return blob;
  }
  sync() {
    if (this.disposed || !this.state.enabled) return Promise.resolve();
    if (this.running) return this.running;
    if (!this.canApply()) { this.report('waiting'); return Promise.resolve(); }
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }
  async run() {
    this.report('syncing');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const local = normalizeBoards(copy(this.getBoards()));
        const remote = await (await this.request('/board')).json();
        if (!Array.isArray(remote.boards) || !Number.isSafeInteger(remote.revision)) throw new Error('invalid_response');
        const merged = mergeBoardSnapshots(this.state.base, local, remote.boards);
        const available = new Set(remote.media || []);
        for (const key of boardMediaKeys(merged.boards)) {
          if (available.has(key)) continue;
          const blob = await this.getMedia(key);
          if (!blob) throw Object.assign(new Error('missing_media'), { code: 'missing_media' });
          await this.request('/board/media/' + encodeURIComponent(key), { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
        }
        if (this.disposed || !this.canApply()) { this.state.pending = true; this.persist(); this.report('waiting'); return; }
        let confirmed = remote;
        if (!same(merged.boards, normalizeBoards(remote.boards))) {
          try {
            confirmed = await (await this.request('/board', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_revision: remote.revision, boards: merged.boards }) })).json();
          } catch (e) { if (e.code === 'conflict' && attempt < 2) continue; throw e; }
        }
        if (this.disposed) return;
        if (!this.canApply()) { this.state.pending = true; this.persist(); this.report('waiting'); return; }
        // Пока грузились фото, человек мог изменить доску. Эти новые изменения
        // не считаем «отправленными» и накладываем на подтверждённый снимок.
        const latest = mergeBoardSnapshots(local, this.getBoards(), confirmed.boards);
        this.setBoards(latest.boards);
        this.state.base = normalizeBoards(confirmed.boards); this.state.revision = confirmed.revision;
        this.state.pending = !same(normalizeBoards(latest.boards), this.state.base);
        this.state.lastSynced = Date.now(); this.persist();
        this.report(this.state.pending ? 'waiting' : 'synced', { conflicts: merged.conflicts + latest.conflicts });
        if (this.state.pending) { clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), 900); }
        return;
      }
    } catch (e) {
      if (this.disposed) return;
      this.state.pending = true;
      try { this.persist(); } catch { /* Сама доска сохраняется независимо от очереди. */ }
      this.report('error', { error: (e.name === 'QuotaExceededError' ? 'Не хватило памяти на устройстве. Освободи немного места и повтори синхронизацию. Данные на боте не удалены.' : ERRORS[e.code]) || 'Нет связи с ботом. Изменения сохранены здесь и отправятся при восстановлении связи.' });
    }
  }
}
