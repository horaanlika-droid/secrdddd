/* Локальный экспорт доски. Фото/заметки не уходят в сторонний сервис.
   PDF содержит растровые страницы: кириллица и эмодзи не зависят от PDF-шрифтов. */
const W = 1200, H = 1697, PAD = 68, GAP = 36, COL = (W - PAD * 2 - GAP) / 2;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const THEMES = {
  sky: ['#EAF1FE','#D7E5FB'], peony: ['#FBEFF3','#F5DBE5'], grass: ['#F3F4E5','#E3E7CB'],
  sand: ['#FCF5EB','#F1E1CB'], lavender: ['#F1EFFA','#E1DCF4'], paper: ['#FDFBF6','#FDFBF6'],
  dots: ['#F7FAFF','#F7FAFF'], grid: ['#FBFDFF','#FBFDFF'], stars: ['#E7EEFC','#D5E0F8']
};
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const blobOf = (c, type = 'image/png', quality) => new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('Не удалось собрать файл.')), type, quality));

function rounded(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
// Сохраняет переносы стихов, длинные URL/слова разбивает, не обрезает хвост.
export function textLines(g, text, width) {
  const lines = [];
  for (const paragraph of String(text || '').split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && g.measureText(line + ' ' + word).width <= width) { line += ' ' + word; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const char of word) {
        if (line && g.measureText(line + char).width > width) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

async function loadImage(src, signal) {
  if (!src) return null;
  return new Promise(resolve => {
    const img = new Image();
    let done = false;
    const finish = value => {
      if (done) return; done = true; clearTimeout(timeout);
      img.onload = img.onerror = null; signal?.removeEventListener('abort', abort);
      if (!value) img.src = ''; resolve(value);
    };
    const abort = () => finish(null);
    const timeout = setTimeout(abort, 8000);
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    // Без CORS внешняя GIF сделала бы весь canvas «tainted». Вместо этого —
    // честная заглушка и предупреждение; свои фото из IndexedDB экспортируются всегда.
    if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => finish(img); img.onerror = abort; img.src = src;
  });
}
function cover(g, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale, sh = h / scale;
  g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}
function background(g, board, photo) {
  if (photo) { cover(g, photo, 0, 0, W, H); g.fillStyle = '#ffffff33'; g.fillRect(0, 0, W, H); return; }
  const colors = THEMES[board.bg] || THEMES.sky;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, colors[0]); grad.addColorStop(1, colors[1]); g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#CDD9E777'; g.lineWidth = 1;
  if (board.bg === 'paper' || board.bg === 'grid') {
    for (let y = 0; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    if (board.bg === 'grid') for (let x = 0; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  }
  if (board.bg === 'dots' || board.bg === 'stars') {
    g.fillStyle = board.bg === 'stars' ? '#ffffff' : '#DCE6FA';
    const step = board.bg === 'stars' ? 110 : 30;
    for (let y = 15; y < H; y += step) for (let x = 15; x < W; x += step) { g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill(); }
  }
}

export async function renderBoardPages(board, { mediaUrl, signal } = {}) {
  if (document.fonts?.ready) await document.fonts.ready;
  const warnings = new Set();
  const photo = board.bg === 'photo' ? await loadImage(await mediaUrl(board.bgKey), signal) : null;
  if (board.bg === 'photo' && !photo) warnings.add('Фото фона недоступно — использован светлый фон.');
  const pages = [], measure = canvas(COL, 100).getContext('2d');
  measure.font = `500 26px ${FONT}`;
  let page, g, heights, startY;
  const newPage = () => {
    if (pages.length >= 12) throw Object.assign(new Error('Доска получилась больше 12 страниц. Раздели её на несколько досок — так получится сохранить всё без перегрузки памяти телефона.'), { name: 'BoardExportLimit' });
    page = canvas(W, H); g = page.getContext('2d'); background(g, board, photo);
    g.fillStyle = '#21314D'; g.font = `800 44px ${FONT}`;
    const title = textLines(g, board.title, W - PAD * 2);
    title.forEach((line, i) => g.fillText(line, PAD, 95 + i * 54));
    startY = 100 + title.length * 54;
    heights = [startY, startY]; pages.push(page);
  };
  newPage();
  const sorted = [...(board.tiles || [])].sort((a, b) => (a.created || 0) - (b.created || 0));
  for (const t of sorted) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const src = t.kind !== 'note' ? await mediaUrl(t.src) : '';
    const img = t.kind !== 'note' ? await loadImage(src, signal) : null;
    if (t.kind !== 'note' && !img) warnings.add('Некоторые картинки недоступны или запрещают экспорт. Их места отмечены на страницах.');
    const text = t.kind === 'note' ? t.text || '' : t.caption || '';
    const allLines = textLines(measure, text, COL - 48);
    const tags = textLines(measure, (t.tags || []).map(x => '#' + x).join(' '), COL - 48);
    const chunks = [];
    // Весь стих/текст сохраняется, в том числе если ему нужны несколько страниц.
    const linesPerCard = Math.max(8, Math.floor((H - startY - 180) / 35));
    const imageHeight = t.kind !== 'note' ? (t.size === 's' ? 300 : t.size === 'l' ? 500 : 390) : 0;
    const firstCapacity = Math.max(4, linesPerCard - Math.ceil(imageHeight / 35) - tags.length);
    chunks.push(allLines.slice(0, firstCapacity));
    for (let i = firstCapacity; i < allLines.length; i += linesPerCard - tags.length) chunks.push(allLines.slice(i, i + linesPerCard - tags.length));
    for (let part = 0; part < chunks.length; part++) {
      const lines = chunks[part], ih = part === 0 ? imageHeight : 0;
      const ch = Math.max(120, ih + 48 + lines.length * 35 + tags.length * 30 + (part ? 30 : 0));
      let col = heights[0] <= heights[1] ? 0 : 1;
      if (heights[col] + ch > H - 100) { newPage(); col = 0; }
      const card = canvas(COL, ch), cg = card.getContext('2d');
      cg.fillStyle = t.kind === 'note' ? '#FFF6F7' : '#fff'; rounded(cg, 0, 0, COL, ch, 24); cg.fill();
      cg.save(); rounded(cg, 0, 0, COL, ch, 24); cg.clip();
      if (ih) {
        if (img) cover(cg, img, 12, 12, COL - 24, ih - 12);
        else {
          cg.fillStyle = '#EAF0F9'; cg.fillRect(12, 12, COL - 24, ih - 12);
          cg.fillStyle = '#647491'; cg.font = `500 24px ${FONT}`; cg.fillText('Картинка недоступна', 32, ih / 2);
        }
      }
      let y = ih + 40;
      if (part) { cg.font = `500 19px ${FONT}`; cg.fillStyle = '#6B7B94'; cg.fillText('Продолжение', 24, y); y += 30; }
      cg.fillStyle = '#293954'; cg.font = `500 26px ${FONT}`;
      lines.forEach(line => { cg.fillText(line, 24, y); y += 35; });
      cg.fillStyle = '#677AA0'; cg.font = `600 21px ${FONT}`;
      tags.forEach(line => { cg.fillText(line, 24, y); y += 30; }); cg.restore();
      const x = PAD + col * (COL + GAP), top = heights[col];
      const angle = Math.max(-8, Math.min(8, t.rot || 0)) * Math.PI / 180;
      const scale = Math.min(COL / (COL * Math.cos(angle) + ch * Math.abs(Math.sin(angle))), ch / (ch * Math.cos(angle) + COL * Math.abs(Math.sin(angle))));
      g.save(); g.translate(x + COL / 2, top + ch / 2); g.rotate(angle); g.scale(scale, scale);
      g.shadowColor = '#23395824'; g.shadowBlur = 18; g.shadowOffsetY = 6; g.drawImage(card, -COL / 2, -ch / 2); g.restore();
      heights[col] += ch + GAP;
    }
  }
  if (!sorted.length) { g.font = `500 28px ${FONT}`; g.fillStyle = '#526783'; g.fillText('Место для маленьких радостей', PAD, startY + 65); }
  for (let i = 0; i < pages.length; i++) {
    const ctx = pages[i].getContext('2d');
    ctx.font = `500 20px ${FONT}`; ctx.fillStyle = '#536583';
    ctx.fillText('Дибитишка · доска впечатлений', PAD, H - 42);
    ctx.textAlign = 'right'; ctx.fillText(`${i + 1} / ${pages.length}`, W - PAD, H - 42);
  }
  return { pages, warnings: [...warnings] };
}

export async function boardPdf(pages) {
  const encoder = new TextEncoder(), objects = [], chunks = [encoder.encode('%PDF-1.4\n% Dibi board\n')], offsets = [0];
  const bytes = s => encoder.encode(s);
  objects[1] = bytes('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = bytes(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  for (let i = 0; i < pages.length; i++) {
    const id = 3 + i * 3;
    const jpg = new Uint8Array(await (await blobOf(pages[i], 'image/jpeg', .92)).arrayBuffer());
    const draw = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
    objects[id] = bytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    objects[id + 1] = [bytes(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`), jpg, bytes('\nendstream')];
    objects[id + 2] = bytes(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  }
  let length = chunks[0].length;
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = length;
    const parts = [bytes(`${i} 0 obj\n`), ...[objects[i]].flat(), bytes('\nendobj\n')];
    for (const part of parts) { chunks.push(part); length += part.length; }
  }
  const xref = length;
  chunks.push(bytes(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Blob(chunks, { type: 'application/pdf' });
}
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function printBoardPages(pages, title) {
  const frame = document.createElement('iframe');
  frame.title = 'Печать доски'; frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0';
  document.body.append(frame);
  const doc = frame.contentDocument;
  const style = doc.createElement('style');
  style.textContent = '@page{size:A4;margin:0}html,body{margin:0}img{width:210mm;height:297mm;display:block;break-after:page;page-break-after:always}img:last-child{break-after:auto;page-break-after:auto}';
  doc.head.append(style); doc.title = title;
  let pending = pages.length;
  const ready = () => {
    if (--pending > 0) return;
    frame.contentWindow.focus(); frame.contentWindow.print();
  };
  for (const page of pages) { const img = doc.createElement('img'); img.onload = ready; img.onerror = ready; img.src = page.toDataURL('image/png'); doc.body.append(img); }
  frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
  setTimeout(() => frame.remove(), 120000);
}
export { blobOf as boardPageBlob };
