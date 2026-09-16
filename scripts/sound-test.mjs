#!/usr/bin/env node
/* ============================================================
   дибитишка · бинауральные ритмы — проверки без звука
   ------------------------------------------------------------
   Запуск: node scripts/sound-test.mjs   (или npm run sound-test)

   Web Audio подменяется записывающим моком, время — виртуальными
   часами: проверяем ровно то, что услышал бы человек, — частоты в
   левом/правом канале, разделение каналов, затухание, таймер и то,
   что отложенное затухание не убивает новый запуск. Ни одного
   реального аудиоустройства и ни одной сети.
   ============================================================ */
import assert from 'node:assert/strict';
import {
  BINAURAL_PRESETS, presetById, tonePair, normalizeVolume, formatClock,
  audioSupported, createBinauralEngine, MIN_BEAT, MAX_BEAT, MIN_CARRIER, MAX_CARRIER
} from '../app/js/sound.js';

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('  ✓ ' + name); };

/* ---------- виртуальные часы ---------- */
let vtime = 0;
let tid = 0;
const timers = new Map();
const fSetTimeout = (fn, ms) => { const id = ++tid; timers.set(id, { at: vtime + Math.max(0, Number(ms) || 0), fn }); return id; };
const fClearTimeout = (id) => { timers.delete(id); };
function advance(ms) {
  const target = vtime + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.at <= target && (!next || t.at < next.at)) next = { id, at: t.at, fn: t.fn };
    if (!next) break;
    vtime = next.at;
    timers.delete(next.id);
    next.fn();
  }
  vtime = target;
}
const resetClock = () => { vtime = 0; timers.clear(); };

/* ---------- мок Web Audio ---------- */
class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); this.value = v; return this; }
  setTargetAtTime(v, t, c) { this.events.push(['target', v, t, c]); this.value = v; return this; }
  cancelScheduledValues(t) { this.events.push(['cancel', t]); return this; }
}
class MockNode {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = []; this.disconnected = false; }
  connect(dest, outChannel = 0, inChannel = 0) { this.outs.push({ dest, outChannel, inChannel }); return dest; }
  disconnect() { this.disconnected = true; this.outs = []; }
}
const contexts = [];
class MockAudioContext {
  constructor() {
    this.sampleRate = 44100;
    this.state = 'running';
    this.closed = false;
    this.destination = new MockNode(this, 'destination');
    this.nodes = [];
    contexts.push(this);
  }
  get currentTime() { return vtime / 1000; }
  _add(node) { this.nodes.push(node); return node; }
  createGain() { const n = this._add(new MockNode(this, 'gain')); n.gain = new Param(1); return n; }
  createChannelMerger(channels) { const n = this._add(new MockNode(this, 'merger')); n.channels = channels; return n; }
  createOscillator() {
    const n = this._add(new MockNode(this, 'osc'));
    n.type = 'sine'; n.frequency = new Param(440);
    n.start = (t) => { n.startedAt = t; }; n.stop = (t) => { n.stoppedAt = t === undefined ? 0 : t; };
    return n;
  }
  createBufferSource() {
    const n = this._add(new MockNode(this, 'buffer'));
    n.buffer = null; n.loop = false;
    n.start = (t) => { n.startedAt = t; }; n.stop = (t) => { n.stoppedAt = t === undefined ? 0 : t; };
    return n;
  }
  createBiquadFilter() { const n = this._add(new MockNode(this, 'biquad')); n.type = 'lowpass'; n.frequency = new Param(350); return n; }
  createBuffer(channels, length, sampleRate) {
    const data = new Float32Array(length);
    return { numberOfChannels: channels, length, sampleRate, getChannelData: () => data };
  }
  suspend() { this.state = 'suspended'; }
  resume() { this.state = 'running'; }
  close() { this.closed = true; this.state = 'closed'; }
  of(kind) { return this.nodes.filter(n => n.kind === kind); }
  one(kind) { const [n] = this.of(kind); return n; }
}

const newEngine = (opts = {}) => {
  resetClock();
  contexts.length = 0;
  return createBinauralEngine({
    AudioContext: MockAudioContext,
    setTimeout: fSetTimeout,
    clearTimeout: fClearTimeout,
    now: () => vtime,
    ...opts
  });
};
const lastCtx = () => contexts[contexts.length - 1];

