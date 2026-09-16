/* ============================================================
   Дибитишка · генеративная эмбиент-музыка (Web Audio)
   ------------------------------------------------------------
   Это не трек и не стриминг, а маленький генератор внутри
   приложения: он собирает музыку из нескольких тёплых тонов прямо
   на устройстве. Схема ровно та же, по которой пишут эмбиент руками:

     1. Ноты. Частота считается из номера MIDI-ноты (A4 = 69 = 440 Гц),
        поэтому «ля малой октавы» — это просто число, а не файл.
     2. Аккорд. Сцена задаёт тональность (корень) и набор шагов —
        септаккорды и нонаккорды без напряжённых терций-доминант.
        Каждый шаг разворачивается в 4–6 голосов, которые расходятся
        по стерео и слегка расстраиваются: два генератора на голос
        дают мягкое биение вместо синтетической «пилы».
     3. Время. Аккорд входит очень медленно (10–30 с) и уходит ещё
        медленнее, поэтому полотна накладываются друг на друга и
        тишины между ними не бывает. Порядок аккордов выбирается
        случайно, но всегда из одной тональности — музыка никогда не
        повторяется и не бывает фальшивой (см. chordPlan).
     4. Воздух. Поверх полотна звучит слой сцены: волны, дождь, ветер,
        тёплый треск — это шум, окрашенный фильтром, который медленно
        дышит. Ни ударов, ни ритма: самый быстрый цикл здесь длиннее
        девяти секунд, поэтому музыка остаётся полотном.
     5. Пространство. Свёрточное эхо на сгенерированном импульсе
        (шум с затуханием, нормированный по энергии) размывает края.

   Отсюда три следствия, на которых держится модуль: ноль мегабайт
   ассетов, работа офлайн и полная независимость от лицензий и
   региональных блокировок стримингов.

   Модуль нарочно не знает про DOM: музыкальная математика — чистые
   функции, а движок получает AudioContext снаружи (в браузере —
   window.AudioContext, в тестах — подставной, в scripts/ambient-render.mjs
   — свой офлайн-рендерер). Поэтому музыку можно проверить без звука:
   npm run ambient-test.
   ============================================================ */

/* ---------- ноты ---------- */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const A4_MIDI = 69;
export const A4_HZ = 440;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round1 = (v) => Math.round(v * 10) / 10;
const mod = (n, m) => ((n % m) + m) % m;

/** Частота ноты по её номеру: A4 (69) = 440 Гц. */
export const noteHz = (midi) => A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);

/** Имя ноты с октавой: 60 → «C4», 45 → «A2». */
export const noteName = (midi) => NOTE_NAMES[mod(midi, 12)] + (Math.floor(midi / 12) - 1);

/**
 * Складывает ноту в слышимый регистр полотна: слишком высокие опускает
 * на октаву, слишком низкие поднимает. Диапазон всегда шире октавы
 * (иначе складывать некуда) — это проверяет ambient-test.
 */
export function foldIntoRange(midi, low, high) {
  let m = Math.round(midi);
  for (let i = 0; i < 12 && noteHz(m) > high; i++) m -= 12;
  for (let i = 0; i < 12 && noteHz(m) < low; i++) m += 12;
  return m;
}

/* ---------- сцены ----------
   Каждая сцена — это тональность, набор аккордов, характер полотна,
   слой воздуха и размер эха. Регистр полотна держится в 110–560 Гц:
   ниже — уже бас, выше — уже «стекло».

   pad.interval  — сколько секунд держится аккорд до следующего
   pad.attack    — за сколько он входит (голоса входят не вместе: stagger)
   pad.release   — за сколько уходит
   pad.octave    — на сколько октав поднять аккорд от баса (по умолчанию 12):
                   так у колыбельной полотно ложится ниже, чем у космоса
   Правило: attack + release ≤ interval. Иначе аккорды наезжают друг на
   друга так плотно, что фильтр и батарея работают впустую, — проверяет
   ambient-test.
   pad.detune    — расстройка двух генераторов одного голоса, в центах */

