#!/usr/bin/env node
/* ============================================================
   дибитишка · генеративная эмбиент-музыка — проверки без звука
   ------------------------------------------------------------
   Запуск: node scripts/ambient-test.mjs   (или npm run ambient-test)

   Web Audio подменяется записывающим моком, время — виртуальными
   часами. Проверяем то, из чего складывается музыка: ноты попадают
   в слышимый регистр, аккорды действительно сменяют друг друга и
   никогда не повторяются подряд, полотно входит и уходит медленно,
   слой воздуха меняется вместе со сценой, а сумма уровней не
   доводит до клиппинга. Плюс шум без щелчка на петле и импульс для
   эха с единичной энергией.

   Ни одного аудиоустройства и ни одной сети.
   ============================================================ */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AMBIENT_SCENES, sceneById, noteHz, noteName, foldIntoRange, foldIntoMidi, chordPlan, chordVoices,
  sceneBudget, normalizeVolume, normalizeTexture, normalizeVoice, formatClock, audioSupported, isInfinite,
  DURATIONS, makeRng, noiseBuffer, impulseResponse, createAmbientEngine,
  scaleNote, degreeOfOffset, chordDegrees, isChordTone, makeMotif, melodyPlan, phraseCount, NOTE_SECONDS,
  STABLE_DEGREES, AMBIENCE_DIR, BED_TRIM, BED_DRIFT_DEPTH, AIR_CROSSFADE, GLUE, afterGlue,
  bedLevel, bedPeak, voicePeak, accentPeak, dbToLinear
} from '../app/js/ambient.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AMB_DIR = path.join(ROOT, 'app', AMBIENCE_DIR);

let checks = 0;
/* Проверка может быть асинхронной: загрузка записи сцены — это обещание,
   и ждать её нужно по-настоящему, а не «на глаз». */
const check = async (name, fn) => { await fn(); checks++; console.log('  ✓ ' + name); };

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
const pendingTimers = () => timers.size;

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
    this.sampleRate = 48000;
    this.state = 'running';
    this.closed = false;
    this.destination = new MockNode(this, 'destination');
    this.nodes = [];
    contexts.push(this);
  }
  get currentTime() { return vtime / 1000; }
  _add(node) { this.nodes.push(node); return node; }
  createGain() { const n = this._add(new MockNode(this, 'gain')); n.gain = new Param(1); return n; }
  createOscillator() {
    const n = this._add(new MockNode(this, 'osc'));
    n.type = 'sine'; n.frequency = new Param(440); n.detune = new Param(0);
    n.start = (t) => { n.startedAt = t; }; n.stop = (t) => { n.stoppedAt = t === undefined ? 0 : t; };
    return n;
  }
  createBufferSource() {
    const n = this._add(new MockNode(this, 'buffer'));
    n.buffer = null; n.loop = false; n.playbackRate = new Param(1);
    n.start = (t, offset, duration) => { n.startedAt = t; n.startOffset = offset; n.startDuration = duration; };
    n.stop = (t) => { n.stoppedAt = t === undefined ? 0 : t; };
    return n;
  }
  createDynamicsCompressor() {
    const n = this._add(new MockNode(this, 'compressor'));
    n.threshold = new Param(-24); n.knee = new Param(30); n.ratio = new Param(12);
    n.attack = new Param(0.003); n.release = new Param(0.25);
    return n;
  }
  createBiquadFilter() {
    const n = this._add(new MockNode(this, 'biquad'));
    n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1);
    return n;
  }
  createStereoPanner() { const n = this._add(new MockNode(this, 'panner')); n.pan = new Param(0); return n; }
  createConvolver() { const n = this._add(new MockNode(this, 'convolver')); n.buffer = null; n.normalize = true; return n; }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels, length, sampleRate,
      getChannelData: (ch = 0) => data[ch]
    };
  }
  suspend() { this.state = 'suspended'; }
  resume() { this.state = 'running'; }
  close() { this.closed = true; this.state = 'closed'; }
  of(kind) { return this.nodes.filter(n => n.kind === kind); }
  one(kind) { const [n] = this.of(kind); return n; }
}

/* Записей в проверках нет и сети нет: по умолчанию loadBed честно падает,
   и движок обязан играть запасным шумом. Где запись нужна — подставляем
   фейковый буфер (см. «запись сцены становится воздухом»). */
const offline = () => Promise.reject(new Error('нет сети в проверках'));
const fakeBuffer = (seconds = 38.5) => ({
  duration: seconds, length: Math.round(seconds * 48000), sampleRate: 48000, numberOfChannels: 1,
  getChannelData: () => new Float32Array(Math.round(seconds * 48000))
});
/** Фейк загрузки: помнит, что просили, и отдаёт буфер нужной длины. */
function fakeLoader(map = {}) {
  const asked = [];
  const load = (file) => {
    asked.push(file);
    return map[file] ? Promise.resolve(fakeBuffer(map[file])) : Promise.reject(new Error('нет файла ' + file));
  };
  return { load, asked };
}
const newEngine = (opts = {}) => {
  resetClock();
  contexts.length = 0;
  return createAmbientEngine({
    AudioContext: MockAudioContext,
    setTimeout: fSetTimeout,
    clearTimeout: fClearTimeout,
    now: () => vtime,
    seed: 42,
    requestIdleCallback: (fn) => { fn(); return 1; },
    loadBed: offline,
    ...opts
  });
};
/** Дать обещаниям разрешиться: виртуальные часы для них не нужны. */
const flush = () => new Promise((r) => setImmediate(r));
const lastCtx = () => contexts[contexts.length - 1];

/* ---------- ноты и регистр ---------- */
await check('нота считается из MIDI: A4 = 440 Гц, имя — с октавой', () => {
  assert.equal(noteHz(69), 440);
  assert.equal(Math.round(noteHz(60) * 100) / 100, 261.63);
  assert.equal(noteName(69), 'A4');
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(45), 'A2');
});

await check('складывание ноты: слишком высокое опускается, слишком низкое поднимается', () => {
  assert.equal(noteHz(foldIntoRange(96, 150, 560)) <= 560, true);
  assert.equal(noteHz(foldIntoRange(30, 150, 560)) >= 150, true);
  assert.equal(foldIntoRange(60, 150, 560), 60, 'нота в регистре не двигается');
});

await check('все сцены: уникальные id, шаги подписаны, регистр шире октавы', () => {
  const ids = AMBIENT_SCENES.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'id сцен не повторяются');
  for (const s of AMBIENT_SCENES) {
    const [low, high] = s.pad.register;
    assert.ok(high >= low * 2, `${s.id}: в регистр ${low}–${high} Гц нота может не поместиться`);
    assert.ok(s.steps.length >= 3, `${s.id}: нужно хотя бы три аккорда`);
    for (const step of s.steps) {
      assert.ok(/^[A-G]/.test(step.label), `${s.id}: метка аккорда «${step.label}» не похожа на аккорд`);
      assert.ok(step.notes.length >= 4, `${s.id} ${step.label}: меньше четырёх голосов — это уже не полотно`);
    }
  }
});