/* ---------- чистая математика тонов ---------- */
check('пресеты лежат внутри окна бинаурального эффекта', () => {
  for (const p of BINAURAL_PRESETS) {
    assert.ok(p.beat >= MIN_BEAT && p.beat <= MAX_BEAT, `${p.id}: пульс ${p.beat} Гц вне окна`);
    assert.ok(p.carrier >= MIN_CARRIER && p.carrier <= MAX_CARRIER, `${p.id}: несущая ${p.carrier} Гц вне окна`);
  }
});

check('разница частот равна заявленному пульсу у каждого пресета', () => {
  for (const p of BINAURAL_PRESETS) {
    const { left, right, beat } = tonePair(p);
    assert.equal(Math.round((right - left) * 10) / 10, beat, `${p.id}: ${right} − ${left} ≠ ${beat}`);
  }
});

check('тоны симметричны вокруг несущей', () => {
  const { left, right, carrier } = tonePair(presetById('alpha'));
  assert.equal(Math.round(((left + right) / 2) * 10) / 10, Math.round(carrier * 10) / 10);
});

check('своя несущая зажимается в безопасные границы', () => {
  assert.equal(tonePair(presetById('theta'), { carrier: 5000 }).carrier, MAX_CARRIER);
  assert.equal(tonePair(presetById('theta'), { carrier: 12 }).carrier, MIN_CARRIER);
  assert.equal(tonePair(presetById('theta'), { carrier: 'не число' }).carrier, presetById('theta').carrier);
});

check('громкость не выходит за 0..1', () => {
  assert.equal(normalizeVolume(2), 1);
  assert.equal(normalizeVolume(-3), 0);
  assert.equal(normalizeVolume('тихо'), 0);
  assert.equal(normalizeVolume(0.42), 0.42);
});

check('таймер показывает минуты и секунды', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(1800), '30:00');
  assert.equal(formatClock(-5), '0:00');
});

check('поддержка Web Audio определяется по окружению', () => {
  assert.equal(audioSupported({}), false);
  assert.equal(audioSupported({ AudioContext: MockAudioContext }), true);
});

/* ---------- движок ---------- */
check('старт строит два синуса и разводит их по ушам', () => {
  const engine = newEngine();
  engine.configure({ preset: 'theta', carrier: 0, volume: 0.3, minutes: 20, noise: false });
  engine.start();
  const ctx = lastCtx();
  const [a, b] = ctx.of('osc');
  const want = tonePair(presetById('theta'));
  assert.equal(a.type, 'sine');
  assert.equal(b.type, 'sine');
  assert.equal([a.frequency.value, b.frequency.value].sort((x, y) => x - y).join('/'),
    [want.left, want.right].sort((x, y) => x - y).join('/'));
  const merger = ctx.one('merger');
  assert.equal(merger.channels, 2);
  const inputs = [...a.outs, ...b.outs].filter(o => o.dest === merger).map(o => o.inChannel).sort();
  assert.deepEqual(inputs, [0, 1], 'оба осциллятора должны идти в разные каналы мерджера');
  assert.ok(ctx.one('gain').outs.some(o => o.dest === ctx.destination), 'мастер-громкость идёт в выход');
  assert.ok(merger.outs.some(o => o.dest.kind === 'gain'), 'мерджер идёт в мастер-громкость');
});

check('звук появляется плавно, а не щелчком', () => {
  const engine = newEngine();
  engine.configure({ preset: 'alpha', volume: 0.5, noise: false });
  engine.start();
  const events = lastCtx().one('gain').gain.events;
  assert.deepEqual(events[0].slice(0, 2), ['set', 0]);
  assert.deepEqual(events[1].slice(0, 2), ['ramp', 0.5]);
  assert.ok(events[1][2] > events[0][2], 'рампа идёт позже начала');
});

check('подложка шума идёт через низкие частоты в общую громкость', () => {
  const engine = newEngine();
  engine.configure({ preset: 'delta', noise: true });
  engine.start();
  const ctx = lastCtx();
  const src = ctx.one('buffer');
  assert.ok(src, 'нужен источник шума');
  assert.equal(src.loop, true, 'шум зациклен, иначе кончится через 4 секунды');
  assert.ok(src.buffer.length > 0);
  const lp = ctx.one('biquad');
  assert.equal(lp.type, 'lowpass');
  assert.ok(src.outs.some(o => o.dest === lp) && lp.outs.some(o => o.dest.kind === 'gain'));
  engine.destroy();

  const quiet = newEngine();
  quiet.configure({ preset: 'delta', noise: false });
  quiet.start();
  assert.equal(lastCtx().of('buffer').length, 0, 'шум выключен — источника нет');
  quiet.destroy();
});