export const AMBIENT_SCENES = [
  {
    id: 'sea',
    title: 'Ночное море',
    tag: 'волны',
    when: 'вечером или когда не спится',
    text: 'Низкие полотна и очень медленные волны. Самая «дышащая» сцена: если не знаешь, что выбрать — начни с неё.',
    root: 45,                       // A2
    pad: { type: 'sine', level: 0.26, register: [150, 560], cutoff: 620, q: 0.7, sweep: 190, sweepSec: 61,
      detune: 7, width: 0.8, interval: 58, attack: 18, release: 26, stagger: 5, driftSec: 43 },
    bass: { level: 0.13, sub: 0.45, glide: 7, cutoff: 240 },
    texture: {
      kind: 'brown', level: 0.11,
      paths: [
        { level: 1, filters: [{ type: 'lowpass', frequency: 400, q: 0.8 }],
          swells: [{ seconds: 19, depth: 0.55 }, { seconds: 11.5, depth: 0.3 }] },
        { level: 0.22, filters: [{ type: 'bandpass', frequency: 1500, q: 0.6 }],
          swells: [{ seconds: 23, depth: 0.7 }, { seconds: 14, depth: 0.35 }] }
      ]
    },
    reverb: { seconds: 4.6, wet: 0.62 },
    steps: [
      { label: 'Am9', offset: 0, notes: [0, 3, 7, 10, 14] },
      { label: 'Fmaj9', offset: -4, notes: [0, 4, 7, 11, 14] },
      { label: 'Cmaj9', offset: 3, notes: [0, 4, 7, 11, 14] },
      { label: 'G6/9', offset: -2, notes: [0, 4, 7, 9, 14] }
    ]
  },
  {
    id: 'rain',
    title: 'Дождь на стекле',
    tag: 'дождь',
    when: 'днём, за работой или с книгой',
    text: 'Тёплое полотно в ре-миноре и ровный дождь за окном. За ним удобно что-то делать: он занимает слух, но не тянет внимание.',
    root: 38,                       // D2
    pad: { type: 'sine', level: 0.24, register: [150, 520], cutoff: 700, q: 0.6, sweep: 150, sweepSec: 47,
      detune: 6, width: 0.7, interval: 50, attack: 15, release: 22, stagger: 4, driftSec: 37 },
    bass: { level: 0.12, sub: 0.5, glide: 6, cutoff: 230 },
    texture: {
      kind: 'white', level: 0.10,
      paths: [
        { level: 1, filters: [{ type: 'highpass', frequency: 900, q: 0.5 }, { type: 'lowpass', frequency: 7000, q: 0.4 }],
          swells: [{ seconds: 13, depth: 0.16 }] },
        { level: 0.3, filters: [{ type: 'bandpass', frequency: 2300, q: 1.4 }],
          swells: [{ seconds: 11, depth: 0.5 }] }
      ]
    },
    reverb: { seconds: 3.2, wet: 0.42 },
    steps: [
      { label: 'Dm9', offset: 0, notes: [0, 3, 7, 10, 14] },
      { label: 'Bbmaj9', offset: -4, notes: [0, 4, 7, 11, 14] },
      { label: 'Fmaj9', offset: 3, notes: [0, 4, 7, 11, 14] },
      { label: 'C6/9', offset: -2, notes: [0, 4, 7, 9, 14] }
    ]
  },
  {
    id: 'hearth',
    title: 'У очага',
    tag: 'тёплый треск',
    when: 'вечером, когда хочется тепла',
    text: 'Мажорные полотна пониже и мягкий шум огня. Самая «домашняя» сцена — её приятно ставить тихо, почти на границе слышимости.',
    root: 36,                       // C2
    pad: { type: 'triangle', level: 0.25, register: [140, 460], cutoff: 540, q: 0.8, sweep: 160, sweepSec: 53,
      detune: 8, width: 0.75, interval: 54, attack: 17, release: 24, stagger: 5, driftSec: 41 },
    bass: { level: 0.14, sub: 0.55, glide: 8, cutoff: 210 },
    texture: {
      kind: 'brown', level: 0.12,
      paths: [
        { level: 1, filters: [{ type: 'lowpass', frequency: 260, q: 1 }],
          swells: [{ seconds: 17, depth: 0.5 }, { seconds: 9.5, depth: 0.26 }] },
        { level: 0.32, filters: [{ type: 'bandpass', frequency: 900, q: 1.2 }],
          swells: [{ seconds: 13, depth: 0.55 }] }
      ]
    },
    reverb: { seconds: 3.6, wet: 0.5 },
    steps: [
      { label: 'Cmaj9', offset: 0, notes: [0, 4, 7, 11, 14] },
      { label: 'Am9', offset: 9, notes: [0, 3, 7, 10, 14] },
      { label: 'Fmaj9', offset: 5, notes: [0, 4, 7, 11, 14] },
      { label: 'G6/9', offset: 7, notes: [0, 4, 7, 9, 14] }
    ]
  },
  {
    id: 'forest',
    title: 'Утро в лесу',
    tag: 'ветер',
    when: 'утром, когда нужна ясная голова',
    text: 'Светлые полотна и ветер в листве. Единственная сцена, которую можно слушать днём на работе: она бодрит ровно настолько, чтобы не уснуть.',
    root: 40,                       // E2
    pad: { type: 'sine', level: 0.23, register: [170, 600], cutoff: 1150, q: 0.5, sweep: 420, sweepSec: 71,
      detune: 5, width: 0.9, interval: 46, attack: 13, release: 20, stagger: 4, driftSec: 33 },
    bass: { level: 0.1, sub: 0.4, glide: 6, cutoff: 260 },
    texture: {
      kind: 'pink', level: 0.09,
      paths: [
        { level: 1, filters: [{ type: 'bandpass', frequency: 700, q: 0.9 }],
          swells: [{ seconds: 23, depth: 0.6 }, { seconds: 14, depth: 0.28 }],
          sweeps: [{ seconds: 37, depth: 320 }] },
        { level: 0.3, filters: [{ type: 'highpass', frequency: 2600, q: 0.5 }],
          swells: [{ seconds: 17, depth: 0.5 }] }
      ]
    },
    reverb: { seconds: 2.8, wet: 0.4 },
    steps: [
      { label: 'Em9', offset: 0, notes: [0, 3, 7, 10, 14] },
      { label: 'Cmaj9', offset: -4, notes: [0, 4, 7, 11, 14] },
      { label: 'Gmaj9', offset: 3, notes: [0, 4, 7, 11, 14] },
      { label: 'D6/9', offset: -2, notes: [0, 4, 7, 9, 14] }
    ]
  },
  {
    id: 'lullaby',
    title: 'Колыбельная',
    tag: 'очень низко и медленно',
    when: 'перед сном, лучше с таймером',
    text: 'Самая медленная сцена: аккорды меняются раз в полторы минуты, полотно лежит совсем низко, воздуха почти нет. Ставь таймер и не дослушивай до конца.',
    root: 45,                       // A2
    pad: { type: 'sine', level: 0.27, octave: 0, register: [110, 330], cutoff: 460, q: 0.7, sweep: 110, sweepSec: 83,
      detune: 9, width: 0.6, interval: 78, attack: 26, release: 34, stagger: 7, driftSec: 59 },
    bass: { level: 0.15, sub: 0.6, glide: 10, cutoff: 190 },
    texture: {
      kind: 'brown', level: 0.05,
      paths: [
        { level: 1, filters: [{ type: 'lowpass', frequency: 240, q: 0.8 }],
          swells: [{ seconds: 26, depth: 0.45 }] }
      ]
    },
    reverb: { seconds: 5.4, wet: 0.6 },
    steps: [
      { label: 'Am9', offset: 0, notes: [0, 3, 7, 10, 14] },
      { label: 'Fmaj9', offset: -4, notes: [0, 4, 7, 11, 14] },
      { label: 'Cmaj9', offset: 3, notes: [0, 4, 7, 11, 14] }
    ]
  },
  {
    id: 'space',
    title: 'Тихий космос',
    tag: 'светящееся полотно',
    when: 'когда хочется уехать от всего',
    text: 'Высокие лидийские аккорды и шёпот на самом верху. Самая «стеклянная» сцена — хорошо слушается в наушниках, но и на колонках не режет.',
    root: 43,                       // G2
    pad: { type: 'sine', level: 0.2, register: [220, 640], cutoff: 1500, q: 0.4, sweep: 560, sweepSec: 97,
      detune: 4, width: 1, interval: 66, attack: 22, release: 30, stagger: 6, driftSec: 67 },
    bass: { level: 0.1, sub: 0.35, glide: 9, cutoff: 300 },
    texture: {
      kind: 'white', level: 0.05,
      paths: [
        { level: 1, filters: [{ type: 'highpass', frequency: 3200, q: 0.5 }, { type: 'lowpass', frequency: 8000, q: 0.4 }],
          swells: [{ seconds: 29, depth: 0.7 }] },
        { level: 0.4, filters: [{ type: 'bandpass', frequency: 5200, q: 1.2 }],
          swells: [{ seconds: 19, depth: 0.8 }] }
      ]
    },
    reverb: { seconds: 6.2, wet: 0.66 },
    steps: [
      { label: 'Gmaj9#11', offset: 0, notes: [0, 4, 7, 11, 14, 18] },
      { label: 'Em9', offset: 9, notes: [0, 3, 7, 10, 14] },
      { label: 'Bm9', offset: 4, notes: [0, 3, 7, 10, 14] },
      { label: 'D6/9', offset: -5, notes: [0, 4, 7, 9, 14] }
    ]
  }
];

