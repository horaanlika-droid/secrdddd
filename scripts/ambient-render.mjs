#!/usr/bin/env node
/* ============================================================
   дибитишка · офлайн-рендер эмбиента в WAV
   ------------------------------------------------------------
   Запуск: node scripts/ambient-render.mjs                (две сцены по 40 с)
           node scripts/ambient-render.mjs --all          (все шесть сцен)
           node scripts/ambient-render.mjs --scene sea --seconds 60 --out море.wav
           node scripts/ambient-render.mjs --all --seconds 20 --rate 32000
                                              (лёгкие файлы для прослушивания)

   Зачем: музыку нельзя проверить моком — мок проверяет только граф.
   Этот скрипт запускает ТОТ ЖЕ движок (app/js/ambient.js) поверх
   собственного программного AudioContext: осцилляторы, громкости с
   автоматизацией, биквады, панорама, шум и свёрточное эхо считаются
   по-настоящему, сэмпл за сэмплом, и складываются в обычный WAV.
   Поэтому файл из test-results/ — это то же самое, что услышит
   человек в браузере (разница только в округлении фильтров).

   Скрипт заодно измеряет то, что ушами не измеришь: пик и RMS,
   энергии по полосам, постоянную составляющую, щелчки и клиппинг.
   Аудиоустройство и сеть не нужны.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AMBIENT_SCENES, sceneById, createAmbientEngine } from '../app/js/ambient.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'test-results', 'audio');
const SAMPLE_RATE = 48000;
const BLOCK = 512;            // кадров за раз: компромисс между точностью и скоростью
const TAU = Math.PI * 2;

/* ---------- программный Web Audio ---------- */

/** Автоматизация параметра: value, setValueAtTime, линейные рампы, setTargetAtTime. */
class SoftParam {
  constructor(value = 0) {
    this.base = value;
    this.events = [];
    this.modulators = [];      // узлы, подключённые прямо в параметр (LFO)
  }
  get value() { return this.lastValue === undefined ? this.base : this.lastValue; }
  set value(v) { this.base = v; this.lastValue = v; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.lastValue = v; return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); return this; }
  setTargetAtTime(v, t, tc) { this.events.push(['target', v, t, Math.max(1e-4, tc)]); return this; }
  cancelScheduledValues(t) { this.events = this.events.filter((e) => e[2] < t); return this; }

  /** Значение без модуляции — как его посчитал бы браузер. */
  scheduledAt(t) {
    let value = this.base;
    let prevT = -Infinity;
    let prevV = value;
    for (const e of this.events) {
      const [kind, v, time, tc] = e;
      if (time > t) {
        if (kind === 'ramp') {
          const span = time - prevT;
          return span > 0 ? prevV + (v - prevV) * ((t - prevT) / span) : v;
        }
        break;
      }
      if (kind === 'set') { value = v; prevV = v; prevT = time; }
      else if (kind === 'ramp') { value = v; prevV = v; prevT = time; }
      else if (kind === 'target') {
        value = v + (prevV - v) * Math.exp(-(t - time) / tc);
        prevV = value; prevT = time;
      }
    }
    this.lastValue = value;
    return value;
  }

  /** Значение со сложенными LFO: именно так параметр видит браузер. */
  at(t) {
    let v = this.scheduledAt(t);
    for (const m of this.modulators) v += m.sampleAt(t);
    return v;
  }
}

class SoftNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.inputs = [];
    this.outs = [];
    this.outL = null;
    this.outR = null;
    this.silent = false;
  }
  connect(dest) {
    this.outs.push(dest);
    if (dest instanceof SoftParam) dest.modulators.push(this);
    else if (!dest.inputs.includes(this)) dest.inputs.push(this);
    return dest;
  }
  disconnect() { this.outs = []; this.inputs = []; }
  /** Чем этот узел является для параметра: LFO или тишиной. */
  sampleAt() { return 0; }
  sumInputs(frames) {
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    for (const src of this.inputs) {
      if (!src.outL) continue;
      for (let i = 0; i < frames; i++) { L[i] += src.outL[i]; R[i] += src.outR[i]; }
    }
    return [L, R];
  }
  /** По умолчанию узел просто пропускает сумму входов (нужно для destination). */
  process(frames) {
    const [L, R] = this.sumInputs(frames);
    this.outL = L; this.outR = R;
    return this;
  }
}

