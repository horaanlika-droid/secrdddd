/* ============================================================
   Дибитишка · бинауральные ритмы (Web Audio)
   ------------------------------------------------------------
   Бинауральный ритм — это не запись и не файл, а эффект восприятия:
   в каждое ухо приходит свой синус, частоты отличаются меньше чем на
   ~30 Гц, и слуховой тракт «достраивает» третий звук — мягкий пульс
   с частотой этой разницы (200 Гц слева + 206 Гц справа = слышно 6 Гц).
   Отсюда три следствия, на которых держится весь модуль:

     1. Файл не нужен. Тон строится двумя осцилляторами прямо на
        устройстве: ноль мегабайт в паке, работает офлайн, ничего не
        тянет с сети и не требует лицензий на музыку.
     2. Нужны наушники. На колонках оба тона смешиваются в воздухе —
        получается обычная интерференция, а не ритм в голове.
     3. Несущая должна быть низкой (условно до 1000 Гц), а разница —
        меньше ~30 Гц, иначе слышно просто два разных тона.

   Модуль нарочно не знает про DOM: математика тонов — чистые функции,
   а движок получает AudioContext снаружи (в браузере — window.AudioContext,
   в тестах — подставной). Поэтому поведение можно проверить без звука:
   npm run sound-test.
   ============================================================ */

/* Границы, за которыми эффект перестаёт быть бинауральным. */
export const MAX_BEAT = 28;        // Гц: выше мозг слышит два тона, а не пульс
export const MIN_BEAT = 0.5;
export const MAX_CARRIER = 950;    // Гц: выше ~1000 иллюзия слабеет
export const MIN_CARRIER = 80;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round1 = (v) => Math.round(v * 10) / 10;

/* Четыре пресета — по диапазонам мозговых ритмов. Честно пишем, что это
   «для чего берут», а не «что лечит»: исследования неоднородны. */
export const BINAURAL_PRESETS = [
  {
    id: 'theta', title: 'Тета', band: '4–8 Гц', beat: 6, carrier: 174, tint: 'lavender',
    tag: 'тревога', when: 'когда мысли крутятся по кругу', minutes: 20,
    text: 'Ритм глубокого расслабления и медитации. Его чаще всего берут, чтобы спустить тревогу и полежать с закрытыми глазами.'
  },
  {
    id: 'delta', title: 'Дельта', band: '0,5–4 Гц', beat: 2, carrier: 136, tint: 'peony',
    tag: 'сон', when: 'перед сном', minutes: 30,
    text: 'Самый медленный пульс — тот темп, в котором тело обычно засыпает. Хорошо ставить таймером и не дослушивать до конца.'
  },
  {
    id: 'alpha', title: 'Альфа', band: '8–13 Гц', beat: 10, carrier: 210, tint: 'sky',
    tag: 'спокойный фокус', when: 'днём, между делами', minutes: 15,
    text: 'Спокойное бодрствование: тело отдыхает, голова остаётся ясной. Подходит, чтобы просто посидеть четверть часа без телефона.'
  },
  {
    id: 'beta', title: 'Бета', band: '13–30 Гц', beat: 15, carrier: 240, tint: 'leaf',
    tag: 'концентрация', when: 'нужно собраться', minutes: 15,
    text: 'Рабочий ритм. Небольшой сессией и не перед сном: он бодрит, а не убаюкивает.'
  }
];

export const presetById = (id) => BINAURAL_PRESETS.find(p => p.id === id) || BINAURAL_PRESETS[0];

/**
 * Частоты для левого и правого уха. Разница ровно равна пульсу:
 * тоны ставятся симметрично вокруг несущей, поэтому right - left === beat
 * без накопления ошибки округления.
 */
export function tonePair(preset, opts = {}) {
  const p = preset && preset.beat ? preset : presetById(preset);
  const wanted = Number(opts.carrier);
  const carrier = clamp(
    Number.isFinite(wanted) && wanted > 0 ? wanted : p.carrier,
    MIN_CARRIER, MAX_CARRIER
  );
  const beat = clamp(Number(p.beat), MIN_BEAT, MAX_BEAT);
  return {
    left: round1(carrier - beat / 2),
    right: round1(carrier + beat / 2),
    beat: round1(beat),
    carrier: round1(carrier)
  };
}

