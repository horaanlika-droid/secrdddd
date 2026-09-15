/* ============================================================
   Дибитишка · «живой» чат через Agents API (сессия + self-hosted окружение)
   ------------------------------------------------------------
   Это НЕ замена bot/src/ai.js, а второй бэкенд поверх него:
     · ai.js      — chat/completions: быстро, дёшево, без внешних систем.
     · agents.js  — Agents API: у диалога есть сессия и изолированное
                    окружение (воркспейс), где агент может читать файлы,
                    запускать код и работать инструментами. Память —
                    не наш массив реплик, а сам тред на стороне API.

   Что нужно на бот-хосте (всё опционально, по умолчанию режим выключен):

     AGENTS_ENABLED=1                 — включать этот бэкенд (иначе не работает)
     OPENAI_API_KEY                   — ключ приложения: скоупы api.agents.read,
                                        api.agents.write, api.responses.write
     AGENTS_MODEL                     — модель сессии (по умолчанию gpt-4o-mini)
     AGENTS_BASE_URL                  — по умолчанию https://api.openai.com/v1
     AGENTS_WORKSPACE                 — папка окружения (по умолчанию /workspace)
     OPENAI_EXECUTOR_API_KEY          — отдельный «ключ окружения» из
                                        platform.openai.com/agents → Environments →
                                        Keys (все права, кроме подключения, — None).
                                        Он передаётся исполнителю как CODEX_API_KEY
                                        и НИКОГДА не попадает в ответы/логи.
     CODEX_API_KEY                    — то же самое, если ключ называется так
     AGENTS_EXECUTOR_CMD              — как запускать исполнителя окружения.
                                        Плейсхолдеры: {remote_url} {environment_id}.
                                        Не задано → бот НЕ запускает codex сам, а
                                        пишет готовую команду (её видно в /diag).
                                        Примеры:
                                          codex exec-server --remote "{remote_url}" --environment-id "{environment_id}"
                                          docker run --rm -i agent-api-sandbox:latest codex exec-server --remote "{remote_url}" --environment-id "{environment_id}"
     AGENTS_TURN_TIMEOUT_MS           — сколько ждать завершения хода (90000)
     AGENTS_CONNECT_TIMEOUT_MS        — сколько ждать подключения окружения (45000)
     AGENTS_SESSION_TTL_S             — через сколько бездействия закрыть сессию (3600)
     AGENTS_MAX_CHARS                 — потолок длины ответа для чата (1800)

   Порядок жизни (как в гайде OpenAI «Self-hosted sandboxes»):
     1. POST /v1/agents/sessions      → { id, environment: { id, remote_url } }
     2. внутри окружения: codex exec-server --remote <remote_url>
        --environment-id <environment_id> (CODEX_API_KEY = ключ окружения)
     3. GET  /v1/agents/sessions/{id}/events?stream=true  — сначала подписка
     4. POST /v1/agents/sessions/{id}/events — agent.session.input.message
     5. агент пишет, пока ход не закончится (agent.session.turn.completed);
        окружение обязано подключиться, иначе ход не стартует.
   У каждой сессии своё окружение и свой исполнитель: их нельзя переиспользовать
   между диалогами, поэтому id окружения и remote_url хранятся рядом с сессией.

   Безопасность: агент в окружении выполняет произвольный код от модели.
   Держи исполнителя в контейнере без доступа к хосту и без чужих файлов,
   и не давай этому окружению доступ к базе/ключам приложения. Для чата
   поддержки про «мне тяжело» это часто оверкилл — включай, когда реально
   нужны файлы, репозитории и запуск кода.
   ============================================================ */
import { spawn } from 'node:child_process';
import { PERSONA, APP_FACTS } from './persona.js';
import { describeUser } from './ai.js';

const env = (k, d = '') => String(process.env[k] ?? '').trim() || d;
const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };

const BASE = () => env('AGENTS_BASE_URL', 'https://api.openai.com/v1').replace(/\/+$/, '');
const API = () => env('OPENAI_API_KEY', '');
const HEADERS = (extra = {}) => ({
  'Content-Type': 'application/json',
  // Agents API пока в бете: без этого заголовка /v1/agents/* отвечает 404/400
  'OpenAI-Beta': 'agents=v1',
  Authorization: `Bearer ${API()}`,
  ...extra
});

/** Режим включён только по явному флагу и при наличии ключа. */
export const agentsEnabled = () => env('AGENTS_ENABLED') === '1' && !!API();
export const agentsModel = () => env('AGENTS_MODEL', 'gpt-4o-mini');