check('без Web Audio старт честно падает, а не молчит', () => {
  resetClock();
  const engine = createBinauralEngine({ AudioContext: null, setTimeout: fSetTimeout, clearTimeout: fClearTimeout, now: () => vtime });
  assert.throws(() => engine.start(), /unsupported/);
  assert.equal(engine.playing, false);
});

check('пауза замораживает отсчёт, продолжение — отпускает', () => {
  const engine = newEngine();
  engine.configure({ preset: 'theta', minutes: 10, noise: false });
  engine.start();
  assert.equal(engine.state().secondsLeft, 600);
  advance(60000);
  assert.equal(engine.state().secondsLeft, 540);
  engine.pause();
  assert.equal(lastCtx().state, 'suspended');
  advance(60000);
  assert.equal(engine.state().secondsLeft, 540, 'на паузе время не уходит');
  engine.resume();
  assert.equal(lastCtx().state, 'running');
  advance(60000);
  assert.equal(engine.state().secondsLeft, 480);
  engine.destroy();
});

check('таймер доигрывает сессию и убирает звук', () => {
  const engine = newEngine();
  engine.configure({ preset: 'theta', minutes: 5, noise: false });
  engine.start();
  const ctx = lastCtx();
  advance(5 * 60000);
  assert.equal(engine.playing, false, 'после таймера звук выключен');
  assert.equal(ctx.closed, true, 'контекст закрыт — батарея не тратится');
  assert.ok(ctx.of('osc').every(o => o.stoppedAt !== undefined), 'осцилляторы остановлены');
  assert.ok(ctx.of('osc').every(o => o.disconnected), 'узлы отключены');
});

check('стоп гасит звук и оставляет настройки человека', () => {
  const engine = newEngine();
  engine.configure({ preset: 'beta', minutes: 30, volume: 0.22, noise: true });
  engine.start();
  const ctx = lastCtx();
  engine.stop();
  advance(1000);
  assert.equal(engine.playing, false);
  assert.equal(ctx.closed, true);
  const st = engine.state();
  assert.equal(st.preset, 'beta');
  assert.equal(st.minutes, 30);
  assert.equal(st.volume, 0.22);
  assert.equal(st.noise, true);
  engine.destroy();
});

check('быстрый перезапуск: старое затухание не убивает новый звук', () => {
  const engine = newEngine();
  engine.configure({ preset: 'theta', minutes: 20, noise: false });
  engine.start();
  const first = lastCtx();
  engine.stop();                 // отложенное затухание на 620 мс
  engine.start();                // и сразу новый запуск
  const second = lastCtx();
  assert.notEqual(first, second);
  assert.equal(first.closed, true, 'старый контекст разобран сразу');
  advance(5000);                 // окно старого затухания прошло
  assert.equal(engine.playing, true, 'новый звук жив');
  assert.equal(second.closed, false);
  assert.equal(second.of('osc').length, 2);
  engine.destroy();
});

check('смена пресета на лету перестраивает тон, не обрывая звук', () => {
  const engine = newEngine();
  engine.configure({ preset: 'theta', carrier: 0, minutes: 15, noise: false });
  engine.start();
  const ctx = lastCtx();
  const [a, b] = ctx.of('osc');
  a.frequency.events.length = 0; b.frequency.events.length = 0;
  engine.configure({ preset: 'beta' });
  const want = tonePair(presetById('beta'));
  assert.equal(a.frequency.value, want.left);
  assert.equal(b.frequency.value, want.right);
  assert.equal(ctx.closed, false, 'звук не прерывался');
  assert.equal(engine.playing, true);
  engine.destroy();
});

check('подписка сообщает о состоянии, отписка — перестаёт', () => {
  const engine = newEngine();
  const seen = [];
  const off = engine.subscribe(s => seen.push(s.playing));
  engine.configure({ preset: 'alpha', minutes: 2, noise: false });
  engine.start();
  advance(2 * 60000);
  off();
  const before = seen.length;
  engine.configure({ preset: 'delta' });
  assert.equal(seen.length, before, 'после отписки событий нет');
  assert.deepEqual([seen[0], seen[seen.length - 1]], [false, false]);
  assert.ok(seen.includes(true), 'в середине прогона звук играл');
  engine.destroy();
});

check('несущая и длительность из настроек не ломают пресет', () => {
  const engine = newEngine();
  engine.configure({ preset: 'delta', carrier: 99999, minutes: 9999 });
  const st = engine.state();
  assert.equal(st.tones.carrier, MAX_CARRIER);
  assert.equal(st.minutes, 180);
  engine.destroy();
});

console.log(`\nsound: ${checks} проверок пройдено`);