/** Громкость: 0..1, чтобы слайдер не мог оглушить. */
export const normalizeVolume = (v) => clamp(Number(v) > 0 ? Number(v) : 0, 0, 1);

export const formatClock = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Есть ли вообще Web Audio (старый вебвью может не иметь). */
export const audioSupported = (g = globalThis) =>
  !!(g.AudioContext || g.webkitAudioContext) && typeof (g.AudioContext || g.webkitAudioContext) === 'function';

/* Розоватый шум: белый, пропущенный через простое Voss-подобное сглаживание.
   Подложка нужна потому, что чистый синус на 20 минут звучит утомительно. */
function noiseBuffer(ctx, seconds = 4) {
  const len = Math.max(1, Math.floor((ctx.sampleRate || 44100) * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate || 44100);
  const data = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.997 * b0 + white * 0.0555179;
    b1 = 0.963 * b1 + white * 0.0750759;
    b2 = 0.57 * b2 + white * 0.153852;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
  }
  return buf;
}

/**
 * Движок плеера. Один экземпляр живёт на всё приложение, поэтому звук
 * не обрывается при переходе между экранами.
 *
 * createBinauralEngine({ AudioContext, setTimeout, clearTimeout, now })
 *   — все четыре зависимости подставляются, по умолчанию берутся из globalThis.
 */