/* ---------- маскирование секретов ----------
   remote_url содержит одноразовый connect-токен, CODEX_API_KEY — ключ окружения.
   И то, и другое не должно никуда уезжать целиком: ни в логи, ни в /health,
   ни в ответ чата. */
export function maskSecret(s) {
  const str = String(s || '');
  if (!str) return '';
  return str
    .replace(/(connect\/)([A-Za-z0-9_]{4,})/g, (_, p, t) => p + t.slice(0, 3) + '***')
    .replace(/(rt_)[A-Za-z0-9]{2,}/g, 'rt_***')
    .replace(/(ccarenv_b64_)[A-Za-z0-9_]{4,}/g, 'ccarenv_b64_***');
}
const maskKey = (k) => (k ? `${String(k).slice(0, 3)}…${String(k).slice(-3)}` : 'не задан');

/* ---------- чем живёт сессия ---------- */
/** ключ диалога → { session_id, environment_id, remote_url, executor, … } */
const sessions = new Map();
const health = {
  enabled: false, model: null, base: null, workspace: null,
  sessions: 0, executor_cmd: false, executor_key: false,
  last_error: null, last_error_detail: null, last_error_at: null,
  last_event: null, last_session_id: null, turns: 0, fallbacks: 0,
  created: 0, closed: 0
};
function fail(err, detail) {
  health.last_error = err;
  health.last_error_detail = detail ? String(detail).slice(0, 240) : null;
  health.last_error_at = Date.now();
  console.error(`[agents] ${err}${detail ? ': ' + String(detail).slice(0, 200) : ''}`);
}
export function agentsDiagnostics() {
  health.executor_cmd = !!env('AGENTS_EXECUTOR_CMD');
  health.executor_key = !!(env('OPENAI_EXECUTOR_API_KEY') || env('CODEX_API_KEY'));
  const list = [...sessions.values()].map((s) => ({
    key: s.key, session_id: s.session_id, environment_id: s.environment_id,
    environment_state: s.env_state || 'unknown',
    executor: s.executor ? (s.executor.killed ? 'остановлен' : 'работает (pid ' + s.executor.pid + ')') : 'не запущен',
    idle_s: s.last_used ? Math.round((Date.now() - s.last_used) / 1000) : null,
    turns: s.turns || 0
  }));
  return {
    ...health,
    enabled: agentsEnabled(),
    model: agentsModel(),
    base: BASE(),
    workspace: env('AGENTS_WORKSPACE', '/workspace'),
    sessions: sessions.size,
    live: list
  };
}