await check('полотно каждой сцены лежит в слышимом регистре 110–640 Гц', () => {
  for (const scene of AMBIENT_SCENES) {
    for (let i = 0; i < scene.steps.length; i++) {
      const v = chordVoices(scene, i);
      assert.equal(v.label, scene.steps[i].label);
      for (const note of v.notes) {
        assert.ok(note.hz >= 100 && note.hz <= 660, `${scene.id} ${v.label}: ${note.name} = ${note.hz} Гц вне регистра`);
        assert.ok(note.pan >= -1 && note.pan <= 1, `${scene.id}: панорама вне −1..1`);
      }
      assert.equal(v.bass.midi, scene.root + scene.steps[i].offset, 'бас стоит на корне аккорда');
      assert.ok(v.bass.hz < v.notes[0].hz || v.bass.hz < 200, `${scene.id}: бас должен быть ниже полотна`);
    }
  }
});

/* ---------- это музыка, а не ритм ---------- */
await check('все сцены медленные: аккорд держится не меньше 40 секунд', () => {
  for (const s of AMBIENT_SCENES) {
    assert.ok(s.pad.interval >= 40, `${s.id}: аккорд меняется каждые ${s.pad.interval} c — это уже ритм`);
    assert.ok(s.pad.attack + s.pad.release <= s.pad.interval,
      `${s.id}: вход ${s.pad.attack} + уход ${s.pad.release} больше ${s.pad.interval} — полотна наедут друг на друга`);
    assert.ok(s.pad.attack >= 10, `${s.id}: полотно входит за ${s.pad.attack} c — слишком резко`);
    for (const path of s.texture.paths) {
      for (const sw of path.swells || []) {
        /* короче девяти секунд ухо уже слышит не дыхание, а пульс */
        assert.ok(sw.seconds >= 9, `${s.id}: дыхание слоя ${sw.seconds} c — это уже ритм`);
      }
      for (const sw of path.sweeps || []) {
        assert.ok(sw.seconds >= 9, `${s.id}: качание фильтра ${sw.seconds} c — это уже ритм`);
      }
    }
  }
});

await check('у каждой сцены есть слой воздуха и хотя бы одна его ветка', () => {
  for (const s of AMBIENT_SCENES) {
    assert.ok(s.texture.level > 0, `${s.id}: слоя воздуха нет вовсе`);
    assert.ok(Array.isArray(s.texture.paths) && s.texture.paths.length >= 1, `${s.id}: ветки слоя не описаны`);
    for (const path of s.texture.paths) {
      assert.ok(path.level === undefined || (path.level > 0 && path.level <= 1), `${s.id}: уровень ветки вне 0..1`);
      assert.ok(path.filters && path.filters.length >= 1, `${s.id}: ветка без фильтра — это просто белый шум`);
    }
  }
});

await check('сумма уровней сцены оставляет запас до клиппинга', () => {
  for (const s of AMBIENT_SCENES) {
    const budget = sceneBudget(s);
    assert.ok(budget > 0.2 && budget < 0.62, `${s.id}: пик ${budget} — либо неслышно, либо на грани клиппинга`);
  }
});

await check('план аккордов: не повторяется подряд и всегда из своей сцены', () => {
  for (const s of AMBIENT_SCENES) {
    const plan = chordPlan(s, makeRng(7), 40);
    assert.equal(plan.length, 40);
    for (let i = 0; i < plan.length; i++) {
      assert.ok(plan[i] >= 0 && plan[i] < s.steps.length, `${s.id}: аккорд вне сцены`);
      if (i) assert.notEqual(plan[i], plan[i - 1], `${s.id}: один и тот же аккорд дважды подряд`);
    }
    assert.ok(new Set(plan).size >= Math.min(3, s.steps.length), `${s.id}: сцена топчется на одном аккорде`);
  }
});

await check('с одним seed музыка повторяема, с разными — разная', () => {
  const a = chordPlan(sceneById('sea'), makeRng(2024), 24).join(',');
  const b = chordPlan(sceneById('sea'), makeRng(2024), 24).join(',');
  const c = chordPlan(sceneById('sea'), makeRng(2025), 24).join(',');
  assert.equal(a, b, 'один seed — один и тот же порядок аккордов');
  assert.notEqual(a, c, 'разные seed — разная музыка');
});

await check('у колыбельной полотно заметно ниже, чем у космоса', () => {
  const mean = (notes) => notes.reduce((sum, n) => sum + n.hz, 0) / notes.length;
  const low = mean(chordVoices(sceneById('lullaby'), 0).notes);
  const high = mean(chordVoices(sceneById('space'), 0).notes);
  assert.ok(low < high * 0.6, `колыбельная ${Math.round(low)} Гц против космоса ${Math.round(high)} Гц — регистры сцен должны различаться на слух`);
});

/* ---------- мелкие утилиты ---------- */
await check('громкость и «воздух» не выходят за 0..1', () => {
  assert.equal(normalizeVolume(2), 1);
  assert.equal(normalizeVolume(-3), 0);
  assert.equal(normalizeVolume('тихо'), 0);
  assert.equal(normalizeTexture(0.4), 0.4);
});

await check('«без конца» — это 0 минут, а не ошибка', () => {
  assert.ok(DURATIONS.includes(0), 'в списке длительностей есть бесконечная');
  assert.equal(isInfinite(0), true);
  assert.equal(isInfinite(30), false);
  assert.equal(isInfinite(''), true);
});

await check('таймер показывает минуты и секунды', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(-5), '0:00');
});

await check('поддержка Web Audio определяется по окружению', () => {
  assert.equal(audioSupported({}), false);
  assert.equal(audioSupported({ AudioContext: MockAudioContext }), true);
});

/* ---------- шум и эхо ---------- */
await check('буфер шума зацикливается без щелчка на шве', () => {
  resetClock();
  const ctx = new MockAudioContext();
  const buf = noiseBuffer(ctx, 'brown', 4, makeRng(3));
  assert.equal(buf.length, 4 * ctx.sampleRate);
  const data = buf.getChannelData(0);
  const step = (from) => {
    let max = 0;
    for (let i = from; i < from + 200; i++) max = Math.max(max, Math.abs(data[i + 1] - data[i]));
    return max;
  };
  const seam = step(0), middle = step(Math.floor(data.length / 2));
  assert.ok(seam <= middle * 3 + 1e-9, `на шве скачок ${seam.toFixed(5)} против ${middle.toFixed(5)} в середине`);
});

await check('импульс для эха: две дорожки, предзадержка, единичная энергия', () => {
  resetClock();
  const ctx = new MockAudioContext();
  const ir = impulseResponse(ctx, 4, makeRng(5));
  assert.equal(ir.numberOfChannels, 2);
  assert.equal(ir.length, 4 * ctx.sampleRate);
  const pre = Math.floor(0.03 * ctx.sampleRate);
  let energy = 0, head = 0, tail = 0, perChannel = [];
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let e = 0;
    for (let i = 0; i < data.length; i++) {
      const s = data[i] * data[i];
      e += s;
      if (i < pre - 5) head += s;
      if (i > data.length * 0.8) tail += s;
    }
    perChannel.push(e);
    energy += e;
  }
  /* энергия считается по двум дорожкам сразу: моно-источник через эхо
     не должен становиться громче самого себя */
  assert.ok(Math.abs(energy - 1) < 0.001, `энергия импульса ${energy.toFixed(4)} вместо 1`);
  assert.equal(head, 0, 'до источника должна быть тишина (предзадержка)');
  assert.ok(tail < energy * 0.2, 'хвост должен затухать, а не тянуться ровно');
  assert.ok(Math.min(...perChannel) > energy * 0.2, 'в обеих дорожках есть свой хвост — эхо шириной в стерео');
  const a = ir.getChannelData(0), b = ir.getChannelData(1);
  let cross = 0;
  for (let i = 0; i < a.length; i++) cross += a[i] * b[i];
  assert.ok(Math.abs(cross) < 0.05, `дороги эха похожи (${cross.toFixed(3)}) — это моно, а не воздух`);
});

