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
import {
  AMBIENT_SCENES, sceneById, noteHz, noteName, foldIntoRange, chordPlan, chordVoices,
  sceneBudget, normalizeVolume, normalizeTexture, formatClock, audioSupported, isInfinite,
  DURATIONS, makeRng, noiseBuffer, impulseResponse, createAmbientEngine
} from '../app/js/ambient.js';

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
    n.buffer = null; n.loop = false;
    n.start = (t) => { n.startedAt = t; }; n.stop = (t) => { n.stoppedAt = t === undefined ? 0 : t; };
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

const newEngine = (opts = {}) => {
  resetClock();
  contexts.length = 0;
  return createAmbientEngine({
    AudioContext: MockAudioContext,
    setTimeout: fSetTimeout,
    clearTimeout: fClearTimeout,
    now: () => vtime,
    seed: 42,
    ...opts
  });
};
const lastCtx = () => contexts[contexts.length - 1];

/* ---------- ноты и регистр ---------- */
check('нота считается из MIDI: A4 = 440 Гц, имя — с октавой', () => {
  assert.equal(noteHz(69), 440);
  assert.equal(Math.round(noteHz(60) * 100) / 100, 261.63);
  assert.equal(noteName(69), 'A4');
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(45), 'A2');
});

check('складывание ноты: слишком высокое опускается, слишком низкое поднимается', () => {
  assert.equal(noteHz(foldIntoRange(96, 150, 560)) <= 560, true);
  assert.equal(noteHz(foldIntoRange(30, 150, 560)) >= 150, true);
  assert.equal(foldIntoRange(60, 150, 560), 60, 'нота в регистре не двигается');
});

check('все сцены: уникальные id, шаги подписаны, регистр шире октавы', () => {
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

check('полотно каждой сцены лежит в слышимом регистре 110–640 Гц', () => {
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
check('все сцены медленные: аккорд держится не меньше 40 секунд', () => {
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

check('у каждой сцены есть слой воздуха и хотя бы одна его ветка', () => {
  for (const s of AMBIENT_SCENES) {
    assert.ok(s.texture.level > 0, `${s.id}: слоя воздуха нет вовсе`);
    assert.ok(Array.isArray(s.texture.paths) && s.texture.paths.length >= 1, `${s.id}: ветки слоя не описаны`);
    for (const path of s.texture.paths) {
      assert.ok(path.level === undefined || (path.level > 0 && path.level <= 1), `${s.id}: уровень ветки вне 0..1`);
      assert.ok(path.filters && path.filters.length >= 1, `${s.id}: ветка без фильтра — это просто белый шум`);
    }
  }
});

check('сумма уровней сцены оставляет запас до клиппинга', () => {
  for (const s of AMBIENT_SCENES) {
    const budget = sceneBudget(s);
    assert.ok(budget > 0.2 && budget < 0.62, `${s.id}: пик ${budget} — либо неслышно, либо на грани клиппинга`);
  }
});

check('план аккордов: не повторяется подряд и всегда из своей сцены', () => {
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

check('с одним seed музыка повторяема, с разными — разная', () => {
  const a = chordPlan(sceneById('sea'), makeRng(2024), 24).join(',');
  const b = chordPlan(sceneById('sea'), makeRng(2024), 24).join(',');
  const c = chordPlan(sceneById('sea'), makeRng(2025), 24).join(',');
  assert.equal(a, b, 'один seed — один и тот же порядок аккордов');
  assert.notEqual(a, c, 'разные seed — разная музыка');
});

check('у колыбельной полотно заметно ниже, чем у космоса', () => {
  const mean = (notes) => notes.reduce((sum, n) => sum + n.hz, 0) / notes.length;
  const low = mean(chordVoices(sceneById('lullaby'), 0).notes);
  const high = mean(chordVoices(sceneById('space'), 0).notes);
  assert.ok(low < high * 0.6, `колыбельная ${Math.round(low)} Гц против космоса ${Math.round(high)} Гц — регистры сцен должны различаться на слух`);
});

/* ---------- мелкие утилиты ---------- */
check('громкость и «воздух» не выходят за 0..1', () => {
  assert.equal(normalizeVolume(2), 1);
  assert.equal(normalizeVolume(-3), 0);
  assert.equal(normalizeVolume('тихо'), 0);
  assert.equal(normalizeTexture(0.4), 0.4);
});

check('«без конца» — это 0 минут, а не ошибка', () => {
  assert.ok(DURATIONS.includes(0), 'в списке длительностей есть бесконечная');
  assert.equal(isInfinite(0), true);
  assert.equal(isInfinite(30), false);
  assert.equal(isInfinite(''), true);
});

check('таймер показывает минуты и секунды', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(-5), '0:00');
});

check('поддержка Web Audio определяется по окружению', () => {
  assert.equal(audioSupported({}), false);
  assert.equal(audioSupported({ AudioContext: MockAudioContext }), true);
});

/* ---------- шум и эхо ---------- */
check('буфер шума зацикливается без щелчка на шве', () => {
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

check('импульс для эха: две дорожки, предзадержка, единичная энергия', () => {
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
check('старт собирает полотно, бас, воздух и эхо', () => {
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

check('музыка появляется плавно, а не щелчком', () => {
  const engine = newEngine();
  engine.configure({ scene: 'sea', volume: 0.42 });
  engine.start();
  const events = lastCtx().one('gain').gain.events;
  assert.deepEqual(events[0].slice(0, 2), ['set', 0]);
  assert.deepEqual(events[1].slice(0, 2), ['ramp', 0.42]);
  assert.ok(events[1][2] > events[0][2], 'нарастание идёт позже начала');
  engine.destroy();
});

check('аккорды сменяют друг друга сами и не повторяются подряд', () => {
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

check('вход нового аккорда длится десятки секунд, а не секунду', () => {
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

check('смена сцены на ходу: полотно живёт, воздух меняется', () => {
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

check('«Воздух» и «Пространство» управляют слоями', () => {
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

check('пауза замораживает отсчёт, продолжение — отпускает', () => {
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

check('таймер доигрывает сессию и гасит звук', () => {
  const engine = newEngine();
  engine.configure({ scene: 'lullaby', minutes: 10 });
  engine.start();
  const ctx = lastCtx();
  advance(10 * 60000);
  assert.equal(engine.playing, false, 'после таймера музыки нет');
  assert.equal(ctx.closed, true, 'контекст закрыт — батарея не тратится');
  engine.destroy();
});

check('«без конца» не ставит таймер и играет, пока не остановишь', () => {
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

check('стоп гасит музыку и оставляет выбор человека', () => {
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

check('быстрый перезапуск: старое затухание не убивает новую музыку', () => {
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

check('подписка сообщает о состоянии, отписка — перестаёт', () => {
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

check('без Web Audio старт честно падает, а не молчит', () => {
  resetClock();
  const engine = createAmbientEngine({ AudioContext: null, setTimeout: fSetTimeout, clearTimeout: fClearTimeout, now: () => vtime });
  assert.throws(() => engine.start(), /unsupported/);
  assert.equal(engine.playing, false);
});

check('минуты и громкость не ломают настройки', () => {
  const engine = newEngine();
  engine.configure({ minutes: 9999, volume: 5, texture: -1 });
  const st = engine.state();
  assert.equal(st.minutes, 240);
  assert.equal(st.volume, 1);
  assert.equal(st.texture, 0);
  assert.equal(isInfinite(st.minutes), false);
  engine.destroy();
});

console.log(`\nambient: ${checks} проверок пройдено`);