class SoftGain extends SoftNode {
  constructor(ctx) { super(ctx, 'gain'); this.gain = new SoftParam(1); }
  sampleAt(t) {
    /* для модуляции важен только LFO через гейн: вход — осциллятор */
    const osc = this.inputs.find((n) => n.kind === 'osc');
    return osc ? this.gain.at(t) * osc.sampleAt(t) : 0;
  }
  process(frames, start) {
    const [L, R] = this.sumInputs(frames);
    const g = this.gain.at(start / this.ctx.sampleRate);
    this.outL = L; this.outR = R;
    if (g !== 1) for (let i = 0; i < frames; i++) { L[i] *= g; R[i] *= g; }
    return this;
  }
}

class SoftOsc extends SoftNode {
  constructor(ctx) {
    super(ctx, 'osc');
    this.type = 'sine';
    this.frequency = new SoftParam(440);
    this.detune = new SoftParam(0);
    this.phase = 0;
    this.startedAt = Infinity;
    this.stoppedAt = Infinity;
  }
  /** Аналитически — для LFO (их частота не меняется). */
  sampleAt(t) {
    if (t < this.startedAt || t >= this.stoppedAt) return 0;
    const f = this.frequency.at(t) * Math.pow(2, this.detune.at(t) / 1200);
    const x = (this.phase + TAU * f * (t - this.startedAt)) % TAU;
    if (this.type === 'triangle') return 2 * Math.abs(2 * (x / TAU - Math.floor(x / TAU + 0.5))) - 1;
    return Math.sin(x);
  }
  start(t = this.ctx.currentTime) { this.startedAt = t; return this; }
  stop(t = Infinity) { this.stoppedAt = t; return this; }
  process(frames, start) {
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    const rate = this.ctx.sampleRate;
    for (let i = 0; i < frames; i++) {
      const t = (start + i) / rate;
      let sample = 0;
      if (t >= this.startedAt && t < this.stoppedAt) {
        const f = this.frequency.at(t) * Math.pow(2, this.detune.at(t) / 1200);
        this.phase = (this.phase + (TAU * f) / rate) % TAU;
        sample = this.type === 'triangle'
          ? 2 * Math.abs(2 * (this.phase / TAU - Math.floor(this.phase / TAU + 0.5))) - 1
          : Math.sin(this.phase);
      }
      L[i] = sample; R[i] = sample;
    }
    this.outL = L; this.outR = R;
    return this;
  }
}

class SoftBufferSource extends SoftNode {
  constructor(ctx) {
    super(ctx, 'buffer');
    this.buffer = null;
    this.loop = false;
    this.playhead = 0;
    this.startedAt = Infinity;
    this.stoppedAt = Infinity;
  }
  start(t = this.ctx.currentTime) { this.startedAt = t; return this; }
  stop(t = Infinity) { this.stoppedAt = t; return this; }
  process(frames, start) {
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    const rate = this.ctx.sampleRate;
    const src = this.buffer && this.buffer.getChannelData(0);
    if (src) {
      for (let i = 0; i < frames; i++) {
        const t = (start + i) / rate;
        if (t < this.startedAt || t >= this.stoppedAt) continue;
        let idx = Math.floor(this.playhead);
        if (idx >= src.length) {
          if (!this.loop) break;
          idx = idx % src.length;
        }
        const s = src[idx];
        L[i] = s; R[i] = s;
        this.playhead += 1;
      }
    }
    this.outL = L; this.outR = R;
    return this;
  }
}