/* ---------- движок ---------- */
await check('старт собирает полотно, бас, воздух и эхо', () => {
  const engine = newEngine();
  engine.configure({ scene: 'sea', volume: 0.3, minutes: 20, texture: 1, reverb: true });
  engine.start();
  const ctx = lastCtx();
  const scene = sceneById('sea');
  const voices = chordVoices(scene, 0).notes.length;
  const oscs = ctx.of('osc').filter(o => o.startedAt !== undefined);
  assert.ok(oscs.length >= voices * 2, `генераторов ${oscs.length}, а нужно минимум ${voices * 2}`);
  assert.ok(ctx.of('panner').length >= voices, 'голоса должны расходиться по стерео');
  assert.ok(ctx.one('convolver'), 'эхо собирается из импульса');
  assert.equal(ctx.one('buffer').loop, true, 'слой воздуха зациклен');
  assert.equal(ctx.of('biquad').some(b => b.type === 'lowpass'), true);
  engine.destroy();
});

await check('музыка появляется плавно, а не щелчком', () => {
  const engine = newEngine();
  engine.configure({ scene: 'sea', volume: 0.42 });
  engine.start();
  const events = lastCtx().one('gain').gain.events;
  assert.deepEqual(events[0].slice(0, 2), ['set', 0]);
  assert.deepEqual(events[1].slice(0, 2), ['ramp', 0.42]);
  assert.ok(events[1][2] > events[0][2], 'нарастание идёт позже начала');
  engine.destroy();
});

await check('аккорды сменяют друг друга сами и не повторяются подряд', () => {
  const engine = newEngine();
  const seen = [];
  engine.subscribe(st => { if (st.playing && st.chord) seen.push(st.chord.label); });
  engine.configure({ scene: 'hearth', minutes: 30, texture: 1 });
  engine.start();
  const interval = sceneById('hearth').pad.interval;
  for (let i = 0; i < 6; i++) advance(interval * 1000 + 10);
  const labels = [...new Set(seen)];
  assert.ok(labels.length >= 3, `за шесть интервалов прозвучало всего ${labels.join(', ')}`);
  const timeline = seen.filter((x, i) => i === 0 || x !== seen[i - 1]);
  for (let i = 1; i < timeline.length; i++) assert.notEqual(timeline[i], timeline[i - 1], 'один аккорд дважды подряд');
  engine.destroy();
});

await check('вход нового аккорда длится десятки секунд, а не секунду', () => {
  const engine = newEngine();
  engine.configure({ scene: 'space', minutes: 30 });
  engine.start();
  const ctx = lastCtx();
  const before = ctx.nodes.length;
  advance(sceneById('space').pad.interval * 1000 + 10);
  const durations = ctx.nodes.slice(before)
    .filter(n => n.kind === 'gain')
    .map(g => {
      const set = g.gain.events.find(e => e[0] === 'set');
      const ramp = g.gain.events.find(e => e[0] === 'ramp');
      return set && ramp ? ramp[2] - set[2] : 0;
    })
    .filter(d => d > 0);
  assert.ok(durations.length >= 4, `нарастаний ${durations.length} — у каждого голоса своё`);
  const slowest = Math.max(...durations);
  assert.ok(slowest >= 15, `самое долгое нарастание ${slowest} c — полотно входит слишком резко`);
  engine.destroy();
});

await check('смена сцены на ходу: полотно живёт, воздух меняется', () => {
  const engine = newEngine();
  engine.configure({ scene: 'sea', minutes: 30, texture: 1 });
  engine.start();
  const before = lastCtx();
  const buffersBefore = before.of('buffer').length;
  engine.configure({ scene: 'rain' });
  const st = engine.state();
  assert.equal(st.scene, 'rain');
  assert.equal(st.title, 'Дождь на стекле');
  assert.ok(st.chord && /^[A-G]/.test(st.chord.label), 'экран по-прежнему знает, какой аккорд звучит');
  assert.equal(before.closed, false, 'музыка не прервалась');
  assert.equal(engine.playing, true);
  const src = before.of('buffer');
  assert.equal(src.length, buffersBefore + 1, 'слой воздуха заменён на новый');
  assert.equal(src.filter(b => b.stoppedAt === undefined).length, 1, 'звучит ровно один слой воздуха');
  engine.destroy();
});

await check('«Воздух» и «Пространство» управляют слоями', () => {
  const engine = newEngine();
  engine.configure({ scene: 'forest', texture: 0, reverb: false });
  engine.start();
  const ctx = lastCtx();
  const scene = sceneById('forest');
  /* слой воздуха — единственный гейн, который идёт и в сухой сигнал, и в эхо */
  const textureGain = ctx.of('gain').find(g => g.outs.length === 2 && g.gain.value === 0);
  assert.ok(textureGain, '«Воздух» на нуле — уровень слоя нулевой');
  const conv = ctx.one('convolver');
  const wet = conv.outs.map(o => o.dest).find(n => n.kind === 'gain');
  assert.equal(wet.gain.value, 0, '«Пространство» выключено — эхо молчит');
  engine.configure({ reverb: true, texture: 1 });
  assert.equal(engine.state().reverb, true);
  assert.equal(engine.state().texture, 1);
  assert.ok(scene.texture.level > 0 && scene.reverb.wet > 0);
  const target = wet.gain.events.find(e => e[0] === 'target');
  assert.ok(target && Math.abs(target[1] - scene.reverb.wet) < 1e-9, 'эхо вернулось на уровень сцены');
  const air = textureGain.gain.events.find(e => e[0] === 'target');
  assert.ok(air && Math.abs(air[1] - scene.texture.level) < 1e-9, 'воздух вернулся на уровень сцены');
  engine.destroy();
});