export function createBinauralEngine(deps = {}) {
  const G = deps.global || globalThis;
  const Ctx = deps.AudioContext || G.AudioContext || G.webkitAudioContext;
  const setTimer = deps.setTimeout || ((fn, ms) => G.setTimeout(fn, ms));
  const clearTimer = deps.clearTimeout || ((id) => G.clearTimeout(id));
  const now = deps.now || (() => Date.now());

  const listeners = new Set();
  const settings = {
    preset: 'theta',
    carrier: 0,           // 0 = несущая из пресета
    volume: 0.35,
    minutes: 20,
    noise: true
  };
  let ctx = null, master = null, merger = null;
  let gen = 0;   // поколение звука: отложенное затухание не должно убить новый запуск
  let oscL = null, oscR = null, noiseSrc = null, noiseGain = null;
  let endTimer = null, fadeTimer = null;
  let playing = false, paused = false;
  /* «Стоп» нажат, последние 0,6 с звук затухает: снаружи сессия уже
     закончилась (плашка ушла, кнопка снова «Включить»), а граф ещё
     разбирается. Без этого флага интерфейс подвисал бы на полсекунды. */
  let stopping = false;
  let endsAt = 0, pausedLeft = 0, totalMs = 0;

  const emit = () => listeners.forEach((fn) => { try { fn(snapshot()); } catch (e) {} });
  const snapshot = () => ({
    playing: playing && !stopping, paused,
    preset: settings.preset,
    carrier: settings.carrier,
    volume: settings.volume,
    minutes: settings.minutes,
    noise: settings.noise,
    secondsLeft: secondsLeft(),
    totalSeconds: Math.round(totalMs / 1000),
    tones: tonePair(presetById(settings.preset), settings)
  });
  function secondsLeft() {
    if (!playing || stopping) return 0;
    if (paused) return Math.max(0, Math.round(pausedLeft / 1000));
    return Math.max(0, Math.round((endsAt - now()) / 1000));
  }

  const FADE_IN = 4, FADE_OUT = 8;

  function buildGraph() {
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    merger = ctx.createChannelMerger(2);
    merger.connect(master);

    const { left, right } = tonePair(presetById(settings.preset), settings);
    oscL = ctx.createOscillator(); oscL.type = 'sine'; oscL.frequency.value = left;
    oscR = ctx.createOscillator(); oscR.type = 'sine'; oscR.frequency.value = right;
    /* Каждый осциллятор — в свой вход мерджера: канал 0 = левое ухо,
       канал 1 = правое. Именно так сигнал остаётся раздельным. */
    oscL.connect(merger, 0, 0);
    oscR.connect(merger, 0, 1);

    if (settings.noise) {
      noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuffer(ctx);
      noiseSrc.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 780;
      noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.5;
      noiseSrc.connect(lp); lp.connect(noiseGain); noiseGain.connect(master);
    }
  }

  function teardown() {
    clearTimer(endTimer); clearTimer(fadeTimer);
    endTimer = fadeTimer = null;
    for (const node of [noiseSrc, oscL, oscR]) { try { node && node.stop(); } catch (e) {} }
    for (const node of [noiseSrc, noiseGain, oscL, oscR, merger, master]) {
      try { node && node.disconnect && node.disconnect(); } catch (e) {}
    }
    try { ctx && ctx.close && ctx.close(); } catch (e) {}
    ctx = master = merger = oscL = oscR = noiseSrc = noiseGain = null;
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
      if (myGen !== gen) return;   // за это время запустили новый звук — не трогаем его
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
      if (patch.preset && presetById(patch.preset)) settings.preset = patch.preset;
      if (patch.carrier !== undefined) settings.carrier = clamp(Number(patch.carrier) || 0, 0, MAX_CARRIER);
      if (patch.volume !== undefined) settings.volume = normalizeVolume(patch.volume);
      if (patch.minutes !== undefined) settings.minutes = clamp(Number(patch.minutes) || 20, 1, 180);
      if (patch.noise !== undefined) settings.noise = !!patch.noise;
      /* Если уже звучит — перестраиваем на лету, не обрывая звук. */
      if (playing && !paused) {
        const { left, right } = tonePair(presetById(settings.preset), settings);
        try {
          if (oscL) oscL.frequency.setTargetAtTime(left, ctx.currentTime, 0.6);
          if (oscR) oscR.frequency.setTargetAtTime(right, ctx.currentTime, 0.6);
          if (master) master.gain.setTargetAtTime(settings.volume, ctx.currentTime, 0.4);
          if (noiseGain) noiseGain.gain.setTargetAtTime(settings.noise ? 0.5 : 0, ctx.currentTime, 0.6);
        } catch (e) {}
      }
      emit();
      return snapshot();
    },

    start() {
      if (!Ctx) { const e = new Error('unsupported'); e.reason = 'unsupported'; throw e; }
      /* Перезапуск: старый граф разбираем сразу и синхронно. Отложенное
         затухание здесь нельзя — его таймер закрыл бы уже новый контекст. */
      gen++;
      stopping = false;
      if (playing || ctx) {
        clearTimer(endTimer); clearTimer(fadeTimer);
        endTimer = fadeTimer = null;
        teardown();
        playing = false; paused = false;
      }
      buildGraph();
      totalMs = settings.minutes * 60000;
      endsAt = now() + totalMs;
      pausedLeft = 0;
      playing = true; paused = false;

      const t = ctx.currentTime;
      try {
        master.gain.setValueAtTime(0, t);
        master.gain.linearRampToValueAtTime(settings.volume, t + FADE_IN);
      } catch (e) {}
      oscL.start(t); oscR.start(t);
      if (noiseSrc) noiseSrc.start(t);
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();

      endTimer = setTimer(() => fadeOutAndStop(FADE_OUT, FADE_OUT * 1000),
        Math.max(0, totalMs - FADE_OUT * 1000));
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

    /** Останавливает с коротким затуханием; настройки человека остаются. */
    stop() {
      if (!playing || stopping) return snapshot();
      stopping = true;
      fadeOutAndStop(0.6, 620);
      return snapshot();
    },

    /** Полный сброс: звук убран, подписчики сняты — зовётся при выгрузке. */
    destroy() {
      gen++;
      clearTimer(endTimer); clearTimer(fadeTimer);
      endTimer = fadeTimer = null;
      teardown();
      playing = false; paused = false; stopping = false;
      listeners.clear();
    }
  };
  return api;
}