/* ---------- HTTP ---------- */
async function call(method, urlPath, body, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 30000);
  try {
    const r = await fetch(BASE() + urlPath, {
      method,
      headers: HEADERS(opts.headers),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal
    });
    const text = await r.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* прокси подмешал HTML */ }
    if (!r.ok) {
      const e = (json && (json.error || json)) || {};
      const detail = String(e.message || e.error || text || '').replace(/\s+/g, ' ').slice(0, 240);
      const err = r.status === 401 || r.status === 403 ? 'auth'
        : r.status === 404 ? 'not_found'
        : r.status === 409 ? 'conflict'
        : r.status >= 500 ? 'agents_down' : 'http_' + r.status;
      const out = new Error(`${err}: ${detail}`);
      out.code = err; out.status = r.status; out.detail = detail;
      throw out;
    }
    return json;
  } catch (e) {
    if (e?.name === 'AbortError') { const out = new Error('timeout'); out.code = 'timeout'; throw out; }
    if (!e.code) e.code = 'network';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- сессия и её окружение ---------- */
function instructions(userContext = {}, channel = 'telegram') {
  return [
    PERSONA,
    APP_FACTS,
    `# КОНТЕКСТ СЕАНСА\nКанал: ${channel === 'web' ? 'веб-версия приложения (Mini App)' : 'Телеграм-бот'}. Сейчас ${new Date().toISOString().slice(0, 10)}.\nЭто чат поддержки: не запускай code и не лезь в файлы, если человек явно не просит. Отвечай коротко и по-человечески.`,
    describeUser(userContext)
  ].join('\n\n');
}

async function createSession(key, { userContext, channel } = {}) {
  const body = {
    agent: { model: agentsModel(), instructions: instructions(userContext, channel) },
    environment: { type: 'self_hosted', workspace_directory: env('AGENTS_WORKSPACE', '/workspace') }
  };
  const s = await call('POST', '/agents/sessions', body, { timeoutMs: num('AGENTS_CREATE_TIMEOUT_MS', 30000) });
  const id = s?.id || s?.session_id;
  if (!id) throw Object.assign(new Error('в ответе нет id сессии'), { code: 'bad_response' });
  const rec = {
    key,
    session_id: id,
    environment_id: s?.environment?.id || s?.environment_id || null,
    remote_url: s?.environment?.remote_url || s?.remote_url || null,
    created_at: Date.now(),
    last_used: Date.now(),
    turns: 0,
    env_state: 'pending',
    executor: null
  };
  sessions.set(key, rec);
  health.created++;
  health.last_session_id = id;
  console.log(`[agents] сессия ${id} для «${key}» · окружение ${maskSecret(rec.environment_id || '—')}`);
  startExecutor(rec);
  return rec;
}

/** Исполнитель окружения: без него агент не начнёт работу. */
function startExecutor(rec) {
  const tpl = env('AGENTS_EXECUTOR_CMD');
  if (!tpl) {
    const cmd = `OPENAI…ЕНА> codex exec-server --remote "${maskSecret(rec.remote_url)}" --environment-id "${rec.environment_id}"`;
    console.log(`[agents] исполнитель не запущен (AGENTS_EXECUTOR_CMD не задан). Вручную в окружении:\n    ${cmd}`);
    rec.executor_note = 'AGENTS_EXECUTOR_CMD не задан — запуск руками';
    return null;
  }
  if (!rec.remote_url || !rec.environment_id) {
    fail('no_environment', 'в ответе сессии нет environment.remote_url / environment.id — исполнителю не с чем стартовать');
    return null;
  }
  const cmd = tpl
    .replace('{remote_url}', rec.remote_url)
    .replace('{environment_id}', rec.environment_id);
  const key = env('OPENAI_EXECUTOR_API_KEY') || env('CODEX_API_KEY');
  if (!key) fail('no_executor_key', 'OPENAI_EXECUTOR_API_KEY (он же CODEX_API_KEY) не задан — codex exec-server не подключится');
  let child;
  try {
    child = spawn(cmd, {
      shell: true,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      /* В песочницу уходит МИНИМУМ окружения: ключ приложения (OPENAI_API_KEY)
         и ADMIN_IDS/TRIBUTE_API там не нужны совсем — агент в окружении
         выполняет код, который сгенерировала модель. */
      env: executorEnv(key)
    });
  } catch (e) {
    fail('executor_spawn', e?.message || String(e));
    return null;
  }
  rec.executor = { pid: child.pid, child, log: [], killed: false, started_at: Date.now() };
  const push = (buf) => {
    const tail = rec.executor.log;
    for (const line of String(buf).split('\n')) {
      if (!line.trim()) continue;
      tail.push(maskSecret(line));
      while (tail.length > 40) tail.shift();   // лог исполнителя — только хвост и без секретов
    }
  };
  child.stdout?.on('data', push);
  child.stderr?.on('data', push);
  child.on('exit', (code, signal) => {
    if (rec.executor) rec.executor.killed = true;
    console.log(`[agents] исполнитель сессии ${rec.session_id} завершился (code=${code}, signal=${signal || 'нет'})`);
    rec.env_state = 'disconnected';
  });
  child.on('error', (e) => fail('executor_error', e?.message || String(e)));
  console.log(`[agents] исполнитель запущен: pid ${child.pid} для окружения ${maskSecret(rec.environment_id)}`);
  return child;
}

function stopExecutor(rec, signal = 'SIGTERM') {
  const ex = rec?.executor;
  if (!ex?.child || ex.killed) return;
  try { ex.child.kill(signal); } catch { /* уже всё */ }
  ex.killed = true;
}

/** Среда для исполнителя: только PATH/HOME + ключ окружения (+ явно перечисленное). */
function executorEnv(key) {
  const e = { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME || '/tmp' };
  if (key) e.CODEX_API_KEY = key;
  for (const name of env('AGENTS_EXECUTOR_ENV').split(',').map((x) => x.trim()).filter(Boolean)) {
    if (process.env[name] !== undefined) e[name] = process.env[name];
  }
  return e;
}

/** Полный цикл: подписка → input → дельты → конец хода. */
async function streamTurn(rec, text, { onDelta, onEvent } = {}) {
  const timeout = num('AGENTS_TURN_TIMEOUT_MS', 90000);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const parts = new Map();          // item_id:output_index:content_index → текст
  let done = null;
  let err = null;
  let sawInput = false;

  /* Поток от модели может остаться открытым ещё долго после конца хода
     (keep-alive у прокси, молчаливое окружение). Поэтому читаем не «до
     упора», а до первого из: событие-итог, конец потока, таймаут хода.
     Иначе «ответ уже есть, а чат висит» — ровно тот симптом, что
     выглядел как «ии не отвечает». */
  let wake = null;
  const finished = new Promise((res) => { wake = res; });
  const finish = (v) => { if (done) return; done = v; try { wake(); } catch { /* уже */ } try { ctl.abort(); } catch { /* уже отменён */ } };

  let r0 = null;
  try {
    /* 1) подписка на события открывается, но НЕ ждём её до отправки работы:
          если прокси задержит заголовки SSE, чат встанет «на …» навсегда.
          Поток и input идут параллельно, событие-итог всё равно дойдёт. */
    const streamP = fetch(`${BASE()}/agents/sessions/${encodeURIComponent(rec.session_id)}/events?stream=true`, {
      headers: HEADERS({ Accept: 'text/event-stream' }),
      signal: ctl.signal
    }).then((rr) => {
      if (!rr.ok || !rr.body) throw Object.assign(new Error('не удалось открыть поток событий (' + rr.status + ')'), { code: 'stream' });
      return rr;
    });
    streamP.catch(() => {});   // если упадёт — разберёмся ниже, не в виде unhandled rejection

    // 2) работа. Агент начнёт, только когда есть и input, и подключённое окружение.
    try {
      await call('POST', `/agents/sessions/${encodeURIComponent(rec.session_id)}/events`, {
        events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text }] }] }]
      });
      sawInput = true;
    } catch (e) {
      streamP.then((rr) => { try { rr.body?.cancel?.().catch?.(() => {}); } catch { /* уже */ } }).catch(() => {});
      throw e;
    }
    r0 = await streamP;
  } catch (e) {
    clearTimeout(timer);
    if (r0?.body) { try { r0.body.cancel().catch(() => {}); } catch { /* уже */ } }
    const code = e?.name === 'AbortError' ? 'timeout'
      : (typeof e?.code === 'string' && e.code) ? e.code : 'network';
    const out = { error: code, detail: e?.detail || e?.message || String(e) };
    fail(out.error, out.detail);
    return out;
  }

  const reader = r0.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const raced = await Promise.race([
        reader.read().then((x) => ({ kind: 'chunk', x })).catch((e) => ({ kind: 'err', e })),
        finished.then(() => ({ kind: 'done' }))
      ]);
      if (raced.kind !== 'chunk' || done) break;
      const { value, done: streamEnd } = raced.x;
      if (streamEnd) break;
      buf += dec.decode(value, { stream: true });
      let cut;
      while ((cut = buf.indexOf('\n\n')) >= 0 && !done) {
        const chunk = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        for (const line of chunk.split('\n')) {
          const l = line.trim();
          if (!l.startsWith('data:')) continue;
          const payload = l.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let ev = null;
          try { ev = JSON.parse(payload); } catch { continue; }
          handleEvent(ev);
        }
      }
    }
    try { reader.cancel().catch(() => {}); } catch { /* поток мог закрыться сам */ }
  } catch (e) {
    if (e?.name !== 'AbortError') err = e;
  } finally {
    clearTimeout(timer);
  }

  function handleEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    const t = ev.type || '';
    health.last_event = t;
    onEvent?.(ev);
    if (t === 'agent.session.environment.pending') rec.env_state = 'pending';
    if (t === 'agent.session.environment.connected') rec.env_state = 'connected';
    if (t === 'agent.session.environment.failed') {
      rec.env_state = 'failed';
      // окружение отвалилось — пробуем поднять исполнителя ещё раз ровно один раз
      if (!rec.retried_executor && env('AGENTS_EXECUTOR_CMD')) {
        rec.retried_executor = true;
        console.warn('[agents] окружение не подключилось — перезапускаю исполнителя');
        stopExecutor(rec);
        startExecutor(rec);
      } else {
        finish({ error: 'environment_failed', detail: 'codex exec-server не подключился к окружению' });
      }
      return;
    }
    if (t === 'agent.session.turn.output_text.delta') {
      const k = `${ev.item_id}:${ev.output_index}:${ev.content_index}`;
      parts.set(k, (parts.get(k) || '') + (ev.delta || ''));
      onDelta?.(ev.delta || '');
      return;
    }
    if (t === 'agent.session.turn.output_text.done') {
      const k = `${ev.item_id}:${ev.output_index}:${ev.content_index}`;
      parts.set(k, ev.text || parts.get(k) || '');
      return;
    }
    if (t === 'agent.session.requires_action') {
      // нужен результат функции или подключение окружения: тулзов у нас нет,
      // так что честно сообщаем, что агент ждёт действия
      finish({ error: 'requires_action', detail: 'агент ждёт действия (функция или окружение) — в чате поддержки это не обработано' });
      return;
    }
    if (t === 'error') { finish({ error: 'agents_error', detail: ev?.error?.message || 'ошибка потока' }); return; }
    if (t === 'agent.session.turn.failed' && !ev?.turn?.subagent_id) {
      finish({ error: 'turn_failed', detail: ev?.turn?.error?.message || 'ход завершился ошибкой' });
      return;
    }
    if (t === 'agent.session.turn.cancelled' && !ev?.turn?.subagent_id) { finish({ error: 'cancelled', detail: 'ход отменён' }); return; }
    if (t === 'agent.session.turn.completed' && !ev?.turn?.subagent_id) { finish({ text: joinParts(parts) }); return; }
    if (t === 'agent.session.idle' && sawInput && parts.size) finish({ text: joinParts(parts) });
  }

  const out = done
    || (err ? { error: err.code || 'agents_http', detail: err.detail || err.message } : null)
    || (rec.env_state !== 'connected'
        ? { error: 'environment_pending', detail: 'окружение не подключилось: codex exec-server не запущен или не достучался до API (AGENTS_EXECUTOR_CMD / OPENAI_EXECUTOR_API_KEY)' }
        : { error: 'no_turn', detail: 'поток закрылся, ход не завершился' });
  if (!out.error) { turns(rec); return out; }
  fail(out.error, out.detail);
  return out;
}
function joinParts(parts) {
  const max = num('AGENTS_MAX_CHARS', 1800);
  // один ответ = обычно один content-блок; если их несколько — склеиваем по порядку
  let text = [...parts.values()].filter(Boolean).join('\n\n').trim();
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
const turns = (rec) => { rec.turns = (rec.turns || 0) + 1; rec.last_used = Date.now(); health.turns++; };

/* ---------- публичный API ---------- */
/** Один ход диалога. Возвращает { text } | { error, detail } — как ai.complete(). */
export async function ask({ key, userText, userContext = {}, channel = 'telegram', onDelta, onEvent } = {}) {
  if (!agentsEnabled()) return { error: 'off' };
  const text = String(userText || '').trim().slice(0, 2000);
  if (!text) return { error: 'empty' };
  const mapKey = String(key || channel);
  let rec = sessions.get(mapKey);
  if (rec && Date.now() - (rec.last_used || 0) > num('AGENTS_SESSION_TTL_S', 3600) * 1000) {
    await closeSession(mapKey, 'ttl');
    rec = null;
  }
  try {
    if (!rec) rec = await createSession(mapKey, { userContext, channel });
  } catch (e) {
    fail(e.code || 'create_session', e.detail || e.message);
    return { error: e.code || 'create_session', detail: e.detail || e.message };
  }
  rec.last_used = Date.now();
  const res = await streamTurn(rec, text, { onDelta, onEvent });
  return res && res.text !== undefined ? { text: res.text, session_id: rec.session_id, model: agentsModel() } : res;
}

/** Закрыть сессию: удаляем на стороне API и глушим исполнителя. */
export async function closeSession(key, why = 'manual') {
  const rec = sessions.get(String(key));
  if (!rec) return false;
  sessions.delete(String(key));
  stopExecutor(rec);
  try {
    await call('DELETE', `/agents/sessions/${encodeURIComponent(rec.session_id)}`, undefined, { timeoutMs: 10000 });
  } catch (e) { /* уже умерла или нет прав — не критично */ }
  health.closed++;
  console.log(`[agents] сессия ${rec.session_id} закрыта (${why})`);
  return true;
}
export function closeAllSessions(why = 'shutdown') {
  for (const key of [...sessions.keys()]) closeSession(key, why);
}

/* ---------- чистка протухших ---------- */
const sweeper = setInterval(() => {
  const ttl = num('AGENTS_SESSION_TTL_S', 3600) * 1000;
  for (const [key, rec] of sessions) {
    if (Date.now() - (rec.last_used || 0) > ttl) closeSession(key, 'ttl');
  }
}, 60000);
sweeper.unref?.();

/** Что писать в лог при старте. */
export function agentsStatusLine() {
  if (!agentsEnabled()) return null;
  const h = agentsDiagnostics();
  return `[agents] Agents API: модель ${h.model}, окружение ${h.workspace}, исполнитель: ${h.executor_cmd ? 'автозапуск' : 'вручную'}, ключ окружения: ${maskKey(env('OPENAI_EXECUTOR_API_KEY') || env('CODEX_API_KEY'))}`;
}
export const agentsEnv = { hasExecutorKey: () => !!(env('OPENAI_EXECUTOR_API_KEY') || env('CODEX_API_KEY')), hasExecutorCmd: () => !!env('AGENTS_EXECUTOR_CMD') };