await check('пауза замораживает отсчёт, продолжение — отпускает', () => {
  const engine = newEngine();
  engine.configure({ scene: 'rain', minutes: 10 });
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

await check('таймер доигрывает сессию и гасит звук', () => {
  const engine = newEngine();
  engine.configure({ scene: 'lullaby', minutes: 10 });
  engine.start();
  const ctx = lastCtx();
  advance(10 * 60000);
  assert.equal(engine.playing, false, 'после таймера музыки нет');
  assert.equal(ctx.closed, true, 'контекст закрыт — батарея не тратится');
  engine.destroy();
});

await check('«без конца» не ставит таймер и играет, пока не остановишь', () => {
  const engine = newEngine();
  engine.configure({ scene: 'sea', minutes: 0 });
  engine.start();
  const st = engine.state();
  assert.equal(st.infinite, true);
  assert.equal(st.totalSeconds, 0);
  advance(6 * 60 * 1000);
  assert.equal(engine.playing, true, 'через шесть минут музыка всё ещё идёт');
  assert.ok(pendingTimers() >= 1, 'ждёт следующего аккорда, а не конца сессии');
  engine.stop();
  advance(1000);
  assert.equal(engine.playing, false);
  engine.destroy();
});

await check('стоп гасит музыку и оставляет выбор человека', () => {
  const engine = newEngine();
  engine.configure({ scene: 'space', minutes: 60, volume: 0.22, texture: 0.5, reverb: false });
  engine.start();
  const ctx = lastCtx();
  engine.stop();
  advance(1200);
  assert.equal(engine.playing, false);
  assert.equal(ctx.closed, true);
  const st = engine.state();
  assert.equal(st.scene, 'space');
  assert.equal(st.minutes, 60);
  assert.equal(st.volume, 0.22);
  assert.equal(st.texture, 0.5);
  assert.equal(st.reverb, false);
  engine.destroy();
});

await check('быстрый перезапуск: старое затухание не убивает новую музыку', () => {
  const engine = newEngine();
  engine.configure({ scene: 'sea', minutes: 20 });
  engine.start();
  const first = lastCtx();
  engine.stop();
  engine.start();
  const second = lastCtx();
  assert.notEqual(first, second);
  assert.equal(first.closed, true, 'старый граф разобран сразу');
  advance(5000);
  assert.equal(engine.playing, true, 'новая музыка жива');
  assert.equal(second.closed, false);
  engine.destroy();
});

await check('подписка сообщает о состоянии, отписка — перестаёт', () => {
  const engine = newEngine();
  const seen = [];
  const off = engine.subscribe(st => seen.push(st.playing));
  engine.configure({ scene: 'forest', minutes: 10 });
  engine.start();
  advance(10 * 60000);
  off();
  const before = seen.length;
  engine.configure({ scene: 'sea' });
  assert.equal(seen.length, before, 'после отписки событий нет');
  assert.deepEqual([seen[0], seen[seen.length - 1]], [false, false]);
  assert.ok(seen.includes(true), 'в середине прогона музыка играла');
  engine.destroy();
});

await check('без Web Audio старт честно падает, а не молчит', () => {
  resetClock();
  const engine = createAmbientEngine({ AudioContext: null, setTimeout: fSetTimeout, clearTimeout: fClearTimeout, now: () => vtime });
  assert.throws(() => engine.start(), /unsupported/);
  assert.equal(engine.playing, false);
});

await check('минуты и громкость не ломают настройки', () => {
  const engine = newEngine();
  engine.configure({ minutes: 9999, volume: 5, texture: -1 });
  const st = engine.state();
  assert.equal(st.minutes, 240);
  assert.equal(st.volume, 1);
  assert.equal(st.texture, 0);
  assert.equal(isInfinite(st.minutes), false);
  engine.destroy();
});

/* ============================================================
   v45: записи природы и голос
   ============================================================ */

/* ---------- лад, мотив, фраза ---------- */
await check('у каждой сцены есть лад, и все её аккорды — ступени этого лада', () => {
  for (const s of AMBIENT_SCENES) {
    assert.ok(Array.isArray(s.mode) && s.mode.length === 7, `${s.id}: лад — семь ступеней`);
    assert.equal(s.mode[0], 0, `${s.id}: лад начинается с тоники`);
    assert.deepEqual(s.mode, [...s.mode].sort((a, b) => a - b), `${s.id}: ступени лада идут по порядку`);
    assert.ok(new Set(s.mode).size === 7, `${s.id}: ступени лада повторяются`);
    for (const step of s.steps) {
      const d = degreeOfOffset(s, step.offset);
      assert.equal(scaleNote(s, d) - s.root, step.offset,
        `${s.id} ${step.label}: корень аккорда не ступень лада — мелодия с ним разминётся`);
      assert.ok(chordDegrees(d).length === 5, `${s.id}: аккорд строится из пяти ступеней`);
    }
  }
});

await check('мотив: 3–5 шагов, начало на тонике, финал на устойчивой ступени', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const m = makeMotif(makeRng(seed));
    assert.ok(m.length >= 3 && m.length <= 5, `мотив из ${m.length} нот — это не тема`);
    assert.equal(m[0], 0, 'мотив начинается с тоники аккорда');
    assert.ok(STABLE_DEGREES.includes(((m[m.length - 1] % 7) + 7) % 7),
      `финал на ступени ${m[m.length - 1]} — фраза не закрывается`);
    assert.ok(isChordTone(0, m[m.length - 1]), 'финал мотива — нота аккорда');
    for (let i = 1; i < m.length - 1; i++) {
      assert.ok(Math.abs(m[i] - m[i - 1]) <= 2, `шаг на ${Math.abs(m[i] - m[i - 1])} ступеней — мотив разваливается`);
    }
    assert.ok(Math.abs(m[m.length - 1] - m[m.length - 2]) <= 4, 'финальный шаг шире кварты — тема теряет певучесть');
    assert.ok(Math.max(...m) <= 9 && Math.min(...m) >= -7, `мотив вышел за диапазон ${Math.min(...m)}…${Math.max(...m)}`);
  }
  const same = makeMotif(makeRng(9)).join(',');
  assert.equal(makeMotif(makeRng(9)).join(','), same, 'с одним seed мотив тот же — музыка повторяема в проверках');
  const variants = new Set(Array.from({ length: 40 }, (_, i) => makeMotif(makeRng(i + 1)).join(',')));
  assert.ok(variants.size >= 3, `мотивов всего ${variants.size} — сессии будут звучать одинаково`);
});

