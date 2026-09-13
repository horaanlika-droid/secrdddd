/* Вырезание белого/светлого фона у картинок для рассылок.
   Чистый JS (jpeg-js + pngjs), без нативных зависимостей —
   ставится на любой бот-хостинг. */
import JPEG from 'jpeg-js';
import { PNG } from 'pngjs';

const isBg = (rgba, o) => {
  if (rgba[o + 3] === 0) return true;
  const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mn >= 210 && mx - mn <= 16; // почти белый и почти бесцветный
};

/**
 * Принимает Buffer картинки (png или jpeg), возвращает Buffer PNG
 * с прозрачным фоном: заливка с краёв по светлому фону.
 */
export function removeWhiteBackground(buf, isPng = false) {
  let w, h, rgba;
  if (isPng) {
    const png = PNG.sync.read(buf);
    w = png.width; h = png.height; rgba = png.data;
  } else {
    const dec = JPEG.decode(buf, { maxMemoryUsageInMB: 1024, formatAsByteIndexed: false });
    w = dec.width; h = dec.height; rgba = dec.data;
  }
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (seen[i]) return;
    if (isBg(rgba, i * 4)) { seen[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    rgba[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) push(nx, ny);
    }
  }
  const out = new PNG({ width: w, height: h });
  out.data = rgba;
  return PNG.sync.write(out);
}