export const sceneById = (id) => AMBIENT_SCENES.find((s) => s.id === id) || AMBIENT_SCENES[0];

/** Длительность сессии в минутах. 0 — «без конца»: играет, пока не остановишь. */
export const DURATIONS = [10, 20, 30, 60, 0];
export const isInfinite = (minutes) => !(Number(minutes) > 0);

/* ---------- генерация ---------- */

/** Маленький детерминированный генератор: с одним seed музыка повторяема (это нужно тестам и рендеру). */
export function makeRng(seed = 1) {
  let a = (Number(seed) || 1) >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Порядок аккордов: перемешанные шаги сцены без повтора подряд.
 * Именно из-за него музыка каждый раз немного другая — но всегда «своя».
 */
export function chordPlan(scene, random, count = 8) {
  const s = sceneById(scene && scene.id ? scene.id : scene);
  const out = [];
  let prev = -1;
  for (let i = 0; i < count; i++) {
    let pick = 0;
    if (s.steps.length > 1) {
      let guard = 0;
      do { pick = Math.floor(random() * s.steps.length); guard++; } while (pick === prev && guard < 24);
      if (pick === prev) pick = (prev + 1) % s.steps.length;
    }
    out.push(pick);
    prev = pick;
  }
  return out;
}

/**
 * Один шаг сцены → голоса полотна и бас. Чистая функция: никакого Web Audio,
 * поэтому регистр, имена нот и панораму можно проверить в обычном тесте.
 */
export function chordVoices(scene, stepIndex, opts = {}) {
  const s = sceneById(scene && scene.id ? scene.id : scene);
  const steps = s.steps;
  const step = steps[mod(Math.round(stepIndex) || 0, steps.length)];
  const [low, high] = s.pad.register;
  const octave = s.pad.octave === undefined ? 12 : s.pad.octave;
  const width = opts.width === undefined ? s.pad.width : opts.width;
  const notes = step.notes.map((interval, i) => {
    const midi = foldIntoRange(s.root + step.offset + interval + octave, low, high);
    const spread = step.notes.length > 1 ? (i / (step.notes.length - 1)) * 2 - 1 : 0;
    return { midi, hz: round1(noteHz(midi)), name: noteName(midi), pan: Math.round(spread * width * 100) / 100 };
  });
  const bassMidi = s.root + step.offset;
  return {
    label: step.label,
    index: stepIndex,
    notes,
    bass: { midi: bassMidi, hz: round1(noteHz(bassMidi)), name: noteName(bassMidi) }
  };
}

/**
 * Сколько звука в сумме даёт сцена на пике — до эха и до громкости
 * человека. Проверка держит это число ниже единицы: клиппинг не должен
 * появляться даже на «без конца» и на полной громкости.
 */
export function sceneBudget(scene) {
  const s = sceneById(scene && scene.id ? scene.id : scene);
  const bass = s.bass.level * (1 + s.bass.sub);
  return Math.round((s.pad.level + bass + s.texture.level) * 100) / 100;
}

/** Громкость: 0..1, чтобы слайдер не мог оглушить. */
export const normalizeVolume = (v) => clamp(Number(v) > 0 ? Number(v) : 0, 0, 1);

/** Доля слоя воздуха: 0..1 (ползунок «Воздух»). */
export const normalizeTexture = normalizeVolume;

export const formatClock = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Есть ли вообще Web Audio (старый вебвью может не иметь). */
export const audioSupported = (g = globalThis) =>
  !!(g.AudioContext || g.webkitAudioContext) && typeof (g.AudioContext || g.webkitAudioContext) === 'function';

/* ---------- шум и эхо ---------- */

/**
 * Буфер шума для слоя воздуха: white — ровный, pink — мягче, brown — глухой.
 * Конец буфера сшивается с началом кроссфейдом: иначе на петле щёлкало бы.
 */
export function noiseBuffer(ctx, kind = 'white', seconds = 8, random = Math.random) {
  const rate = ctx.sampleRate || 44100;
  const len = Math.max(1, Math.floor(rate * seconds));
  const fade = Math.min(2000, Math.max(64, Math.floor(len / 8)));
  const work = new Float32Array(len + fade);
  if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < len + fade; i++) {
      last = (last + 0.02 * (random() * 2 - 1)) / 1.02;
      work[i] = last * 3.2;
    }
  } else if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len + fade; i++) {
      const w = random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.0555179;
      b1 = 0.963 * b1 + w * 0.0750759;
      b2 = 0.57 * b2 + w * 0.153852;
      work[i] = (b0 + b1 + b2 + w * 0.1848) * 0.6;
    }
  } else {
    for (let i = 0; i < len + fade; i++) work[i] = random() * 2 - 1;
  }
  /* шов петли: хвост вливаем в начало, лишние сэмплы отрезаем */
  for (let i = 0; i < Math.min(fade, len); i++) {
    const k = i / fade;
    work[i] = work[i] * k + work[len + i] * (1 - k);
  }
  const buf = ctx.createBuffer(1, len, rate);
  buf.getChannelData(0).set(work.subarray(0, len));
  return buf;
}