await check('фраза целиком в ладу, в регистре голоса и закрывается ступенью аккорда', () => {
  for (const s of AMBIENT_SCENES) {
    for (let seed = 1; seed <= 20; seed++) {
      const motif = makeMotif(makeRng(seed));
      for (let i = 0; i < s.steps.length; i++) {
        const cd = degreeOfOffset(s, s.steps[i].offset);
        const plan = melodyPlan(s, {
          motif, anchorDegree: cd + STABLE_DEGREES[seed % 3], chordDegree: cd,
          random: makeRng(seed * 31 + i), voice: 1
        });
        assert.equal(plan.notes.length, motif.length, `${s.id}: в фразе не все ноты мотива`);
        plan.notes.forEach((n, k) => {
          assert.ok(s.mode.includes(((n.midi - s.root) % 12 + 12) % 12), `${s.id}: нота ${n.name} вне лада`);
          assert.ok(n.midi >= s.melody.register[0] && n.midi <= s.melody.register[1],
            `${s.id}: ${n.name} вне регистра голоса`);
          assert.ok(n.hz > 200 && n.hz < 2600, `${s.id}: ${n.hz} Гц — голос ушёл из слышимого диапазона`);
          assert.ok(n.vel > 0 && n.vel <= s.melody.level, `${s.id}: громкость ноты ${n.vel} вне уровня голоса`);
          assert.ok(n.pan >= -1 && n.pan <= 1, `${s.id}: панорама ноты вне −1..1`);
          assert.ok(n.tail >= 1.6, `${s.id}: хвост ноты короче 1,6 с — это щелчок, а не колокольчик`);
          if (k) {
            /* у каждой ноты своя человеческая задержка ±60…90 мс, поэтому
               между нотами возможно легато (до 0,15 с наезда) — но не больше */
            const gap = n.at - plan.notes[k - 1].at;
            assert.ok(gap >= plan.notes[k - 1].dur - 0.151, `${s.id}: ноты наехали друг на друга (${gap})`);
            assert.ok(gap <= plan.notes[k - 1].dur + 2.4 + 0.151, `${s.id}: пауза внутри фразы больше дыхания (${gap})`);
          }
          if (n.sub) {
            assert.ok(n.sub.midi < n.midi, `${s.id}: подголосок не ниже основной ноты`);
            assert.ok(n.sub.vel < n.vel, `${s.id}: подголосок громче основной ноты`);
          }
        });
        const last = plan.notes[plan.notes.length - 1];
        assert.ok(isChordTone(cd, last.degree),
          `${s.id}: фраза закончилась на ступени ${last.degree - cd} от корня аккорда — не устойчивая`);
        assert.ok(isChordTone(cd, plan.notes[0].degree), `${s.id}: фраза начинается не с ноты аккорда`);
        assert.ok(plan.seconds > 4, `${s.id}: фраза короче четырёх секунд`);
        assert.ok(plan.seconds < s.pad.interval, `${s.id}: фраза длиннее аккорда`);
      }
    }
  }
});

await check('длительности нот из одного набора, последняя в полтора раза длиннее', () => {
  const s = sceneById('sea');
  const cd = degreeOfOffset(s, s.steps[0].offset);
  const plan = melodyPlan(s, { motif: makeMotif(makeRng(3)), anchorDegree: cd, chordDegree: cd, random: makeRng(17) });
  plan.notes.forEach((n, i) => {
    const base = n.dur / (i === plan.notes.length - 1 ? 1.5 : 1);
    assert.ok(NOTE_SECONDS.some((d) => Math.abs(d - base) < 0.02),
      `длительность ${n.dur} с не из набора ${NOTE_SECONDS.join('/')}`);
  });
});

await check('ручка «Голос» множит ноты, а на нуле мелодии нет вовсе', () => {
  const s = sceneById('forest');
  const cd = degreeOfOffset(s, s.steps[0].offset);
  /* каждый прогон со своим генератором: иначе вторая фраза продолжит
     случайную последовательность первой и сравнивать будет нечего */
  const opts = () => ({ motif: makeMotif(makeRng(4)), anchorDegree: cd, chordDegree: cd, random: makeRng(21) });
  const full = melodyPlan(s, Object.assign(opts(), { voice: 1 }));
  const half = melodyPlan(s, Object.assign(opts(), { voice: 0.5 }));
  const none = melodyPlan(s, Object.assign(opts(), { voice: 0 }));
  half.notes.forEach((n, i) => assert.ok(Math.abs(n.vel - full.notes[i].vel * 0.5) < 1e-3, 'половина голоса — половина громкости ноты'));
  assert.ok(none.notes.every((n) => n.vel === 0), 'на нуле ноты не звучат');
  assert.equal(normalizeVoice(3), 1);
  assert.equal(normalizeVoice(-1), 0);
});

await check('фраз не больше двух на аккорд', () => {
  for (const s of AMBIENT_SCENES) {
    const counts = new Set();
    for (let i = 0; i < 40; i++) counts.add(phraseCount(s, s.pad.interval, makeRng(i + 1)));
    assert.ok(Math.max(...counts) <= 2, `${s.id}: ${Math.max(...counts)} фраз на аккорд — это уже суета`);
    assert.ok(Math.min(...counts) >= 1, `${s.id}: аккорд без единой фразы`);
  }
});

/* ---------- записи природы ---------- */
await check('записи сцен лежат в репозитории, длинные и в бюджете веса', () => {
  const onDisk = fs.readdirSync(AMB_DIR).filter((f) => f.endsWith('.m4a')).sort();
  assert.deepEqual(onDisk, ['chimes.m4a', 'forest.m4a', 'hearth.m4a', 'lullaby.m4a', 'rain.m4a', 'sea.m4a', 'space.m4a'],
    'лишних или недостающих записей нет');
  let total = 0;
  for (const s of AMBIENT_SCENES) {
    const file = path.join(ROOT, 'app', s.bed.file);
    assert.ok(fs.existsSync(file), `${s.id}: нет записи ${s.bed.file}`);
    const size = fs.statSync(file).size;
    total += size;
    const kb = size / 1024;
    assert.ok(kb >= 250 && kb <= 600, `${s.id}: петля ${Math.round(kb)} КБ — вне бюджета 250–600 КБ`);
    assert.ok(s.bed.seconds >= 30, `${s.id}: петля ${s.bed.seconds} с — короче 30 с её слышно как петлю`);
    assert.ok(s.bed.file.startsWith(AMBIENCE_DIR + '/'), `${s.id}: запись лежит не в ${AMBIENCE_DIR}`);
    assert.ok(!/^(https?:)?\/\//.test(s.bed.file) && !/^(https?:)?\/\//.test(s.accents.file),
      `${s.id}: звук обязан лежать в репозитории, а не по внешней ссылке`);
  }
  const accents = sceneById('sea').accents;
  const chimesPath = path.join(ROOT, 'app', accents.file);
  assert.ok(fs.existsSync(chimesPath), 'нет записи колокольчиков');
  const chimes = fs.statSync(chimesPath).size;
  total += chimes;
  assert.ok(chimes / 1024 >= 40 && chimes / 1024 <= 150, `колокольчики ${Math.round(chimes / 1024)} КБ — акцент обязан быть дешёвым`);
  assert.ok(total <= 3 * 1024 * 1024, `весь звук ${(total / 1048576).toFixed(2)} МБ — бюджет 3 МБ`);
  const licenses = path.join(AMB_DIR, 'LICENSES.md');
  assert.ok(fs.existsSync(licenses), 'рядом с записями нет LICENSES.md — происхождение звука потеряется');
  assert.ok(/CC0/i.test(fs.readFileSync(licenses, 'utf8')), 'в лицензиях не сказано про CC0');
});

