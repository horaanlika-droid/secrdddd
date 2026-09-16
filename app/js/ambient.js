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
     4. Земля. Под полотном лежит настоящая запись сцены: волны, дождь,
        костёр, утро в лесу (app/assets/ambience/*.m4a, CC0, ≈2,5 МБ на
        все шесть сцен). Петли длинные (32–52 с) и бесшовные, в движке
        играют две копии со случайными точками входа и своими медленными
        «дыханиями» — поэтому повтор не слышно. Если запись не достать
        (нет сети, старый вебвью), её место занимает прежний слой шума:
        музыка продолжает играть, просто чуть более «синтетически».
     5. Голос. Поверх полотна — мелодия: маленький мотив из 3–5 нот,
        который сочиняется один раз на сессию и потом транспонируется
        под каждый аккорд. Фраза дышит (паузы 0,9–2,4 с), ноты входят
        с человеческой задержкой ±60…90 мс, слегка расстроены и
        заканчиваются на устойчивой ступени аккорда — поэтому это
        музыка, а не случайные ноты. Иногда ту же ноту дублирует
        подголосок на 5–12 полутонов ниже.
     6. Акценты. Раз в 40–180 с очень тихо заходят настоящие
        колокольчики (chimes.m4a) — редкая живая случайность, которую
        невозможно предсказать и которая весит 76 КБ.
     7. Пространство. Свёрточное эхо на сгенерированном импульсе
        (шум с затуханием, нормированный по энергии) размывает края.
        На мастере стоит мягкий лимитер: редкие всплески прибоя и
        треска не режут слух и не доводят сумму слоёв до клиппинга.

   Ни ударов, ни ритма, ни сетки: самый быстрый цикл здесь длиннее
   восьми секунд, аккорд держится 46–78 с, фразы приходят случайно.
   Записи — открытые (CC0 1.0), стриминг и внешние URL не подключаются:
   звук лежит в репозитории и работает офлайн после первой загрузки
   сцены. Происхождение каждой петли — в app/assets/ambience/LICENSES.md,
   пересборка с нуля — scripts/ambience/build-ambience.sh.

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

/** То же складывание, но границы заданы номерами нот, а не герцами (регистр мелодии). */
export function foldIntoMidi(midi, low, high) {
  let m = Math.round(midi);
  for (let i = 0; i < 12 && m > high; i++) m -= 12;
  for (let i = 0; i < 12 && m < low; i++) m += 12;
  return m;
}

/* ---------- лад и мотив ----------
   У каждой сцены есть `mode` — набор полутонов от тоники (натуральный
   минор, мажор, лидийский). Лад выбран так, чтобы ВСЕ аккорды сцены
   (`steps[].offset`) были его ступенями: тогда мелодия, построенная из
   тех же ступеней, не может разминуться с аккордом. Это проверяет
   ambient-test («у каждой сцены лад содержит её аккорды»). */

/** Нота по ступени лада: 0 — тоника, 7 — тоника следующей октавы, −2 — ступень ниже. */
export function scaleNote(scene, degree) {
  const s = sceneById(scene && scene.id ? scene.id : scene);
  const n = s.mode.length;
  const oct = Math.floor(degree / n);
  const i = mod(Math.round(degree), n);
  return s.root + oct * 12 + s.mode[i];
}

/**
 * Ступень лада, на которой стоит корень аккорда: offset аккорда — это
 * разница в полутонах от тоники сцены, а ступень нужна, чтобы мелодия
 * отсчитывалась от того же аккорда (а не от тоники сцены).
 */
export function degreeOfOffset(scene, offset) {
  const s = sceneById(scene && scene.id ? scene.id : scene);
  const want = Math.round(offset);
  for (let d = -21; d <= 21; d++) if (scaleNote(s, d) - s.root === want) return d;
  return 0;   // аккорд вне лада: мелодия останется на тонике (так не бывает — проверяет тест)
}

/** Ступени аккорда от его корня: тоника, терция, квинта, септима, нона. */
export const chordDegrees = (rootDegree) => [0, 2, 4, 6, 8].map((d) => rootDegree + d);

/** Устойчивые ступени аккорда — те, на которых фраза «закрывается». */
export const STABLE_DEGREES = [0, 2, 4];

/** Те же устойчивые ступени с октавами: финал мотива идёт к ближайшей, а не прыгает. */
const STABLE_NEAR = [-7, -5, -3, 0, 2, 4, 7, 9];

/** Та ли это нота аккорда (с точностью до октавы): тоника, терция, квинта, септима или нона. */
export const isChordTone = (chordDegree, degree) =>
  chordDegrees(chordDegree).some((d) => mod(d - degree, 7) === 0);

/**
 * Мотив: 3–5 шагов по ладу, которые потом повторяются в разных
 * тональностях. Именно повтор узнаётся как музыка — случайные ноты
 * звучали бы как генератор.
 *
 * Начало всегда на тонике аккорда, шаги — на секунду-терцию (тема
 * остаётся певучей и не улетает из диапазона), а финал приводится к
 * ближайшей устойчивой ступени: тонике, терции или квинте аккорда,
 * с точностью до октавы. Поэтому фраза «закрывается», а не обрывается.
 */
export function makeMotif(random = Math.random) {
  const roll = random();
  const len = roll < 0.5 ? 3 : roll < 0.85 ? 4 : 5;
  const steps = [0];
  for (let i = 1; i < len; i++) {
    const prev = steps[i - 1];
    const dir = random() < 0.62 ? 1 : -1;
    const size = random() < 0.72 ? 1 : 2;
    let next = prev + dir * size;
    if (next > 4) next = prev - size;        // тема не должна улетать вверх
    if (next < -4) next = prev + size;       // и нырять ниже баса
    if (next === prev) next = prev + (prev >= 0 ? -1 : 1);
    steps.push(next);
  }
  if (steps.length > 2) {
    const last = steps[steps.length - 1];
    steps[steps.length - 1] = STABLE_NEAR.reduce(
      (best, c) => (Math.abs(c - last) < Math.abs(best - last) ? c : best), STABLE_NEAR[3]);
  }
  return steps;
}

/** Сколько фраз помещается в аккорд: у длинных сцен две, у коротких — одна-две. */
export function phraseCount(scene, holdSec, random = Math.random) {
  const s = sceneById(scene && scene.id ? scene.id : scene);
  const cap = s.melody && Array.isArray(s.melody.phrases) ? s.melody.phrases : [1, 2];
  if (holdSec >= 60) return Math.min(cap[1], 2);
  return random() < 0.5 ? cap[0] : Math.min(cap[1], cap[0] + 1);
}

/** Длительности нот фразы: из одного короткого набора — так мотив узнаётся. */
export const NOTE_SECONDS = [1.4, 2.2, 3.1, 4.2];

/**
 * План одной фразы — чистая функция: никаких узлов Web Audio, поэтому
 * регистр, лад, длительности и «человечность» можно проверить тестом.
 *
 * anchorDegree — ступень аккорда, от которой считается мотив;
 * at           — момент начала фразы в секундах (время аудиоконтекста);
 * voice        — ручка «Голос» (0..1), множит уровень нот.
 */
export function melodyPlan(scene, opts = {}) {
  const s = sceneById(scene && scene.id ? scene.id : scene);
  const m = s.melody;
  const rndFrom = (random) => (a, b) => a + random() * (b - a);
  const random = opts.random || Math.random;
  const rnd = rndFrom(random);
  const motif = Array.isArray(opts.motif) && opts.motif.length ? opts.motif : makeMotif(random);
  const anchor = Number(opts.anchorDegree) || 0;
  const at = Number(opts.at) || 0;
  const voice = normalizeVolume(opts.voice === undefined ? 1 : opts.voice);
  const [low, high] = m.register;
  const notes = [];
  const pan0 = Math.round(rnd(-0.4, 0.4) * 100) / 100;
  let t = at;
  for (let i = 0; i < motif.length; i++) {
    const last = i === motif.length - 1;
    const degree = anchor + motif[i];
    /* мотив строится от корня аккорда и поднимается на две октавы выше
       полотна: голос слышен отдельно, а не тонет в аккорде */
    const midi = foldIntoMidi(scaleNote(s, degree) + 24, low, high);
    const dur = NOTE_SECONDS[Math.floor(random() * NOTE_SECONDS.length) % NOTE_SECONDS.length] * (last ? 1.5 : 1);
    const vel = round1(m.level * voice * rnd(0.62, 1) * (i === 0 ? 0.85 : 1) * (last ? 0.8 : 1) * 1000) / 1000;
    const note = {
      degree, midi, hz: round1(noteHz(midi)), name: noteName(midi),
      at: round1((t + rnd(-0.06, 0.09)) * 1000) / 1000,
      dur: round1(dur * 100) / 100,
      vel,
      pan: Math.round((pan0 + rnd(-0.15, 0.15)) * 100) / 100,
      tail: round1(Math.max(1.6, dur * 1.15) * 100) / 100
    };
    /* подголосок: иногда середину фразы дублирует нота на 5–12 полутонов
       ниже и вдвое тише — слышится «написанная» музыка, а не один голос */
    if (i === Math.floor(motif.length / 2) && random() < 0.45) {
      const below = [5, 7, 12][Math.floor(random() * 3) % 3];
      const subMidi = foldIntoMidi(midi - below, Math.max(40, low - 12), high);
      note.sub = {
        midi: subMidi, hz: round1(noteHz(subMidi)), name: noteName(subMidi),
        vel: round1(vel * SUBVOICE_MIX * 1000) / 1000,
        at: round1((t + rnd(0.05, 0.25)) * 1000) / 1000,
        dur: round1(dur * 1.3 * 100) / 100,
        pan: pan0
      };
    }
    notes.push(note);
    t += dur + (random() < m.rest ? rnd(0.9, 2.4) : rnd(0.05, 0.35));
  }
  return {
    motif: motif.slice(),
    anchorDegree: anchor,
    chordDegree: opts.chordDegree === undefined ? anchor : opts.chordDegree,
    notes,
    seconds: round1((t - at) * 100) / 100
  };
}

/* ---------- записи природы (слой земли) ---------- */

/** Папка с петлями: они лежат в репозитории и отдаются вместе с приложением. */
export const AMBIENCE_DIR = 'assets/ambience';

/**
 * Записи выровнены по RMS −27…−33 dBFS (см. scripts/ambience/loop-report.json),
 * то есть сами по себе они тише синтезаторного полотна примерно втрое.
 * Чтобы «воздух» был слышен так же, как в эталонном демо, уровень петли
 * умножается на эту поправку. Две копии играют по половине уровня, поэтому
 * в сумме получается ровно `bed.level * BED_TRIM`.
 */
export const BED_TRIM = 2.2;

/** Насколько каждая копия петли «дышит»: ±18 % своего уровня, свои фазы. */
export const BED_DRIFT_DEPTH = 0.18;

/** Смешанный с сигналом подголосок: вдвое тише основной ноты. */
export const SUBVOICE_MIX = 0.45;

/** Кроссфейд воздуха: смена сцены и приход записи вместо шума (1,5–2,5 с). */
export const AIR_CROSSFADE = 2.2;

/** Перевод dBFS в линейную амплитуду: −3.14 dBFS → 0.70. */
export const dbToLinear = (db) => Math.pow(10, Number(db) / 20);

/** Уровень записи в движке: уровень сцены × поправка × ручка «Воздух». */
export function bedLevel(scene, air = 1) {
  const s = sceneById(scene && scene.id ? scene.id : scene);
  if (!s.bed) return 0;
  return round1(s.bed.level * BED_TRIM * normalizeTexture(air) * 1000) / 1000;
}

/**
 * Вклад слоя земли в пик смеси: две копии в фазе (1,0) плюс дыхание
 * (×1,2) на измеренном пике петли. Число нужно проверке бюджета —
 * клиппинга не должно быть даже на полной громкости и «без конца».
 */
export function bedPeak(scene, air = 1) {
  const s = sceneById(scene && scene.id ? scene.id : scene);
  if (!s.bed) return 0;
  return round1(bedLevel(s, air) * s.bed.peak * 1.2 * 100) / 100;
}

/** Вклад голоса в пик: нота плюс подголосок. */
export function voicePeak(scene, voice = 1) {
  const s = sceneById(scene && scene.id ? scene.id : scene);
  if (!s.melody) return 0;
  return round1(s.melody.level * normalizeVolume(voice) * (1 + SUBVOICE_MIX) * 100) / 100;
}

/** Вклад живых акцентов в пик (колокольчики). */
export function accentPeak(scene) {
  const s = sceneById(scene && scene.id ? scene.id : scene);
  if (!s.accents) return 0;
  return round1(s.accents.level * (s.accents.peak === undefined ? 0.7 : s.accents.peak) * 100) / 100;
}

/* ---------- мягкий лимитер на мастере ---------- */

/**
 * Порог и соотношение лимитера, который стоит на мастере: редкие
 * всплески прибоя и треска не должны ни резать слух, ни складываться
 * с полотном в клиппинг. Ниже единицы (0,1 ≈ −20 dBFS) он не трогает
 * сигнал вовсе, выше — сжимает вдвое.
 */
export const GLUE = { threshold: 0.1, knee: 14, ratio: 2, attack: 0.02, release: 0.5 };

/** Что останется от суммы пиков после лимитера — то есть что услышит человек. */
export const afterGlue = (sum) => {
  const x = Math.max(0, Number(sum) || 0);
  return round1((x <= GLUE.threshold ? x : GLUE.threshold + (x - GLUE.threshold) / GLUE.ratio) * 1000) / 1000;
};

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
   pad.detune    — расстройка двух генераторов одного голоса, в центах

   mode          — лад сцены (полутона от тоники). Подобран так, чтобы
                   все аккорды steps[] были его ступенями: мелодия
                   строится из тех же ступеней и не расходится с аккордом
   bed           — запись природы под полотном:
     bed.file      путь к петле (app/assets/ambience/*.m4a, CC0)
     bed.seconds   длина петли; короче 30 с петля уже слышна как петля
     bed.peak      измеренный линейный пик готового файла
                   (node scripts/ambience/measure.mjs → files-report.json)
     bed.level     уровень относительно других сцен (умножается на BED_TRIM)
     bed.tone      lowpass поверх записи: убирает «стекло» и шипение
     bed.spread    насколько две копии разведены по стерео
     bed.drift     периоды «дыхания» каждой копии, с (25–49 с, разные)
   melody        — голос: уровень, регистр (номера нот), паузы между
                   фразами и вероятность дыхания внутри фразы
   accents       — живые акценты (колокольчики): раз в gap[0]..gap[1] с
   texture       — запасной слой воздуха из шума: играет сразу и остаётся,
                   если запись не загрузилась (офлайн, старый вебвью) */

export const AMBIENT_SCENES = [
  {
    id: 'sea',
    title: 'Ночное море',
    tag: 'волны',
    when: 'вечером или когда не спится',
    text: 'Низкие полотна и очень медленные волны. Самая «дышащая» сцена: если не знаешь, что выбрать — начни с неё.',
    root: 45,                       // A2
    mode: [0, 2, 3, 5, 7, 8, 10],     // натуральный минор
    pad: { type: 'sine', level: 0.26, register: [150, 560], cutoff: 620, q: 0.7, sweep: 190, sweepSec: 61,
      detune: 7, width: 0.8, interval: 58, attack: 18, release: 26, stagger: 5, driftSec: 43 },
    bass: { level: 0.13, sub: 0.45, glide: 7, cutoff: 240 },
    /* земля: запись сцены (CC0). level — относительно других сцен,
       peak и seconds — измерения петли из scripts/ambience/loop-report.json */
    bed: { file: 'assets/ambience/sea.m4a', seconds: 38.5, peak: 0.68, level: 0.42, tone: 900, spread: 0.3, drift: [41, 29] },
    melody: { level: 0.15, register: [69, 93], gap: [12, 26], rest: 0.35, phrases: [1, 2] },
    accents: { file: 'assets/ambience/chimes.m4a', seconds: 7.5, gap: [50, 120], level: 0.07, peak: 0.29 },
    /* запасной воздух: шум вместо записи, если её не достать */
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
    mode: [0, 2, 3, 5, 7, 8, 10],     // натуральный минор
    pad: { type: 'sine', level: 0.24, register: [150, 520], cutoff: 700, q: 0.6, sweep: 150, sweepSec: 47,
      detune: 6, width: 0.7, interval: 50, attack: 15, release: 22, stagger: 4, driftSec: 37 },
    bass: { level: 0.12, sub: 0.5, glide: 6, cutoff: 230 },
    /* земля: запись сцены (CC0). level — относительно других сцен,
       peak и seconds — измерения петли из scripts/ambience/loop-report.json */
    bed: { file: 'assets/ambience/rain.m4a', seconds: 50, peak: 0.82, level: 0.4, tone: 1400, spread: 0.28, drift: [37, 27] },
    melody: { level: 0.13, register: [70, 94], gap: [10, 22], rest: 0.3, phrases: [1, 2] },
    accents: { file: 'assets/ambience/chimes.m4a', seconds: 7.5, gap: [70, 150], level: 0.05, peak: 0.29 },
    /* запасной воздух: шум вместо записи, если её не достать */
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
    mode: [0, 2, 4, 5, 7, 9, 11],     // мажор
    pad: { type: 'triangle', level: 0.25, register: [140, 460], cutoff: 540, q: 0.8, sweep: 160, sweepSec: 53,
      detune: 8, width: 0.75, interval: 54, attack: 17, release: 24, stagger: 5, driftSec: 41 },
    bass: { level: 0.14, sub: 0.55, glide: 8, cutoff: 210 },
    /* земля: запись сцены (CC0). level — относительно других сцен,
       peak и seconds — измерения петли из scripts/ambience/loop-report.json */
    bed: { file: 'assets/ambience/hearth.m4a', seconds: 42, peak: 0.28, level: 0.46, tone: 1100, spread: 0.24, drift: [43, 31] },
    melody: { level: 0.16, register: [67, 91], gap: [9, 20], rest: 0.3, phrases: [1, 2] },
    accents: { file: 'assets/ambience/chimes.m4a', seconds: 7.5, gap: [45, 110], level: 0.06, peak: 0.29 },
    /* запасной воздух: шум вместо записи, если её не достать */
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
    mode: [0, 2, 3, 5, 7, 8, 10],     // натуральный минор
    pad: { type: 'sine', level: 0.23, register: [170, 600], cutoff: 1150, q: 0.5, sweep: 420, sweepSec: 71,
      detune: 5, width: 0.9, interval: 46, attack: 13, release: 20, stagger: 4, driftSec: 33 },
    bass: { level: 0.1, sub: 0.4, glide: 6, cutoff: 260 },
    /* земля: запись сцены (CC0). level — относительно других сцен,
       peak и seconds — измерения петли из scripts/ambience/loop-report.json */
    bed: { file: 'assets/ambience/forest.m4a', seconds: 37, peak: 0.18, level: 0.44, tone: 1600, spread: 0.34, drift: [35, 25] },
    melody: { level: 0.17, register: [72, 96], gap: [8, 18], rest: 0.28, phrases: [1, 2] },
    accents: { file: 'assets/ambience/chimes.m4a', seconds: 7.5, gap: [40, 100], level: 0.08, peak: 0.29 },
    /* запасной воздух: шум вместо записи, если её не достать */
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
    mode: [0, 2, 3, 5, 7, 8, 10],     // натуральный минор
    pad: { type: 'sine', level: 0.27, octave: 0, register: [110, 330], cutoff: 460, q: 0.7, sweep: 110, sweepSec: 83,
      detune: 9, width: 0.6, interval: 78, attack: 26, release: 34, stagger: 7, driftSec: 59 },
    bass: { level: 0.15, sub: 0.6, glide: 10, cutoff: 190 },
    /* земля: запись сцены (CC0). level — относительно других сцен,
       peak и seconds — измерения петли из scripts/ambience/loop-report.json */
    bed: { file: 'assets/ambience/lullaby.m4a', seconds: 32, peak: 0.45, level: 0.3, tone: 600, spread: 0.2, drift: [49, 37] },
    melody: { level: 0.12, register: [64, 86], gap: [16, 34], rest: 0.4, phrases: [1, 2] },
    accents: { file: 'assets/ambience/chimes.m4a', seconds: 7.5, gap: [90, 180], level: 0.04, peak: 0.29 },
    /* запасной воздух: шум вместо записи, если её не достать */
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
    mode: [0, 2, 4, 6, 7, 9, 11],     // лидийский
    pad: { type: 'sine', level: 0.2, register: [220, 640], cutoff: 1500, q: 0.4, sweep: 560, sweepSec: 97,
      detune: 4, width: 1, interval: 66, attack: 22, release: 30, stagger: 6, driftSec: 67 },
    bass: { level: 0.1, sub: 0.35, glide: 9, cutoff: 300 },
    /* земля: запись сцены (CC0). level — относительно других сцен,
       peak и seconds — измерения петли из scripts/ambience/loop-report.json */
    bed: { file: 'assets/ambience/space.m4a', seconds: 52, peak: 0.17, level: 0.34, tone: 2200, spread: 0.4, drift: [47, 33] },
    melody: { level: 0.14, register: [74, 98], gap: [14, 30], rest: 0.36, phrases: [1, 2] },
    accents: { file: 'assets/ambience/chimes.m4a', seconds: 7.5, gap: [60, 140], level: 0.05, peak: 0.29 },
    /* запасной воздух: шум вместо записи, если её не достать */
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

/** Доля мелодии: 0..1 (ползунок «Голос»). 0 — только полотно и воздух. */
export const normalizeVoice = normalizeVolume;

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

/**
 * Декодирование записи: обещание и обратные вызовы сразу — старый webkit
 * умеет только вариант с колбэками, новый возвращает Promise.
 */
export function decodeAudio(ctx, data) {
  return new Promise((resolve, reject) => {
    let done = false;
    const ok = (buf) => { if (!done) { done = true; resolve(buf); } };
    const fail = (e) => { if (!done) { done = true; reject(e instanceof Error ? e : new Error('decode failed')); } };
    let p;
    try { p = ctx.decodeAudioData(data, ok, fail); } catch (e) { fail(e); return; }
    if (p && typeof p.then === 'function') p.then(ok, fail);
  });
}

/* ---------- движок ----------
   Один экземпляр живёт на всё приложение: музыка не обрывается, когда
   человек уходит в дневник или в чат.

   createAmbientEngine({ AudioContext, setTimeout, clearTimeout, now, random, seed,
                         loadBed, requestIdleCallback })
     — все зависимости подставляются, по умолчанию берутся из globalThis.
     loadBed(file) → Promise<AudioBuffer>: так в тестах подставляют фейк, и
     проверки идут без сети и без декодера. Без него движок сам качает
     файл сцены (fetch) и декодирует его своим AudioContext; если не
     вышло — играет запасной слой шума, а не тишина. */
export function createAmbientEngine(deps = {}) {
  const G = deps.global || globalThis;
  const Ctx = deps.AudioContext || G.AudioContext || G.webkitAudioContext;
  const setTimer = deps.setTimeout || ((fn, ms) => G.setTimeout(fn, ms));
  const clearTimer = deps.clearTimeout || ((id) => G.clearTimeout(id));
  const now = deps.now || (() => Date.now());
  const random = deps.random || makeRng(deps.seed === undefined ? 1 + Math.floor(Math.random() * 1e9) : deps.seed);
  const idle = deps.requestIdleCallback || G.requestIdleCallback || null;

  const listeners = new Set();
  const settings = {
    scene: AMBIENT_SCENES[0].id,
    volume: 0.35,
    minutes: 30,
    texture: 1,      // доля слоя воздуха (запись сцены или запасной шум)
    voice: 1,        // доля мелодии («Голос»)
    reverb: true     // эхо включено
  };

  let ctx = null, master = null, glue = null, dry = null, verbIn = null, wet = null;
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

  /* ---- воздух из записей и голос ---- */
  const buffers = new Map();     // расшифрованные петли: по пути файла
  let bedNodes = [];             // две копии записи: { src, gain, tone, pan, lfo }
  let bedLfos = [];
  let airMode = 'noise';         // 'loading' | 'file' | 'noise'
  let airFile = null;
  let voiceBus = null;           // общая шина мелодии: её и крутит ручка «Голос»
  let voiceNodes = [];           // { gain, oscs, until } — чтобы стоп глушил и запланированное вперёд
  let voiceTimers = [];
  let accentTimer = null;
  let accentNodes = [];
  let motif = [];
  let phrase = null;             // фраза, которая звучит прямо сейчас, — её показывает экран

  const FADE_IN = 4, FADE_OUT = 8;

  /** Запись сцены: кэш по пути, чтобы переключение туда-обратно не качало файл снова. */
  function bedBuffer(file) {
    if (buffers.has(file)) return Promise.resolve(buffers.get(file));
    return Promise.resolve()
      .then(() => loadBed(file))
      .then((buf) => {
        if (!buf || !(Number(buf.duration) > 0)) throw new Error('пустой буфер');
        buffers.set(file, buf);
        return buf;
      });
  }

  /** Штатная загрузка: fetch + decodeAudioData текущего контекста (без второго контекста). */
  function fetchBed(file) {
    const base = (G.document && G.document.baseURI) || (G.location && G.location.href) || '';
    if (typeof G.fetch !== 'function') return Promise.reject(new Error('нет fetch'));
    let url;
    try { url = new URL(file, base || undefined).href; } catch (e) { return Promise.reject(new Error('путь не разобрать')); }
    return G.fetch(url).then((res) => {
      if (!res || !res.ok) throw new Error('http ' + (res && res.status));
      return res.arrayBuffer();
    }).then((data) => {
      if (!ctx || typeof ctx.decodeAudioData !== 'function') throw new Error('нет декодера');
      return decodeAudio(ctx, data);
    });
  }
  const loadBed = deps.loadBed || fetchBed;

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
      voice: settings.voice,
      reverb: settings.reverb,
      /* чем сейчас дышит сцена: 'loading' — запись в пути, 'file' — играет
         запись природы, 'noise' — запасной слой шума (офлайн, старый вебвью) */
      air: { source: playing ? airMode : 'idle', file: airFile },
      motif: motif.slice(),
      phrase: phrase ? {
        notes: phrase.notes.map((n) => ({ name: n.name, hz: n.hz, dur: n.dur })),
        seconds: phrase.seconds
      } : null,
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
  function addLfo(seconds, depth, params, into = lfoNodes, startAt) {
    const targets = (Array.isArray(params) ? params : [params]).filter(Boolean);
    if (!ctx || !targets.length) return null;
    const period = Math.max(1, seconds);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1 / period;
    const g = ctx.createGain();
    g.gain.value = depth;
    osc.connect(g);
    for (const p of targets) g.connect(p);
    into.push({ osc, g });
    /* Дыхание обязано звучать: незапущенный генератор молчит, и слой
       становился ровным, как гул вентилятора. Вход со случайной задержкой
       (до 5 с) плюс разные периоды — фазы двух дыханий никогда не совпадают,
       поэтому петля и полотно не читаются как механические. */
    const t0 = (startAt === undefined ? ctx.currentTime : startAt) + random() * Math.min(5, period * 0.25);
    try { osc.start(t0); } catch (e) {}
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

  /**
   * Гасит запасной слой шума. fadeSec = 0 — сразу (разбор графа),
   * иначе мягко за AIR_CROSSFADE: так запись сменяет шум без щелчка.
   */
  function stopTexture(fadeSec = AIR_CROSSFADE) {
    const myGen = gen;
    const src = textureSrc, gain = textureGain, paths = texturePaths, lfos = textureLfos;
    textureSrc = null; textureGain = null; texturePaths = []; textureLfos = [];
    if (!src) return;
    const t = ctx ? ctx.currentTime : 0;
    const hard = !(fadeSec > 0);
    if (!hard && gain) {
      try {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
        gain.gain.linearRampToValueAtTime(0, t + fadeSec);
      } catch (e) {}
    }
    const at = hard ? undefined : t + fadeSec + 0.05;
    for (const l of lfos) {
      try { at === undefined ? l.osc.stop() : l.osc.stop(at); } catch (e) {}
    }
    try { at === undefined ? src.stop() : src.stop(at); } catch (e) {}
    const dead = [src, gain];
    for (const p of paths) dead.push(...p.nodes);
    const drop = () => {
      for (const l of lfos) {
        try { l.osc.disconnect(); } catch (e) {}
        try { l.g.disconnect(); } catch (e) {}
      }
      for (const node of dead) {
        try { node && node.disconnect && node.disconnect(); } catch (e) {}
      }
    };
    if (hard) drop();
    else releaseTimers.push(setTimer(() => { if (myGen === gen) drop(); }, (fadeSec + 0.2) * 1000));
  }

  /* ---- слой земли: запись природы ----
     Две копии одной петли играют с разными точками входа, в разные
     половины стереополя и дышат каждая своим медленным LFO. Поэтому
     даже 32-секундная петля не читается как петля. */
  function buildBed(scene, buf, startAt) {
    const cfg = scene.bed;
    const level = bedLevel(scene, settings.texture);
    const t0 = startAt === undefined ? ctx.currentTime : startAt;
    const seconds = Number(buf.duration) > 0 ? Number(buf.duration) : cfg.seconds || 30;
    for (let i = 0; i < 2; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = cfg.tone;
      if (tone.Q) tone.Q.value = 0.4;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      let out = gain, pan = null;
      if (typeof ctx.createStereoPanner === 'function') {
        pan = ctx.createStereoPanner();
        pan.pan.value = (i ? 1 : -1) * cfg.spread;
        gain.connect(pan);
        out = pan;
      }
      src.connect(tone);
      tone.connect(gain);
      out.connect(dry);
      if (verbIn) gain.connect(verbIn);
      const drift = (cfg.drift && cfg.drift[i]) || 37;
      addLfo(drift, level * BED_DRIFT_DEPTH, gain.gain, bedLfos, t0);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(level / 2, t0 + AIR_CROSSFADE);
      /* своя точка входа у каждой копии: фазы не совпадают никогда */
      try { src.start(t0, random() * seconds); } catch (e) { try { src.start(t0); } catch (e2) {} }
      bedNodes.push({ src, gain, tone, pan });
    }
  }

  /** Гасит запись: 0 — сразу (разбор графа), иначе кроссфейд 1,5–2,5 с. */
  function stopBed(fadeSec = AIR_CROSSFADE) {
    const myGen = gen;
    const nodes = bedNodes, lfos = bedLfos;
    bedNodes = []; bedLfos = [];
    if (!nodes.length) return;
    const t = ctx ? ctx.currentTime : 0;
    const hard = !(fadeSec > 0);
    const at = hard ? undefined : t + fadeSec + 0.05;
    for (const b of nodes) {
      if (!hard) {
        try {
          b.gain.gain.cancelScheduledValues(t);
          b.gain.gain.setValueAtTime(Math.max(0.0001, b.gain.gain.value), t);
          b.gain.gain.linearRampToValueAtTime(0, t + fadeSec);
        } catch (e) {}
      }
      try { at === undefined ? b.src.stop() : b.src.stop(at); } catch (e) {}
    }
    for (const l of lfos) {
      try { at === undefined ? l.osc.stop() : l.osc.stop(at); } catch (e) {}
    }
    const drop = () => {
      for (const l of lfos) {
        try { l.osc.disconnect(); } catch (e) {}
        try { l.g.disconnect(); } catch (e) {}
      }
      for (const b of nodes) {
        for (const node of [b.src, b.tone, b.gain, b.pan]) {
          try { node && node.disconnect && node.disconnect(); } catch (e) {}
        }
      }
    };
    if (hard) drop();
    else releaseTimers.push(setTimer(() => { if (myGen === gen) drop(); }, (fadeSec + 0.2) * 1000));
  }

  /**
   * Воздух сцены: шумовой слой включается сразу (музыка не молчит ни
   * секунды), а когда запись доезжает — шум уходит кроссфейдом. Если
   * записи нет (офлайн, старый вебвью, ошибка декодера) — шум остаётся.
   */
  function startAir(scene, startAt) {
    buildTexture(scene, startAt);
    const file = scene.bed && scene.bed.file;
    if (!file) { airMode = 'noise'; airFile = null; return; }
    airMode = 'loading';
    airFile = file;
    const myGen = gen;
    bedBuffer(file).then((buf) => {
      if (myGen !== gen || !playing || !ctx || !textureGain) return;
      if (sceneById(settings.scene) !== scene) return;    // человек уже выбрал другую сцену
      buildBed(scene, buf);
      stopTexture(AIR_CROSSFADE);                          // запись сменяет шум
      airMode = 'file';
      emit();
      preloadNext();
    }).catch(() => {
      if (myGen !== gen || !playing) return;
      airMode = 'noise';
      airFile = null;
      emit();
    });
  }

  /**
   * Следующая по списку сцена подгружается в простое: переключение
   * ощущается мгновенным, а память не держит все шесть петель сразу.
   */
  function preloadNext() {
    const i = AMBIENT_SCENES.findIndex((s) => s.id === settings.scene);
    const next = AMBIENT_SCENES[(i + 1) % AMBIENT_SCENES.length];
    if (!next || !next.bed || !next.bed.file) return;
    const myGen = gen;
    const run = () => { if (myGen === gen && playing) bedBuffer(next.bed.file).catch(() => {}); };
    if (typeof idle === 'function') { try { idle(run, { timeout: 8000 }); return; } catch (e) {} }
    releaseTimers.push(setTimer(run, 5000));
  }

  /* ---- голос: мотив поверх аккордов ---- */

  /** Одна нота мотива: четыре частичных тона, мягкая атака и длинный хвост. */
  function bell(hz, at, vel, holdSec, panValue) {
    const out = ctx.createGain();
    out.gain.value = 0;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    let dest = out;
    let pan = null;
    if (typeof ctx.createStereoPanner === 'function') {
      pan = ctx.createStereoPanner();
      pan.pan.value = clamp(panValue, -1, 1);
      out.connect(pan);
      dest = pan;
    }
    dest.connect(voiceBus || dry);
    tone.connect(out);

    const attack = 0.012 + random() * 0.018;
    const decay = Math.max(1.6, holdSec * 1.15);
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(Math.max(0.0002, vel), at + attack);
    /* хвост — экспонентой через setTargetAtTime: так нота тает, а не обрывается */
    out.gain.setTargetAtTime(0.0001, at + attack, decay / 4);

    const partials = [[1, 1, 'sine'], [2.01, 0.3, 'sine'], [3.02, 0.12, 'sine'], [4.98, 0.05, 'triangle']];
    const oscs = [];
    for (const [mult, amp, type] of partials) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz * mult;
      /* живая нестройность: у настоящих колокольчиков она всегда слышна */
      osc.detune.value = (random() - 0.5) * 8;
      const g = ctx.createGain();
      g.gain.value = amp;
      osc.connect(g);
      g.connect(tone);
      try { osc.start(at); osc.stop(at + decay + 0.4); } catch (e) {}
      oscs.push({ osc, g });
    }
    const entry = { gain: out, pan, tone, oscs, until: at + decay + 0.6 };
    voiceNodes.push(entry);
    return entry;
  }

  /** Фраза: ноты мотива запланированы сразу, точно по времени контекста. */
  function schedulePhrase(plan) {
    if (!ctx || !playing || stopping) return;
    for (const n of plan.notes) {
      bell(n.hz, n.at, n.vel, n.dur, n.pan);
      if (n.sub) bell(n.sub.hz, n.sub.at, n.sub.vel, n.sub.dur, n.sub.pan);
    }
    /* Экран показывает мотив только тогда, когда он звучит. План готов заранее
       (первая нота — через 4–27 с), а подписать блок «сейчас звучит» нотами,
       которых ещё нет, было бы враньём. Поэтому публикуем фразу по таймеру в
       момент первой ноты и снимаем, когда растаял последний хвост. */
    const myGen = gen;
    const first = plan.notes[0];
    const lead = Math.max(0, (first ? first.at : ctx.currentTime) - ctx.currentTime);
    voiceTimers.push(setTimer(() => {
      if (myGen !== gen || stopping || !playing) return;
      phrase = plan;
      emit();
    }, lead * 1000));
    /* отыгравшие ноты убираем из списка: стоп должен глушить только живые */
    const until = Math.max(...plan.notes.map((n) => (n.sub ? Math.max(n.at, n.sub.at) : n.at) + Math.max(n.dur, n.sub ? n.sub.dur : 0))) + 5;
    voiceTimers.push(setTimer(() => {
      if (myGen !== gen) return;
      const t = ctx ? ctx.currentTime : 0;
      voiceNodes = voiceNodes.filter((v) => v.until > t);
      if (phrase === plan) { phrase = null; emit(); }
    }, Math.max(1000, (until - ctx.currentTime) * 1000)));
    emit();
  }

  /** Сколько фраз и когда: внутри одного аккорда, всегда не по сетке. */
  function scheduleVoices(chordAt, holdSec, stepIndex) {
    const scene = sceneById(settings.scene);
    if (!scene.melody || settings.voice <= 0) return;
    if (!motif.length) motif = makeMotif(random);
    const chordDegree = degreeOfOffset(scene, scene.steps[mod(stepIndex, scene.steps.length)].offset);
    const count = phraseCount(scene, holdSec, random);
    let at = chordAt + 4 + random() * Math.max(2, holdSec * 0.35 - 4);
    for (let i = 0; i < count; i++) {
      const anchor = chordDegree + STABLE_DEGREES[Math.floor(random() * STABLE_DEGREES.length) % STABLE_DEGREES.length];
      const plan = melodyPlan(scene, { motif, anchorDegree: anchor, chordDegree, at, voice: settings.voice, random });
      schedulePhrase(plan);
      at += plan.seconds + plan.notes[plan.notes.length - 1].dur * 0.4
        + scene.melody.gap[0] + random() * (scene.melody.gap[1] - scene.melody.gap[0]);
    }
  }

  /** Стоп обязан глушить и то, что уже запланировано вперёд. fadeSec = 0 — сразу. */
  function silenceVoices(fadeSec = 0.6) {
    const dead = voiceNodes;
    voiceNodes = [];
    for (const id of voiceTimers) clearTimer(id);
    voiceTimers = [];
    if (!dead.length) return;
    const hard = !(fadeSec > 0) || !ctx;
    const t = ctx ? ctx.currentTime : 0;
    const drop = () => {
      for (const v of dead) {
        for (const o of v.oscs) {
          try { o.osc.disconnect(); } catch (e) {}
          try { o.g.disconnect(); } catch (e) {}
        }
        for (const node of [v.gain, v.tone, v.pan]) {
          try { node && node.disconnect && node.disconnect(); } catch (e) {}
        }
      }
    };
    if (hard) {
      for (const v of dead) { for (const o of v.oscs) { try { o.osc.stop(); } catch (e) {} } }
      drop();
      return;
    }
    for (const v of dead) {
      try {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), t);
        v.gain.gain.linearRampToValueAtTime(0.0001, t + fadeSec);
      } catch (e) {}
      for (const o of v.oscs) { try { o.osc.stop(t + fadeSec + 0.1); } catch (e) {} }
    }
    const myGen = gen;
    releaseTimers.push(setTimer(() => { if (myGen === gen) drop(); }, (fadeSec + 0.3) * 1000));
  }

  /* ---- живые акценты: настоящие колокольчики ---- */
  function accentLoop() {
    accentTimer = null;
    if (!playing || stopping || !ctx) return;
    const scene = sceneById(settings.scene);
    const cfg = scene.accents;
    if (!cfg || !cfg.file) return;
    const gap = cfg.gap[0] + random() * (cfg.gap[1] - cfg.gap[0]);
    accentTimer = setTimer(accentLoop, gap * 1000);
    const myGen = gen;
    bedBuffer(cfg.file).then((buf) => {
      if (myGen !== gen || !playing || stopping || !ctx) return;
      const t = ctx.currentTime;
      const seconds = Number(buf.duration) > 0 ? Number(buf.duration) : 7.5;
      const attack = 3 + random() * 3;
      const hold = 1 + random() * 2;
      const release = 4 + random() * 2;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      let dest = gain, pan = null;
      if (typeof ctx.createStereoPanner === 'function') {
        pan = ctx.createStereoPanner();
        pan.pan.value = (random() - 0.5) * 1;
        gain.connect(pan);
        dest = pan;
      }
      src.connect(gain);
      dest.connect(dry);
      if (verbIn) dest.connect(verbIn);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(cfg.level, t + attack);
      gain.gain.setValueAtTime(cfg.level, t + attack + hold);
      gain.gain.linearRampToValueAtTime(0.0001, t + attack + hold + release);
      try { src.start(t, random() * Math.max(0, seconds - 4), attack + hold + release + 0.5); } catch (e) { try { src.start(t); } catch (e2) {} }
      const total = attack + hold + release + 0.6;
      const entry = { src, gain, pan, until: t + total };
      accentNodes.push(entry);
      const dropAt = myGen;
      releaseTimers.push(setTimer(() => {
        if (dropAt !== gen) return;
        accentNodes = accentNodes.filter((a) => a !== entry);
        for (const node of [entry.src, entry.gain, entry.pan]) {
          try { node && node.disconnect && node.disconnect(); } catch (e) {}
        }
      }, total * 1000));
    }).catch(() => { /* колокольчики не доехали — музыка играет без акцентов */ });
  }

  /** Гасит акценты: и звучащий, и тот, что уже запланирован. fadeSec = 0 — сразу. */
  function stopAccents(fadeSec = 0.6) {
    clearTimer(accentTimer);
    accentTimer = null;
    const dead = accentNodes;
    accentNodes = [];
    if (!dead.length) return;
    const hard = !(fadeSec > 0) || !ctx;
    const t = ctx ? ctx.currentTime : 0;
    const drop = () => {
      for (const a of dead) {
        for (const node of [a.src, a.gain, a.pan]) {
          try { node && node.disconnect && node.disconnect(); } catch (e) {}
        }
      }
    };
    if (hard) {
      for (const a of dead) { try { a.src.stop(); } catch (e) {} }
      drop();
      return;
    }
    for (const a of dead) {
      try {
        a.gain.gain.cancelScheduledValues(t);
        a.gain.gain.setValueAtTime(Math.max(0.0001, a.gain.gain.value), t);
        a.gain.gain.linearRampToValueAtTime(0.0001, t + fadeSec);
        a.src.stop(t + fadeSec + 0.1);
      } catch (e) {}
    }
    const myGen = gen;
    releaseTimers.push(setTimer(() => { if (myGen === gen) drop(); }, (fadeSec + 0.3) * 1000));
  }

  function buildGraph() {
    const scene = sceneById(settings.scene);
    ctx = new Ctx();

    master = ctx.createGain();
    master.gain.value = 0;
    /* Мягкий лимитер на мастере: редкие всплески прибоя и треска не режут
       слух и не складываются с полотном в клиппинг. Там, где узла нет
       (старый вебвью, программный рендер), музыка играет без него —
       сумма слоёв и так ниже единицы. */
    if (typeof ctx.createDynamicsCompressor === 'function') {
      glue = ctx.createDynamicsCompressor();
      try {
        glue.threshold.value = 20 * Math.log10(GLUE.threshold);   // −20 dBFS
        glue.knee.value = GLUE.knee;
        glue.ratio.value = GLUE.ratio;
        glue.attack.value = GLUE.attack;
        glue.release.value = GLUE.release;
      } catch (e) {}
      master.connect(glue);
      glue.connect(ctx.destination);
    } else {
      master.connect(ctx.destination);
    }

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

    /* воздух сцены: запасной шум слышно сразу, запись приезжает следом */
    startAir(scene, ctx.currentTime);

    /* Шина мелодии — её и крутит ручка «Голос». Создаётся последней: к
       первой фразе она уже есть (bell() на всякий случай умеет и без неё),
       а порядок узлов в графе остаётся прежним — проверки считают узлы
       воздуха по их местам. */
    voiceBus = ctx.createGain();
    voiceBus.gain.value = settings.voice;
    voiceBus.connect(dry);
    if (verbIn) voiceBus.connect(verbIn);
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
    /* голос: 1–2 фразы внутри аккорда, каждая со своего случайного момента */
    scheduleVoices(t0, scene.pad.interval, index);
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
    clearTimer(chordTimer); clearTimer(endTimer); clearTimer(fadeTimer); clearTimer(accentTimer);
    chordTimer = endTimer = fadeTimer = accentTimer = null;
    for (const id of releaseTimers) clearTimer(id);
    releaseTimers = [];
    for (const id of voiceTimers) clearTimer(id);
    voiceTimers = [];
    for (const g of groups.slice()) stopGroup(g);
    groups = [];
    for (const l of lfoNodes) {
      try { l.osc.stop(); } catch (e) {}
      try { l.osc.disconnect(); } catch (e) {}
      try { l.g.disconnect(); } catch (e) {}
    }
    lfoNodes = [];
    silenceVoices(0);
    stopAccents(0);
    stopTexture(0);
    stopBed(0);
    for (const node of [bassA, bassB]) {
      try { node && node.stop(); } catch (e) {}
    }
    const all = [bassA, bassB, subGain, bassFilter, bassGain,
      padFilter, padBus, voiceBus, verbIn, wet, dry, glue, master];
    for (const node of all) {
      try { node && node.disconnect && node.disconnect(); } catch (e) {}
    }
    try { ctx && ctx.close && ctx.close(); } catch (e) {}
    ctx = master = glue = dry = verbIn = wet = padBus = padFilter = voiceBus = null;
    bassA = bassB = bassFilter = bassGain = subGain = null;
    airMode = 'noise';
    airFile = null;
    phrase = null;
  }

  function fadeOutAndStop(fadeSec, afterMs) {
    if (!ctx || !master) return;
    const myGen = gen;
    const t = ctx.currentTime;
    /* Стоп гасит не только мастер: ноты, запланированные вперёд, и
       колокольчики замолкают сами, а не дотикают под общим затуханием. */
    silenceVoices(fadeSec);
    stopAccents(fadeSec);
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
      if (patch.voice !== undefined) settings.voice = normalizeVoice(patch.voice);
      if (patch.minutes !== undefined) settings.minutes = clamp(Math.round(Number(patch.minutes) || 0), 0, 240);
      if (patch.reverb !== undefined) settings.reverb = !!patch.reverb;
      const scene = sceneById(settings.scene);
      /* Если человек только выбирает сцену (музыка выключена) — показываем
         её первый аккорд: экран успевает рассказать, что сейчас зазвучит. */
      if (!playing) current = chordVoices(scene, 0, { width: scene.pad.width });
      if (playing && !paused) {
        const t = ctx.currentTime;
        const air = bedLevel(scene, settings.texture);
        try {
          if (master) master.gain.setTargetAtTime(settings.volume, t, 0.5);
          if (wet) wet.gain.setTargetAtTime(settings.reverb ? scene.reverb.wet : 0, t, 1.2);
          if (textureGain) textureGain.gain.setTargetAtTime(textureLevel(), t, 1.5);
          /* ручка «Воздух» крутит и запись сцены — обе копии дышат тише/громче */
          for (const b of bedNodes) b.gain.gain.setTargetAtTime(air / 2, t, 1.5);
          if (voiceBus) voiceBus.gain.setTargetAtTime(settings.voice, t, 0.8);
          if (padFilter) padFilter.frequency.setTargetAtTime(scene.pad.cutoff, t, 3);
          if (bassFilter) bassFilter.frequency.setTargetAtTime(scene.bass.cutoff, t, 3);
          if (bassGain) bassGain.gain.setTargetAtTime(scene.bass.level, t, 3);
          if (subGain) subGain.gain.setTargetAtTime(scene.bass.sub, t, 3);
        } catch (e) {}
        /* Смена сцены на ходу: полотно дотянет текущий аккорд и перейдёт
           к своему следующему, а воздух меняется сразу и мягко — иначе
           человек выбрал «дождь», а слышит волны до конца сессии.
           Мотив остаётся прежним: тема одна на сессию, меняется тональность. */
        if (before !== settings.scene) {
          stopBed(AIR_CROSSFADE);
          stopTexture(AIR_CROSSFADE);
          startAir(scene, ctx.currentTime);
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
      /* тема одной сессии: мотив сочиняется сейчас и дальше только
         транспонируется под аккорды — именно повтор узнаётся как музыка */
      motif = settings.voice > 0 ? makeMotif(random) : [];
      phrase = null;
      airMode = 'noise';
      airFile = null;
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
      /* живые акценты: первый приходит, пока полотно ещё входит (раньше
         обычного промежутка), дальше — только случайные интервалы */
      if (scene.accents && scene.accents.file) {
        const gapLo = scene.accents.gap[0];
        accentTimer = setTimer(accentLoop, (gapLo * 0.4 + random() * gapLo * 0.6) * 1000);
      }
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