/**
 * Импульс для свёрточного эха: затухающий шум, у которого срезаны верха
 * (тёмный хвост вместо «металла») и есть предзадержка 30 мс. Нормируется
 * по энергии: сумма квадратов = 1, поэтому wet-гейн читается как обычная
 * громкость эха, а не как случайное число. normalize у конволвера
 * выключаем — так браузер и офлайн-рендер дают одно и то же.
 */
export function impulseResponse(ctx, seconds = 4, random = Math.random, opts = {}) {
  const rate = ctx.sampleRate || 44100;
  const len = Math.max(1, Math.floor(rate * seconds));
  const pre = Math.floor(rate * (opts.preDelay === undefined ? 0.03 : opts.preDelay));
  const damp = opts.damping === undefined ? 0.62 : opts.damping;
  const buf = ctx.createBuffer(2, len, rate);
  let sumSq = 0;
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, opts.decay === undefined ? 2.6 : opts.decay);
      lp = lp * damp + (random() * 2 - 1) * (1 - damp);
      data[i] = lp * env;
    }
    /* второй канал считается из своего шума — хвост получается шире */
    for (let i = len - 1; i >= pre; i--) data[i] = data[i - pre];
    for (let i = 0; i < pre; i++) data[i] = 0;
    for (let i = 0; i < len; i++) sumSq += data[i] * data[i];
  }
  const norm = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 0;
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] *= norm;
  }
  return buf;
}