await check('цифры сцен совпадают с измеренными файлами (files-report.json)', () => {
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'ambience', 'files-report.json'), 'utf8'));
  const byFile = new Map(report.map((r) => [r.file, r]));
  for (const s of AMBIENT_SCENES) {
    const r = byFile.get(s.bed.file);
    assert.ok(r, `${s.id}: запись ${s.bed.file} не измерена — в отчёте нет строки`);
    assert.ok(Math.abs(r.seconds - s.bed.seconds) <= 0.5,
      `${s.id}: в сцене петля ${s.bed.seconds} с, по измерению ${r.seconds} с`);
    assert.ok(Math.abs(r.peak_linear - s.bed.peak) <= 0.01,
      `${s.id}: пик в сцене ${s.bed.peak}, по измерению ${r.peak_linear} — бюджет громкости врёт`);
    assert.ok(String(r.codec).startsWith('aac'), `${s.id}: ${r.codec} — в WKWebView на iPhone Ogg/Opus не играет`);
    assert.equal(r.sample_rate, 48000, `${s.id}: частота ${r.sample_rate} — запись пересобрана без приведения`);
    assert.equal(r.channels, 'mono', `${s.id}: стерео вдвое тяжелее, а стерео делает движок`);
    assert.equal(fs.statSync(path.join(ROOT, 'app', r.file)).size, r.bytes,
      `${s.id}: файл на диске не тот, что измерен — обнови отчёт (node scripts/ambience/measure.mjs)`);
  }
  const chimes = byFile.get(sceneById('sea').accents.file);
  assert.ok(chimes, 'колокольчики не измерены');
  assert.ok(Math.abs(chimes.peak_linear - sceneById('sea').accents.peak) <= 0.01,
    'пик колокольчиков разошёлся с измерением');
  assert.ok(chimes.seconds <= 10, `акцент ${chimes.seconds} с — это уже не акцент`);
});

await check('петля не читается как петля: дыхание 25–49 с, стерео, фильтр', () => {
  for (const s of AMBIENT_SCENES) {
    const [a, b] = s.bed.drift;
    assert.ok(a >= 25 && a <= 49 && b >= 25 && b <= 49, `${s.id}: дыхание ${a}/${b} с — короче 25 с это уже пульс`);
    assert.notEqual(a, b, `${s.id}: одинаковые периоды дыхания совпадут по фазе`);
    assert.ok(s.bed.spread > 0 && s.bed.spread <= 0.5, `${s.id}: разведение копий по стерео вне 0..0,5`);
    assert.ok(s.bed.tone >= 400 && s.bed.tone <= 3000, `${s.id}: фильтр записи вне 400–3000 Гц`);
    assert.ok(s.bed.peak > 0.05 && s.bed.peak <= 0.9, `${s.id}: измеренный пик петли ${s.bed.peak} — цифры из отчёта потерялись`);
    assert.ok(s.bed.level > 0.2 && s.bed.level <= 0.6, `${s.id}: уровень записи вне 0,2–0,6`);
    assert.ok(BED_DRIFT_DEPTH > 0.1 && BED_DRIFT_DEPTH <= 0.3, 'дыхание записи слишком слабое или качает как волна');
    assert.ok(AIR_CROSSFADE >= 1.5 && AIR_CROSSFADE <= 2.5, `кроссфейд воздуха ${AIR_CROSSFADE} с — вне 1,5–2,5 с`);
  }
});

await check('акценты редкие и тихие, фразы не по сетке', () => {
  for (const s of AMBIENT_SCENES) {
    assert.ok(s.accents.gap[0] >= 40 && s.accents.gap[1] <= 180, `${s.id}: акценты чаще раза в 40 с — это уже ритм`);
    assert.ok(s.accents.gap[1] > s.accents.gap[0], `${s.id}: одинаковый промежуток акцентов читается как метроном`);
    assert.ok(s.accents.level >= 0.03 && s.accents.level <= 0.09, `${s.id}: акцент громче музыки`);
    assert.ok(s.melody.gap[0] >= 8 && s.melody.gap[1] <= 34, `${s.id}: паузы между фразами вне 8–34 с`);
    assert.ok(s.melody.gap[1] > s.melody.gap[0], `${s.id}: одинаковая пауза между фразами — это сетка`);
    assert.ok(s.melody.rest > 0.2 && s.melody.rest < 0.5, `${s.id}: дыхание внутри фразы вне 0,2–0,5`);
    /* окно регистра должно быть шире октавы, иначе ноту некуда складывать;
       полторы октавы — уже достаточно, чтобы голос не теснился */
    assert.ok(s.melody.register[1] - s.melody.register[0] >= 19,
      `${s.id}: в регистре голоса ${s.melody.register[1] - s.melody.register[0]} полутонов — меньше полутора октав`);
    assert.ok(s.melody.level > 0.08 && s.melody.level <= 0.2, `${s.id}: уровень голоса вне 0,08–0,2`);
    /* голос живёт выше полотна: иначе ноты тонут в аккорде */
    assert.ok(noteHz(s.melody.register[0]) > s.pad.register[0], `${s.id}: голос не выше полотна`);
  }
});

await check('бюджет с записью и голосом: после мягкого лимитера клиппинга нет', () => {
  for (const s of AMBIENT_SCENES) {
    const synth = sceneBudget(s);
    assert.ok(synth > 0.2 && synth < 0.62, `${s.id}: синтезаторные слои ${synth} — прежнее правило`);
    const bed = bedPeak(s);
    assert.ok(bed > 0.05 && bed < 1, `${s.id}: вклад записи в пик ${bed} — либо неслышно, либо горячо`);
    const sum = Math.round((synth + bed + voicePeak(s) + accentPeak(s)) * 1000) / 1000;
    const out = afterGlue(sum);
    assert.ok(out < 0.92, `${s.id}: сумма пиков ${sum} → после лимитера ${out}, запаса до клиппинга нет`);
    assert.ok(Math.abs(bedLevel(s, 1) - s.bed.level * BED_TRIM) < 1e-6, 'уровень записи = уровень сцены × поправка');
    assert.equal(bedLevel(s, 0), 0, '«Воздух» на нуле глушит и запись');
    assert.ok(Math.abs(dbToLinear(-3.14) - 0.7) < 0.01, 'dBFS переводится в амплитуду верно');
  }
  assert.equal(afterGlue(GLUE.threshold), GLUE.threshold, 'ниже порога лимитер сигнал не трогает');
  assert.ok(afterGlue(4) < 2.1, 'на очень громкой сумме лимитер сжимает вдвое');
});