/** Биквад по формулам RBJ: те же коэффициенты, что считает браузер. */
class SoftBiquad extends SoftNode {
  constructor(ctx) {
    super(ctx, 'biquad');
    this.type = 'lowpass';
    this.frequency = new SoftParam(350);
    this.Q = new SoftParam(1);
    this.state = [{ x1: 0, x2: 0, y1: 0, y2: 0 }, { x1: 0, x2: 0, y1: 0, y2: 0 }];
  }
  coeffs(t) {
    const f = Math.min(this.ctx.sampleRate * 0.45, Math.max(10, this.frequency.at(t)));
    const q = Math.max(0.05, this.Q.at(t));
    const w0 = (TAU * f) / this.ctx.sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    let b0, b1, b2;
    if (this.type === 'highpass') {
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0;
    } else if (this.type === 'bandpass') {
      b0 = alpha; b1 = 0; b2 = -alpha;
    } else {
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0;
    }
    const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  process(frames, start) {
    const [inL, inR] = this.sumInputs(frames);
    const outL = new Float32Array(frames);
    const outR = new Float32Array(frames);
    const rate = this.ctx.sampleRate;
    for (let i = 0; i < frames; i++) {
      const [b0, b1, b2, a1, a2] = this.coeffs((start + i) / rate);
      for (const [ch, src, dst] of [[0, inL, outL], [1, inR, outR]]) {
        const s = this.state[ch];
        const x = src[i];
        const y = b0 * x + b1 * s.x1 + b2 * s.x2 - a1 * s.y1 - a2 * s.y2;
        s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y;
        dst[i] = y;
      }
    }
    this.outL = outL; this.outR = outR;
    return this;
  }
}

class SoftPanner extends SoftNode {
  constructor(ctx) { super(ctx, 'panner'); this.pan = new SoftParam(0); }
  process(frames, start) {
    const [inL] = this.sumInputs(frames);
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    const rate = this.ctx.sampleRate;
    for (let i = 0; i < frames; i++) {
      const p = Math.max(-1, Math.min(1, this.pan.at((start + i) / rate)));
      const x = (p + 1) / 2;
      L[i] = inL[i] * Math.cos((x * Math.PI) / 2);
      R[i] = inL[i] * Math.sin((x * Math.PI) / 2);
    }
    this.outL = L; this.outR = R;
    return this;
  }
}

/** Свёрточное эхо. Считается не сразу: сначала копим посыл, потом сворачиваем. */
class SoftConvolver extends SoftNode {
  constructor(ctx) { super(ctx, 'convolver'); this.buffer = null; this.normalize = true; this.capture = null; this.precomputed = null; }
  process(frames, start) {
    const [inL, inR] = this.sumInputs(frames);
    if (this.capture) {
      for (let i = 0; i < frames; i++) {
        this.capture[0][start + i] = inL[i];
        this.capture[1][start + i] = inR[i];
      }
    }
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    if (this.precomputed) {
      for (let i = 0; i < frames; i++) {
        L[i] = this.precomputed[0][start + i] || 0;
        R[i] = this.precomputed[1][start + i] || 0;
      }
    }
    this.outL = L; this.outR = R;
    return this;
  }
}

class SoftAudioContext {
  constructor(sampleRate = SAMPLE_RATE) {
    this.sampleRate = sampleRate;
    this.state = 'running';
    this.nodes = [];
    this.destination = new SoftNode(this, 'destination');
    this.destination.inputs = [];
    this.sample = 0;
  }
  get currentTime() { return this.sample / this.sampleRate; }
  _reg(node) { this.nodes.push(node); return node; }
  createGain() { return this._reg(new SoftGain(this)); }
  createOscillator() { return this._reg(new SoftOsc(this)); }
  createBufferSource() { return this._reg(new SoftBufferSource(this)); }
  createBiquadFilter() { return this._reg(new SoftBiquad(this)); }
  createStereoPanner() { return this._reg(new SoftPanner(this)); }
  createConvolver() { return this._reg(new SoftConvolver(this)); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (ch = 0) => data[ch] };
  }
  suspend() { this.state = 'suspended'; }
  resume() { this.state = 'running'; }
  close() { this.state = 'closed'; }

  /** Порядок обхода: сверху вниз от выхода. Граф без обратных связей — это корректно. */
  order() {
    const seen = new Set();
    const out = [];
    const visit = (node) => {
      if (seen.has(node)) return;
      seen.add(node);
      for (const src of node.inputs) visit(src);
      out.push(node);
    };
    visit(this.destination);
    return out;
  }

  /** Один блок: считаем все узлы по порядку и складываем в выход. */
  renderBlock(frames) {
    const order = this.order();
    for (const node of order) node.process(frames, this.sample);
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    for (const src of this.destination.inputs) {
      for (let i = 0; i < frames; i++) { L[i] += src.outL[i]; R[i] += src.outR[i]; }
    }
    this.mix[0].set(L, this.sample);
    this.mix[1].set(R, this.sample);
    this.sample += frames;
  }
}

/* ---------- быстрая свёртка (FFT, overlap-add не нужен: считаем целиком) ---------- */
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

function convolve(signal, ir) {
  const n = nextPow2(signal.length + ir.length);
  const ar = new Float64Array(n), ai = new Float64Array(n);
  const br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(signal); br.set(ir);
  fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) {
    const rr = ar[i] * br[i] - ai[i] * bi[i];
    const ii = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = rr; ai[i] = ii;
  }
  fft(ar, ai, true);
  return ar.subarray(0, signal.length);
}