/* ---------- движок ----------
   Один экземпляр живёт на всё приложение: музыка не обрывается, когда
   человек уходит в дневник или в чат.

   createAmbientEngine({ AudioContext, setTimeout, clearTimeout, now, random, seed })
     — все зависимости подставляются, по умолчанию берутся из globalThis. */
export function createAmbientEngine(deps = {}) {
  const G = deps.global || globalThis;
  const Ctx = deps.AudioContext || G.AudioContext || G.webkitAudioContext;
  const setTimer = deps.setTimeout || ((fn, ms) => G.setTimeout(fn, ms));
  const clearTimer = deps.clearTimeout || ((id) => G.clearTimeout(id));
  const now = deps.now || (() => Date.now());
  const random = deps.random || makeRng(deps.seed === undefined ? 1 + Math.floor(Math.random() * 1e9) : deps.seed);

  const listeners = new Set();
  const settings = {
    scene: AMBIENT_SCENES[0].id,
    volume: 0.35,
    minutes: 30,
    texture: 1,      // доля слоя воздуха
    reverb: true     // эхо включено
  };

  let ctx = null, master = null, dry = null, verbIn = null, wet = null;
  let padBus = null, padFilter = null, bassGain = null, bassFilter = null, subGain = null;
  let textureGain = null, textureSrc = null, texturePaths = [];
  let bassA = null, bassB = null;
  let lfoNodes = [];
  let textureLfos = [];
  let chordTimer = null, endTimer = null, fadeTimer = null;
  let releaseTimers = [];
  let groups = [];
  let gen = 0;
  let playing = false, paused = false, stopping = false;
  let endsAt = 0, pausedLeft = 0, totalMs = 0;
  let plan = [], planAt = 0;
  let current = chordVoices(sceneById(settings.scene), 0, { width: sceneById(settings.scene).pad.width });

  const FADE_IN = 4, FADE_OUT = 8;

  const snapshot = () => {
    const scene = sceneById(settings.scene);
    const infinite = isInfinite(settings.minutes);
    return {
      playing: playing && !stopping,
      paused,
      scene: scene.id,
      title: scene.title,
      tag: scene.tag,
      volume: settings.volume,
      minutes: settings.minutes,
      texture: settings.texture,
      reverb: settings.reverb,
      infinite,
      secondsLeft: secondsLeft(),
      totalSeconds: infinite ? 0 : Math.round(totalMs / 1000),
      voices: current ? current.notes.length : 0,
      chord: current ? {
        label: current.label,
        notes: current.notes.map((n) => ({ name: n.name, hz: n.hz })),
        bass: current.bass ? { name: current.bass.name, hz: current.bass.hz } : null
      } : null
    };
  };
  const emit = () => listeners.forEach((fn) => { try { fn(snapshot()); } catch (e) {} });
  function secondsLeft() {
    if (!playing || stopping || isInfinite(settings.minutes)) return 0;
    if (paused) return Math.max(0, Math.round(pausedLeft / 1000));
    return Math.max(0, Math.round((endsAt - now()) / 1000));
  }

  /* ---- медленные LFO: дыхание фильтров, слоя воздуха и высоты полотна ---- */
  function addLfo(seconds, depth, params, into = lfoNodes) {
    const targets = (Array.isArray(params) ? params : [params]).filter(Boolean);
    if (!ctx || !targets.length) return null;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1 / Math.max(1, seconds);
    const g = ctx.createGain();
    g.gain.value = depth;
    osc.connect(g);
    for (const p of targets) g.connect(p);
    into.push({ osc, g });
    return osc;
  }

  function textureLevel() {
    return sceneById(settings.scene).texture.level * settings.texture;
  }

  /* ---- слои ---- */
  function buildTexture(scene, startAt = 0) {
    const tx = scene.texture;
    textureSrc = ctx.createBufferSource();
    textureSrc.buffer = noiseBuffer(ctx, tx.kind, 8, random);
    textureSrc.loop = true;
    textureGain = ctx.createGain();
    textureGain.gain.value = textureLevel();
    textureGain.connect(dry);
    if (verbIn) textureGain.connect(verbIn);

    /* У слоя может быть несколько веток от одного источника шума:
       у волн — свалы и пена, у дождя — шум и капли, у огня — гул и
       треск. Каждая ветка сама дышит и сама может качать фильтр. */
    texturePaths = [];
    textureLfos = [];
    for (const p of tx.paths) {
      const level = p.level === undefined ? 1 : p.level;
      const chain = [];
      let node = textureSrc;
      for (const f of p.filters || []) {
        const b = ctx.createBiquadFilter();
        b.type = f.type;
        b.frequency.value = f.frequency;
        if (f.q !== undefined && b.Q) b.Q.value = f.q;
        node.connect(b);
        node = b;
        chain.push(b);
      }
      const gain = ctx.createGain();
      gain.gain.value = level;
      node.connect(gain);
      gain.connect(textureGain);
      const lfos = [];
      for (const s of p.swells || []) {
        addLfo(s.seconds, textureLevel() * level * s.depth, gain.gain, lfos);
      }
      for (const s of p.sweeps || []) {
        if (chain[0]) addLfo(s.seconds, s.depth, chain[0].frequency, lfos);
      }
      texturePaths.push({ nodes: [...chain, gain], lfos });
      textureLfos.push(...lfos);
    }
    try { textureSrc.start(startAt); } catch (e) {}
  }

  /** Гасит слой воздуха: нужен, когда человек меняет сцену на ходу. */
  function stopTexture() {
    for (const l of textureLfos) {
      try { l.osc.stop(); } catch (e) {}
      try { l.osc.disconnect(); } catch (e) {}
      try { l.g.disconnect(); } catch (e) {}
    }
    textureLfos = [];
    try { textureSrc && textureSrc.stop(); } catch (e) {}
    const dead = [textureSrc, textureGain];
    for (const p of texturePaths) dead.push(...p.nodes);
    for (const node of dead) {
      try { node && node.disconnect && node.disconnect(); } catch (e) {}
    }
    textureSrc = null; textureGain = null;
    texturePaths = [];
  }

  function buildGraph() {
    const scene = sceneById(settings.scene);
    ctx = new Ctx();

    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    dry = ctx.createGain();
    dry.gain.value = 1;
    dry.connect(master);

    if (typeof ctx.createConvolver === 'function') {
      const conv = ctx.createConvolver();
      conv.buffer = impulseResponse(ctx, scene.reverb.seconds, random);
      if ('normalize' in conv) conv.normalize = false;
      verbIn = ctx.createGain();
      verbIn.gain.value = 1;
      wet = ctx.createGain();
      wet.gain.value = settings.reverb ? scene.reverb.wet : 0;
      verbIn.connect(conv);
      conv.connect(wet);
      wet.connect(master);
    }

    /* полотно: аккорды сходятся в общий фильтр, он и «дышит» */
    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = scene.pad.cutoff;
    if (padFilter.Q) padFilter.Q.value = scene.pad.q;
    padBus = ctx.createGain();
    padBus.gain.value = 1;
    padBus.connect(padFilter);
    padFilter.connect(dry);
    if (verbIn) padFilter.connect(verbIn);
    addLfo(scene.pad.sweepSec, scene.pad.sweep, padFilter.frequency);

    /* бас: корень и субоктава, обе скользят за аккордом очень медленно */
    bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.value = scene.bass.cutoff;
    bassGain = ctx.createGain();
    bassGain.gain.value = scene.bass.level;
    subGain = ctx.createGain();
    subGain.gain.value = scene.bass.sub;
    bassA = ctx.createOscillator();
    bassA.type = 'triangle';
    bassB = ctx.createOscillator();
    bassB.type = 'sine';
    bassA.connect(bassFilter);
    bassB.connect(subGain);
    subGain.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(dry);
    if (verbIn) bassGain.connect(verbIn);

    buildTexture(scene, ctx.currentTime);
  }

  /* ---- аккорды ---- */
  function nextStepIndex() {
    const scene = sceneById(settings.scene);
    if (planAt >= plan.length) {
      plan = chordPlan(scene, random, 8);
      planAt = 0;
    }
    return plan[planAt++];
  }

  /** Новый аккорд: голоса входят не вместе (stagger) и каждый со своим уровнем. */
  function startChord(index, first = false) {
    const scene = sceneById(settings.scene);
    const voicing = chordVoices(scene, index, { width: scene.pad.width });
    const t0 = ctx.currentTime + 0.05;
    const nodes = { oscs: [], gains: [], lfos: [] };
    const n = voicing.notes.length;
    const attack = first ? Math.min(6, scene.pad.attack) : scene.pad.attack;

    voicing.notes.forEach((note, i) => {
      const level = (scene.pad.level / n) * (0.82 + random() * 0.36);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      let out = gain;
      if (typeof ctx.createStereoPanner === 'function') {
        const pan = ctx.createStereoPanner();
        pan.pan.value = note.pan;
        gain.connect(pan);
        out = pan;
      }
      out.connect(padBus);

      /* два генератора на голос: расстройка даёт мягкое биение, а не «пилу» */
      for (const sign of [1, -1]) {
        const osc = ctx.createOscillator();
        osc.type = scene.pad.type;
        osc.frequency.value = note.hz;
        osc.detune.value = sign * scene.pad.detune + (random() - 0.5) * scene.pad.detune;
        osc.connect(gain);
        nodes.oscs.push(osc);
      }
      /* голоса входят не вместе: аккорд набирается как волна, а не как удар */
      const off = first ? 0 : random() * scene.pad.stagger;
      gain.gain.setValueAtTime(0, t0 + off);
      gain.gain.linearRampToValueAtTime(level, t0 + off + attack);
      nodes.gains.push({ gain, level, off });
    });

    /* один общий для аккорда дрейф высоты: полотно чуть «плывёт» */
    addLfo(scene.pad.driftSec, scene.pad.detune * 0.45, nodes.oscs.map((o) => o.detune), nodes.lfos);

    for (const osc of nodes.oscs) osc.start(t0);
    groups.push({ nodes, voicing, startedAt: t0, released: false });
    current = voicing;
    glideBass(voicing.bass.hz, scene);
  }

  function glideBass(hz, scene) {
    if (!bassA) return;
    const t = ctx.currentTime;
    const glide = Math.max(0.5, scene.bass.glide);
    try {
      bassA.frequency.setTargetAtTime(hz, t, glide / 3);
      bassB.frequency.setTargetAtTime(hz / 2, t, glide / 3);
    } catch (e) {
      bassA.frequency.value = hz;
      bassB.frequency.value = hz / 2;
    }
  }

  /** Аккорд уходит медленно; генераторы гасятся только после хвоста. */
  function releaseChord(group) {
    if (!group || group.released) return;
    group.released = true;
    const scene = sceneById(settings.scene);
    const t = ctx.currentTime;
    const myGen = gen;
    group.nodes.gains.forEach((v, i) => {
      const off = (i % 3) * scene.pad.release * 0.12;
      const from = v.gain.gain.value;
      try {
        v.gain.gain.cancelScheduledValues(t + off);
        v.gain.gain.setValueAtTime(Math.max(0.0001, from), t + off);
        v.gain.gain.linearRampToValueAtTime(0, t + off + scene.pad.release);
      } catch (e) {}
    });
    const id = setTimer(() => {
      if (myGen !== gen) return;
      stopGroup(group);
    }, (scene.pad.release * 1.4 + 1) * 1000);
    releaseTimers.push(id);
  }

  function stopGroup(group) {
    for (const osc of group.nodes.oscs) {
      try { osc.stop(); } catch (e) {}
      try { osc.disconnect(); } catch (e) {}
    }
    for (const l of group.nodes.lfos) {
      try { l.osc.stop(); } catch (e) {}
      try { l.osc.disconnect(); } catch (e) {}
      try { l.g.disconnect(); } catch (e) {}
    }
    for (const v of group.nodes.gains) {
      try { v.gain.disconnect(); } catch (e) {}
    }
    groups = groups.filter((g) => g !== group);
  }

  function nextChord() {
    if (!playing || stopping) return;
    const scene = sceneById(settings.scene);
    for (const g of groups.slice()) releaseChord(g);
    startChord(nextStepIndex());
    chordTimer = setTimer(nextChord, scene.pad.interval * 1000);
    emit();
  }

  function teardown() {
    clearTimer(chordTimer); clearTimer(endTimer); clearTimer(fadeTimer);
    chordTimer = endTimer = fadeTimer = null;
    for (const id of releaseTimers) clearTimer(id);
    releaseTimers = [];
    for (const g of groups.slice()) stopGroup(g);
    groups = [];
    for (const l of lfoNodes) {
      try { l.osc.stop(); } catch (e) {}
      try { l.osc.disconnect(); } catch (e) {}
      try { l.g.disconnect(); } catch (e) {}
    }
    lfoNodes = [];
    stopTexture();
    for (const node of [bassA, bassB]) {
      try { node && node.stop(); } catch (e) {}
    }
    const all = [bassA, bassB, subGain, bassFilter, bassGain,
      padFilter, padBus, verbIn, wet, dry, master];
    for (const node of all) {
      try { node && node.disconnect && node.disconnect(); } catch (e) {}
    }
    try { ctx && ctx.close && ctx.close(); } catch (e) {}
    ctx = master = dry = verbIn = wet = padBus = padFilter = null;
    bassA = bassB = bassFilter = bassGain = subGain = null;
  }

  function fadeOutAndStop(fadeSec, afterMs) {
    if (!ctx || !master) return;
    const myGen = gen;
    const t = ctx.currentTime;
    try {
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
      master.gain.linearRampToValueAtTime(0, t + fadeSec);
    } catch (e) {}
    fadeTimer = setTimer(() => {
      if (myGen !== gen) return;   // за это время запустили новую музыку — не трогаем её
      teardown();
      playing = false; paused = false; stopping = false;
      emit();
    }, afterMs);
  }

  const api = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    state: snapshot,
    get playing() { return playing && !stopping; },

    configure(patch = {}) {
      const before = settings.scene;
      if (patch.scene && sceneById(patch.scene).id === patch.scene) settings.scene = patch.scene;
      if (patch.volume !== undefined) settings.volume = normalizeVolume(patch.volume);
      if (patch.texture !== undefined) settings.texture = normalizeTexture(patch.texture);
      if (patch.minutes !== undefined) settings.minutes = clamp(Math.round(Number(patch.minutes) || 0), 0, 240);
      if (patch.reverb !== undefined) settings.reverb = !!patch.reverb;
      const scene = sceneById(settings.scene);
      /* Если человек только выбирает сцену (музыка выключена) — показываем
         её первый аккорд: экран успевает рассказать, что сейчас зазвучит. */
      if (!playing) current = chordVoices(scene, 0, { width: scene.pad.width });
      if (playing && !paused) {
        const t = ctx.currentTime;
        try {
          if (master) master.gain.setTargetAtTime(settings.volume, t, 0.5);
          if (wet) wet.gain.setTargetAtTime(settings.reverb ? scene.reverb.wet : 0, t, 1.2);
          if (textureGain) textureGain.gain.setTargetAtTime(textureLevel(), t, 1.5);
          if (padFilter) padFilter.frequency.setTargetAtTime(scene.pad.cutoff, t, 3);
          if (bassFilter) bassFilter.frequency.setTargetAtTime(scene.bass.cutoff, t, 3);
          if (bassGain) bassGain.gain.setTargetAtTime(scene.bass.level, t, 3);
          if (subGain) subGain.gain.setTargetAtTime(scene.bass.sub, t, 3);
        } catch (e) {}
        /* Смена сцены на ходу: полотно дотянет текущий аккорд и перейдёт
           к своему следующему, а слой воздуха меняется сразу — иначе
           человек выбрал «дождь», а слышит волны до конца сессии. */
        if (before !== settings.scene) {
          stopTexture();
          buildTexture(scene, ctx.currentTime);
        }
      }
      emit();
      return snapshot();
    },

    start() {
      if (!Ctx) { const e = new Error('unsupported'); e.reason = 'unsupported'; throw e; }
      /* Перезапуск: старый граф разбираем сразу и синхронно — отложенное
         затухание здесь закрыло бы уже новый контекст. */
      gen++;
      stopping = false;
      if (playing || ctx) {
        clearTimer(chordTimer); clearTimer(endTimer); clearTimer(fadeTimer);
        chordTimer = endTimer = fadeTimer = null;
        teardown();
        playing = false; paused = false;
      }
      plan = [];
      planAt = 0;
      buildGraph();
      totalMs = isInfinite(settings.minutes) ? 0 : settings.minutes * 60000;
      endsAt = now() + totalMs;
      pausedLeft = 0;
      playing = true; paused = false;

      const scene = sceneById(settings.scene);
      const t = ctx.currentTime;
      try {
        master.gain.setValueAtTime(0, t);
        master.gain.linearRampToValueAtTime(settings.volume, t + FADE_IN);
      } catch (e) {}
      /* первый аккорд выбираем до старта баса: иначе бас поедет к своей
         ноте от частоты по умолчанию и первые секунды будет слышно «глиссандо» */
      const firstIndex = nextStepIndex();
      const firstVoicing = chordVoices(scene, firstIndex, { width: scene.pad.width });
      try {
        bassA.frequency.value = firstVoicing.bass.hz;
        bassB.frequency.value = firstVoicing.bass.hz / 2;
      } catch (e) {}
      for (const osc of [bassA, bassB]) { try { osc.start(t); } catch (e) {} }

      startChord(firstIndex, true);
      chordTimer = setTimer(nextChord, scene.pad.interval * 1000);
      if (!isInfinite(settings.minutes)) {
        endTimer = setTimer(() => fadeOutAndStop(FADE_OUT, FADE_OUT * 1000), Math.max(0, totalMs - FADE_OUT * 1000));
      }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      emit();
      return snapshot();
    },

    pause() {
      if (!playing || stopping || paused || !ctx) return snapshot();
      paused = true;
      pausedLeft = Math.max(0, endsAt - now());
      try { ctx.suspend && ctx.suspend(); } catch (e) {}
      emit();
      return snapshot();
    },

    resume() {
      if (!playing || stopping || !paused || !ctx) return snapshot();
      paused = false;
      endsAt = now() + pausedLeft;
      pausedLeft = 0;
      try { ctx.resume && ctx.resume(); } catch (e) {}
      emit();
      return snapshot();
    },

    /** Останавливает с коротким затуханием; выбор человека остаётся. */
    stop() {
      if (!playing || stopping) return snapshot();
      stopping = true;
      fadeOutAndStop(0.8, 820);
      return snapshot();
    },

    /** Полный сброс: музыки нет, подписчики сняты — зовётся при выгрузке. */
    destroy() {
      gen++;
      clearTimer(chordTimer); clearTimer(endTimer); clearTimer(fadeTimer);
      chordTimer = endTimer = fadeTimer = null;
      teardown();
      playing = false; paused = false; stopping = false;
      listeners.clear();
    }
  };

  return api;
}
