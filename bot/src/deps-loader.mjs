/* ============================================================
   дибитишка · ESM-хук «зависимости из запасной папки»
   ------------------------------------------------------------
   Подключается из src/ensure-deps.js ТОЛЬКО в крайнем случае:
   когда папка приложения доступна лишь на чтение и npm не смог
   положить node_modules ни в bot/, ни в корень репозитория.
   Тогда зависимости ставятся во временную папку, а этот хук учит
   node искать bare-импорты (grammy, pngjs, jpeg-js) ещё и там.

   Обычный запуск этот файл не трогает.
   ============================================================ */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let roots = [];

/** node вызывает initialize() в отдельном потоке с данными из register(). */
export function initialize(data) {
  roots = normalize((data && data.roots) || process.env.DIBITISHKA_DEPS_DIR || []);
}

function normalize(input) {
  const list = Array.isArray(input) ? input : String(input).split(path.delimiter);
  return list
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    // нам нужен родитель папки node_modules — именно оттуда node ищет пакеты
    .map((p) => (path.basename(p) === 'node_modules' ? path.dirname(p) : p))
    .map((p) => path.resolve(p));
}

const isBare = (spec) =>
  !spec.startsWith('node:') &&
  !spec.startsWith('.') &&
  !spec.startsWith('/') &&
  !/^[a-z][a-z0-9+.-]*:/i.test(spec);

export async function resolve(specifier, context, nextResolve) {
  if (!roots.length || !isBare(specifier)) return nextResolve(specifier, context);
  for (const root of roots) {
    const parentURL = pathToFileURL(path.join(root, '__dibitishka_probe__.js')).href;
    try {
      return await nextResolve(specifier, { ...context, parentURL });
    } catch {
      /* ищем в следующей папке */
    }
  }
  return nextResolve(specifier, context);
}