/* ---------- движок: воздух из записей ---------- */
await check('запись сцены становится воздухом: две копии, разные точки входа, шум уходит', async () => {
  const loader = fakeLoader({ 'assets/ambience/sea.m4a': 38.5 });
  const engine = newEngine({ loadBed: loader.load });
  engine.configure({ scene: 'sea', volume: 0.4, minutes: 30, texture: 1 });
  engine.start();
  const ctx = lastCtx();
  const scene = sceneById('sea');
  assert.equal(engine.state().air.source, 'loading', 'пока запись в пути — играет запасной шум');
  assert.ok(ctx.of('buffer').some((b) => b.loop && b.stoppedAt === undefined), 'воздух слышно сразу, без ожидания сети');
  await flush();
  const st = engine.state();
  assert.equal(st.air.source, 'file', 'запись приехала и стала воздухом');
  assert.equal(st.air.file, scene.bed.file);
  const beds = ctx.of('buffer').filter((b) => b.buffer && b.buffer.duration === 38.5);
  assert.equal(beds.length, 2, 'две копии петли — фазы не совпадут');
  assert.ok(beds.every((b) => b.loop), 'запись зациклена');
  const offs = beds.map((b) => b.startOffset);
  assert.ok(offs.every((o) => o > 0 && o < 38.5), `точки входа внутри петли: ${offs}`);
  assert.notEqual(offs[0], offs[1], 'копии стартовали с одного места — петля будет слышна');
  const noise = ctx.of('buffer').filter((b) => b.buffer && b.buffer.duration === undefined);
  assert.ok(noise.length && noise.every((n) => n.stoppedAt !== undefined), 'запасной шум заглушён, а не брошен звучать');
  const tones = ctx.of('biquad').filter((b) => b.frequency.value === scene.bed.tone);
  assert.equal(tones.length, 2, 'у каждой копии свой фильтр');
  const pans = ctx.of('panner').filter((p) => Math.abs(Math.abs(p.pan.value) - scene.bed.spread) < 1e-9);
  assert.equal(pans.length, 2, 'копии разведены по стерео');
  assert.notEqual(pans[0].pan.value, pans[1].pan.value, 'копии должны быть в разных половинах');
  const gains = tones.map((t) => t.outs[0].dest);
  const level = bedLevel(scene, 1);
  for (const g of gains) {
    const set = g.gain.events.find((e) => e[0] === 'set');
    const ramp = g.gain.events.find((e) => e[0] === 'ramp');
    assert.ok(set && ramp, 'копия входит плавно, а не щелчком');
    assert.equal(set[1], 0);
    assert.ok(Math.abs(ramp[1] - level / 2) < 1e-6, `уровень копии ${ramp[1]} вместо ${level / 2}`);
    assert.ok(Math.abs(ramp[2] - set[2] - AIR_CROSSFADE) < 1e-6, 'вход копии длится ровно кроссфейд');
  }
  assert.equal(ctx.of('compressor').length, 1, 'на мастере стоит мягкий лимитер');
  engine.destroy();
});

await check('без записи играет запасной шум: ни тишины, ни ошибки', async () => {
  const engine = newEngine();          // loadBed падает
  engine.configure({ scene: 'forest', minutes: 10, texture: 1 });
  engine.start();
  await flush(); await flush();
  const ctx = lastCtx();
  const st = engine.state();
  assert.equal(st.air.source, 'noise', 'движок честно сказал, что воздух — шумовой');
  assert.equal(st.air.file, null);
  assert.equal(engine.playing, true, 'музыка не остановилась из-за ошибки загрузки');
  assert.equal(ctx.closed, false);
  const looping = ctx.of('buffer').filter((b) => b.loop && b.stoppedAt === undefined);
  assert.equal(looping.length, 1, 'звучит ровно один запасной слой');
  assert.ok(looping[0].buffer && looping[0].buffer.length > 0, 'шумовой буфер настоящий');
  advance(60000);
  assert.equal(engine.playing, true, 'через минуту музыка всё ещё идёт');
  engine.destroy();
});

await check('голос звучит: ноты мотива запланированы вперёд, по четыре частичных тона', () => {
  const engine = newEngine();
  engine.configure({ scene: 'sea', minutes: 30, voice: 1 });
  engine.start();
  const ctx = lastCtx();
  const st = engine.state();
  assert.ok(st.motif.length >= 3 && st.motif.length <= 5, 'мотив сессии из 3–5 шагов');
  assert.equal(st.motif[0], 0, 'мотив начинается с тоники');
  assert.ok(isChordTone(0, st.motif[st.motif.length - 1]), 'финал мотива устойчивый');
  /* экран не показывает ноты, которые ещё не звучат: план готов заранее,
     а блок «сейчас звучит» обязан говорить правду */
  assert.equal(st.phrase, null, 'до первой ноты экран честно не показывает мотив');
  /* тембр голоса — четыре частичных тона через lowpass 3,2 кГц */
  const tones = ctx.of('biquad').filter((b) => b.frequency.value === 3200);
  assert.ok(tones.length >= st.motif.length, `колокольчиков ${tones.length} при ${st.motif.length} нотах`);
  const partials = ctx.of('gain').filter((g) => g.outs.some((o) => tones.includes(o.dest)));
  assert.equal(partials.length, tones.length * 4, 'на каждую ноту четыре частичных тона');
  const t = ctx.currentTime;
  const ahead = ctx.of('osc').filter((o) => o.startedAt > t + 1);
  assert.ok(ahead.length >= 8, `нот вперёд запланировано ${ahead.length} — время считается по контексту, а не таймерами`);
  /* первая нота пришла — экран показывает мотив, и это весь мотив сессии */
  const scene = sceneById('sea');
  const voiceOscs = ctx.of('osc').filter((o) => o.outs.some((x) => partials.includes(x.dest)));
  const firstNote = Math.min(...voiceOscs.map((o) => o.startedAt));
  let live = null, shownAt = 0;
  for (let i = 0; i < 160 && !live; i++) {
    advance(250);   /* шаг мелкий: время публикации сравниваем со временем ноты */
    const s2 = engine.state();
    if (s2.phrase) { live = s2; shownAt = ctx.currentTime; }
  }
  assert.ok(live, 'за 40 секунд фраза обязана зазвучать и попасть на экран');
  assert.equal(live.phrase.notes.length, live.motif.length, 'фраза — это мотив сессии целиком');
  assert.ok(Math.abs(shownAt - firstNote) < 0.3,
    `мотив показан в ${shownAt.toFixed(2)} с при первой ноте в ${firstNote.toFixed(2)} с — экран обязан совпадать со звуком`);
  for (const n of live.phrase.notes) {
    assert.ok(n.hz >= noteHz(scene.melody.register[0]) - 0.1 && n.hz <= noteHz(scene.melody.register[1]) + 0.1,
      `нота ${n.name} = ${n.hz} Гц вне регистра голоса`);
  }
  /* отзвучала — ушла с экрана: иначе «сейчас звучит» превратится в архив */
  const shown = live.phrase;
  let gone = false;
  for (let i = 0; i < 120 && !gone; i++) { advance(1000); if (engine.state().phrase !== shown) gone = true; }
  assert.ok(gone, 'отзвучавшая фраза уходит с экрана (или сменяется следующей)');
  engine.destroy();
});

await check('стоп гасит и уже запланированные голоса', () => {
  const engine = newEngine();
  engine.configure({ scene: 'hearth', minutes: 60, voice: 1 });
  engine.start();
  const ctx = lastCtx();
  const tones = ctx.of('biquad').filter((b) => b.frequency.value === 3200);
  const partials = ctx.of('gain').filter((g) => g.outs.some((o) => tones.includes(o.dest)));
  const bells = ctx.of('gain').filter((g) => g.gain.events.some((e) => e[0] === 'target' && Math.abs(e[1] - 0.0001) < 1e-9));
  assert.ok(bells.length >= tones.length, 'у каждой ноты свой гейн с затуханием');
  const voiceOscs = ctx.of('osc').filter((o) => o.outs.some((x) => partials.includes(x.dest)));
  assert.ok(voiceOscs.length >= 12, `осцилляторов голоса ${voiceOscs.length}`);
  assert.ok(voiceOscs.some((o) => o.stoppedAt > ctx.currentTime + 5), 'часть нот запланирована далеко вперёд');
  const stopAt = ctx.currentTime;
  engine.stop();
  for (const g of bells) {
    const last = g.gain.events[g.gain.events.length - 1];
    assert.equal(last[0], 'ramp', 'гейн ноты гасится рампой, а не бросается');
    assert.ok(Math.abs(last[1] - 0.0001) < 1e-6, 'нота уходит в тишину');
    assert.ok(last[2] >= stopAt, 'гашение не задним числом');
  }
  assert.ok(voiceOscs.every((o) => o.stoppedAt !== undefined && o.stoppedAt <= stopAt + 1),
    'запланированные вперёд ноты остановлены');
  advance(1200);
  assert.equal(engine.playing, false);
  assert.equal(ctx.closed, true, 'контекст закрыт');
  engine.destroy();
});