/* ---------- виртуальные часы ----------
   Часы идут не по реальному времени, а по отрендеренным сэмплам:
   отсчёт в сэмплах = отсчёт в секундах, и аккорд меняется ровно там,
   где он менялся бы в браузере. О том, какой сейчас контекст, часы
   спрашивают через getContext(): движок создаёт его сам. */
function makeClock(getContext) {
  const timers = new Map();
  let id = 0;
  return {
    get ctx() { return getContext(); },
    setTimeout(fn, ms) {
      const ctx = getContext();
      const key = ++id;
      timers.set(key, { at: ctx.sample / ctx.sampleRate + (Number(ms) || 0) / 1000, fn });
      return key;
    },
    clearTimeout(key) { timers.delete(key); },
    now() { return (getContext().sample / getContext().sampleRate) * 1000; },
    fireDue() {
      for (;;) {
        let next = null;
        const t = getContext().currentTime;
        for (const [key, timer] of timers) if (timer.at <= t && (!next || timer.at < next[1].at)) next = [key, timer];
        if (!next) break;
        timers.delete(next[0]);
        next[1].fn();
      }
    }
  };
}

/* ---------- один прогон движка ---------- */
function renderPass({ scene, seed, seconds, volume, minutes, texture, reverb, wet, rate }) {
  /* Движок создаёт контекст сам — поэтому перехватываем его здесь. */
  let ctx = null;
  class RenderContext extends SoftAudioContext {
    constructor() { super(rate); ctx = this; }
  }
  const clock = makeClock(() => ctx);
  const engine = createAmbientEngine({
    AudioContext: RenderContext,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    seed
  });

  engine.configure({ scene, volume, minutes, texture, reverb });
  engine.start() || null;
  const total = Math.round(seconds * ctx.sampleRate);
  ctx.mix = [new Float32Array(total), new Float32Array(total)];

  /* Свёртку считаем отдельным проходом: сначала копим посыл, потом
     подставляем готовый мокрый сигнал — как это делает браузер. */
  let send = null;
  let ir = null;
  const conv = ctx.nodes.find((n) => n.kind === 'convolver');
  if (conv) {
    ir = conv.buffer;
    if (wet) {
      conv.precomputed = wet;
    } else {
      conv.capture = [new Float32Array(total), new Float32Array(total)];
      send = conv.capture;
    }
  }

  let steps = 0;
  while (ctx.sample < total) {
    clock.fireDue();
    ctx.renderBlock(Math.min(BLOCK, total - ctx.sample));
    steps++;
  }
  return { ctx, mix: ctx.mix, send, ir, engine, steps };
}

/** Полный рендер сцены: два прохода + свёртка. */
function renderScene({ sceneId, seconds, seed, volume, minutes, texture, reverb, rate }) {
  const scene = sceneById(sceneId);
  const first = renderPass({ scene: sceneId, seed, seconds, volume, minutes, texture, reverb, wet: null, rate });
  const dry = first.mix;
  let out = dry;
  if (first.send && first.ir) {
    const W = [
      convolve(first.send[0], first.ir.getChannelData(0)),
      convolve(first.send[1], first.ir.getChannelData(1))
    ];
    const second = renderPass({ scene: sceneId, seed, seconds, volume, minutes, texture, reverb, wet: W, rate });
    out = second.mix;
  }
  return {
    scene,
    left: out[0],
    right: out[1],
    dry,
    stats: measure(out[0], out[1], rate),
    dryStats: measure(dry[0], dry[1], rate),
    engine: first.engine
  };
}

/* ---------- измерения ---------- */
function measure(L, R, rate) {
  let peak = 0, sumSq = 0, dc = 0, maxJump = 0;
  const bands = { low: 0, mid: 0, high: 0 };
  /* полосы считаем грубо: через одно-полюсные фильтры (этого достаточно,
     чтобы увидеть, что сцена не превратилась в один бас или один шип) */
  let lp = 0, bp = 0;
  const a1 = Math.exp((-TAU * 250) / rate);
  const a2 = Math.exp((-TAU * 2000) / rate);
  for (let i = 0; i < L.length; i++) {
    const s = (L[i] + R[i]) / 2;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    sumSq += s * s;
    dc += s;
    lp = lp * a1 + s * (1 - a1);
    bp = bp * a2 + s * (1 - a2);
    const mid = bp - lp;
    bands.low += lp * lp;
    bands.mid += mid * mid;
    bands.high += (s - bp) * (s - bp);
    if (i > 0) maxJump = Math.max(maxJump, Math.abs(L[i] - L[i - 1]));
  }
  const total = bands.low + bands.mid + bands.high || 1;
  return {
    peak: Math.round(peak * 10000) / 10000,
    rms: Math.sqrt(sumSq / L.length),
    db: Math.round(20 * Math.log10(Math.sqrt(sumSq / L.length) + 1e-12) * 10) / 10,
    dc: dc / L.length,
    maxJump,
    bands: {
      low: Math.round((bands.low / total) * 100),
      mid: Math.round((bands.mid / total) * 100),
      high: Math.round((bands.high / total) * 100)
    }
  };
}

