/* Фото из галереи: EXIF 1..8, включая зеркальные ориентации и старые WebView. */
export function jpegOrientation(buffer) {
  const v = new DataView(buffer);
  const result = { orientation: 1, offset: -1, littleEndian: false };
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return result;
  let p = 2;
  try {
    while (p + 4 <= v.byteLength) {
      if (v.getUint8(p) !== 0xff) break;
      const marker = v.getUint8(p + 1);
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xff) { p++; continue; }
      const length = v.getUint16(p + 2);
      if (length < 2 || p + 2 + length > v.byteLength) break;
      const end = p + 2 + length;
      if (marker === 0xe1 && length >= 16 && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) {
        const tiff = p + 10;
        const order = v.getUint16(tiff);
        if (order !== 0x4949 && order !== 0x4d4d) break;
        const le = order === 0x4949;
        if (v.getUint16(tiff + 2, le) !== 42) break;
        const ifd = tiff + v.getUint32(tiff + 4, le);
        if (ifd < tiff + 8 || ifd + 2 > end) break;
        const count = v.getUint16(ifd, le);
        for (let i = 0; i < count; i++) {
          const at = ifd + 2 + i * 12;
          if (at + 12 > end) break;
          if (v.getUint16(at, le) === 0x0112 && v.getUint16(at + 2, le) === 3 && v.getUint32(at + 4, le) === 1) {
            const orientation = v.getUint16(at + 8, le);
            return orientation >= 1 && orientation <= 8 ? { orientation, offset: at + 8, littleEndian: le } : result;
          }
        }
      }
      p = end;
    }
  } catch { /* Повреждённый EXIF не мешает декодировать само изображение. */ }
  return result;
}

export function orientationTransform(orientation, w, h) {
  return ({
    1: [1, 0, 0, 1, 0, 0], 2: [-1, 0, 0, 1, w, 0],
    3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0],
    7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w]
  })[orientation] || [1, 0, 0, 1, 0, 0];
}

async function decodedImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { image: bitmap, orientation: 1, close: () => bitmap.close() };
    } catch { /* Safari/HEIC: пробуем декодер <img>. */ }
  }
  // Нормализуем EXIF до 1 ДО <img>, затем поворачиваем сами.
  // Так нет двойного поворота в браузере, который сам понимает EXIF.
  const buffer = await file.arrayBuffer();
  const info = jpegOrientation(buffer);
  if (info.offset >= 0) new DataView(buffer).setUint16(info.offset, 1, info.littleEndian);
  const url = URL.createObjectURL(new Blob([buffer], { type: file.type || 'image/jpeg' }));
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Фото не удалось прочитать. Попробуй JPEG, PNG или WebP.'));
      img.src = url;
    });
    return { image, orientation: info.orientation, close: () => URL.revokeObjectURL(url) };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

export async function compressImage(file, max = 1400, quality = .82) {
  if (!file?.size || file.size > 25 * 1024 * 1024) throw new Error('Выбери фото до 25 МБ.');
  const decoded = await decodedImage(file);
  try {
    const { image, orientation } = decoded;
    const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
    if (!w || !h || w * h > 100000000) throw new Error('Фото слишком большое. Попробуй уменьшенную копию.');
    const scale = Math.min(1, max / Math.max(w, h));
    const sw = Math.max(1, Math.round(w * scale)), sh = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    const swap = orientation >= 5;
    canvas.width = swap ? sh : sw; canvas.height = swap ? sw : sh;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Браузер не смог обработать фото.');
    g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.transform(...orientationTransform(orientation, sw, sh));
    g.drawImage(image, 0, 0, sw, sh);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Не получилось уменьшить фото. Попробуй другое.');
    return blob;
  } finally { decoded.close(); }
}