await check('«Голос» на нуле — только полотно, на ходу возвращается со следующим аккордом', () => {
  const engine = newEngine();
  engine.configure({ scene: 'forest', minutes: 30, voice: 0 });
  engine.start();
  const ctx = lastCtx();
  assert.equal(engine.state().voice, 0);
  assert.equal(ctx.of('biquad').filter((b) => b.frequency.value === 3200).length, 0, 'голос выключен — нот нет вовсе');
  engine.configure({ voice: 1 });
  assert.equal(engine.state().voice, 1);
  const before = ctx.of('biquad').filter((b) => b.frequency.value === 3200).length;
  advance(sceneById('forest').pad.interval * 1000 + 10);
  const after = ctx.of('biquad').filter((b) => b.frequency.value === 3200).length;
  assert.ok(after > before, 'голос вернулся вместе со следующим аккордом');
  engine.destroy();
});

await check('живые акценты: колокольчики приходят редко и тихо', async () => {
  const loader = fakeLoader({ 'assets/ambience/sea.m4a': 38.5, 'assets/ambience/chimes.m4a': 7.5 });
  const engine = newEngine({ loadBed: loader.load, seed: 5 });
  engine.configure({ scene: 'sea', minutes: 0, texture: 1, voice: 1 });
  engine.start();
  await flush();
  const ctx = lastCtx();
  const accents = sceneById('sea').accents;
  const chimes = () => ctx.of('buffer').filter((b) => b.buffer && b.buffer.duration === 7.5);
  assert.equal(chimes().length, 0, 'в первые секунды акцента нет — музыка входит тихо');
  advance(accents.gap[0] * 1000 + 100);   // первый акцент — не позже обычного промежутка
  await flush();
  assert.equal(chimes().length, 1, 'первый акцент пришёл, пока полотно ещё входит');
  assert.ok(chimes()[0].startOffset >= 0 && chimes()[0].startOffset <= 7.5, 'вход внутри записи колокольчиков');
  const accentGain = ctx.of('gain').filter((g) => g.gain.events.some((e) => e[0] === 'ramp' && Math.abs(e[1] - accents.level) < 1e-9));
  assert.equal(accentGain.length, 1, 'акцент звучит на своём уровне');
  const env = accentGain[0].gain.events;
  assert.ok(env.some((e) => e[0] === 'ramp' && e[1] < 0.001), 'акцент уходит в тишину, а не обрывается');
  const first = chimes()[0];
  advance(accents.gap[1] * 1000 + 500);
  await flush();
  assert.ok(chimes().length >= 2, 'акценты повторяются — но каждый раз через случайный промежуток');
  /* акцент играет сам по себе: длина задана в start(), а узел убран из графа */
  assert.ok(first.startDuration > 5 && first.startDuration <= 20, `акцент звучит ${first.startDuration} с и не висит в графе`);
  assert.equal(first.disconnected, true, 'прозвучавший акцент отключён — узлы не копятся');
  engine.stop();
  advance(1200);
  assert.equal(engine.playing, false);
  engine.destroy();
});

await check('смена сцены на ходу: запись меняется кроссфейдом, музыка не прерывается', async () => {
  const loader = fakeLoader({ 'assets/ambience/sea.m4a': 38.5, 'assets/ambience/rain.m4a': 50 });
  const engine = newEngine({ loadBed: loader.load });
  engine.configure({ scene: 'sea', minutes: 60, texture: 1 });
  engine.start();
  await flush();
  const ctx = lastCtx();
  const seaBeds = ctx.of('buffer').filter((b) => b.buffer && b.buffer.duration === 38.5);
  assert.equal(seaBeds.length, 2, 'море играет двумя копиями');
  const at = ctx.currentTime;
  engine.configure({ scene: 'rain' });
  await flush();
  const st = engine.state();
  assert.equal(st.scene, 'rain');
  assert.equal(st.air.file, 'assets/ambience/rain.m4a', 'воздух стал дождём');
  assert.equal(ctx.closed, false, 'музыка не прервалась');
  assert.equal(engine.playing, true);
  for (const b of seaBeds) {
    assert.ok(b.stoppedAt !== undefined, 'старая запись гаснет, а не брошена звучать');
    const fade = b.stoppedAt - at;
    assert.ok(fade >= 1.5 && fade <= 2.6, `старая запись гаснет за ${fade.toFixed(2)} с — вне 1,5–2,5 с`);
  }
  assert.equal(ctx.of('buffer').filter((b) => b.buffer && b.buffer.duration === 50).length, 2, 'дождь играет двумя копиями');
  engine.destroy();
});

await check('следующая сцена подгружается в простое, а кэш делает переключение мгновенным', async () => {
  const loader = fakeLoader({ 'assets/ambience/sea.m4a': 38.5, 'assets/ambience/rain.m4a': 50 });
  const engine = newEngine({ loadBed: loader.load });
  engine.configure({ scene: 'sea', minutes: 30 });
  engine.start();
  await flush(); await flush();
  assert.equal(loader.asked[0], 'assets/ambience/sea.m4a', 'сначала запись текущей сцены');
  assert.ok(loader.asked.includes('assets/ambience/rain.m4a'), 'следующая по списку сцена подгружена заранее');
  const asked = loader.asked.length;
  engine.configure({ scene: 'rain' });
  await flush(); await flush();
  assert.ok(!loader.asked.slice(asked).includes('assets/ambience/rain.m4a'),
    'дождь взят из кэша — заново файл не качается, переключение мгновенное');
  assert.equal(engine.state().air.source, 'file');
  assert.equal(engine.state().air.file, 'assets/ambience/rain.m4a');
  assert.ok(loader.asked.length > asked, 'в простое подгружается уже следующая сцена');
  engine.destroy();
});

await check('голос не уводит музыку: ноты тише полотна и не плодят узлы без счёта', () => {
  const engine = newEngine();
  engine.configure({ scene: 'lullaby', minutes: 30, voice: 1, texture: 1 });
  engine.start();
  const ctx = lastCtx();
  const before = ctx.nodes.length;
  advance(sceneById('lullaby').pad.interval * 3 * 1000);
  const perChord = (ctx.nodes.length - before) / 3;
  assert.ok(perChord < 120, `на аккорд создано ${Math.round(perChord)} узлов — телефон такое не потянет`);
  const bells = ctx.of('biquad').filter((b) => b.frequency.value === 3200);
  assert.ok(bells.length >= 3, 'за три аккорда голос прозвучал не один раз');
  assert.ok(engine.playing, 'музыка идёт');
  engine.destroy();
});

console.log(`\nambient: ${checks} проверок пройдено`);