/* ---------- WAV ---------- */
function writeWav(file, L, R, rate = SAMPLE_RATE) {
  const frames = L.length;
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + frames * 4, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 4, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (const ch of [L, R]) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      buffer.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  fs.writeFileSync(file, buffer);
  return buffer.length;
}

/* ---------- запуск ---------- */
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const number = (name, fallback) => {
  const v = Number(flag(name, fallback));
  return Number.isFinite(v) ? v : fallback;
};

const seconds = number('seconds', 40);
const volume = number('volume', 0.85);   // в предпросмотре громче: слушать будем спокойно
const minutes = number('minutes', 30);
const seed = number('seed', 2026);
const texture = number('texture', 1);
const rate = number('rate', SAMPLE_RATE);   // 32000 — файлы в три раза легче для прослушивания
const reverb = flag('reverb', '1') !== '0';
const only = flag('scene', null);
const all = args.includes('--all');
const scenes = all ? AMBIENT_SCENES.map((s) => s.id)
  : only ? [sceneById(only).id]
    : ['sea', 'rain'];
const outName = flag('out', null);

if (!scenes.length) { console.error('неизвестная сцена. Есть: ' + AMBIENT_SCENES.map((s) => s.id).join(', ')); process.exit(1); }
if (outName && scenes.length > 1) { console.error('--out имеет смысл только для одной сцены'); process.exit(1); }

fs.mkdirSync(OUT_DIR, { recursive: true });
const results = [];
for (const id of scenes) {
  const t0 = Date.now();
  const r = renderScene({ sceneId: id, seconds, seed, volume, minutes, texture, reverb, rate });
  const file = path.join(OUT_DIR, outName || `${id}.wav`);
  const bytes = writeWav(file, r.left, r.right, rate);
  const st = r.stats;
  const dry = r.dryStats;
  results.push({ id, title: r.scene.title, file, bytes, st, dry, ms: Date.now() - t0 });
  console.log(`\n${r.scene.title} (${id}) — ${seconds} с, ${(bytes / 1048576).toFixed(1)} МБ, рендер ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  console.log(`  пик ${st.peak} · RMS ${st.db} dBFS · DC ${st.dc.toFixed(5)} · макс. скачок ${st.maxJump.toFixed(4)}`);
  console.log(`  полосы: низ ${st.bands.low}% · середина ${st.bands.mid}% · верх ${st.bands.high}% (без эха: низ ${dry.bands.low}% · середина ${dry.bands.mid}% · верх ${dry.bands.high}%)`);
  if (st.peak >= 0.999) console.log('  ⚠ клиппинг');
  if (st.dc > 0.002) console.log('  ⚠ постоянное смещение');
  /* скачок между соседними сэмплами: у шумовых слоёв он большой сам по себе,
     а вот 0,25 и выше — это уже разрыв, то есть щелчок */
  if (st.maxJump > 0.25) console.log('  ⚠ разрыв в сигнале — похоже на щелчок');
}

/* сводка: сцены должны отличаться друг от друга, а пик — не упираться в 1 */
if (results.length > 1) {
  console.log('\nсводка');
  for (const r of results) {
    console.log(`  ${r.id.padEnd(8)} пик ${String(r.st.peak).padEnd(6)} RMS ${String(r.st.db).padStart(6)} dB  низ/сер/верх ${r.st.bands.low}/${r.st.bands.mid}/${r.st.bands.high}`);
  }
  const diff = results.some((r, i) => i > 0 && Math.abs(r.st.db - results[0].st.db) > 0.5);
  console.log(`  сцены ${diff ? 'отличаются' : '⚠ звучат одинаково по громкости — проверь данные'}`);
}
console.log(`\nфайлы: ${OUT_DIR}`);
