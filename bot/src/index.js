/* ============================================================
   дибитишка · телеграм-бот — ТОЧКА ВХОДА
   ------------------------------------------------------------
   Здесь нарочно нет ни одного стороннего import.

   Раньше первой строкой стояло `import { Bot } from 'grammy'`, и если
   node_modules в образе/на хосте не оказывалось, процесс умирал вот так:

     Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'grammy'
         imported from /app/bot/src/index.js

   — то есть до нашего кода дело не доходило вообще, и починить это
   изнутри было невозможно. Теперь точка входа сначала гарантированно
   доводит зависимости до места (src/ensure-deps.js ставит их сам,
   терминал не нужен), и только потом грузит приложение (src/app.js).

   Запуск любой: `npm start`, `node bot/src/index.js`, CMD в Docker —
   все идут через этот файл.
   ============================================================ */

/* бот живёт долго: одна непрошеная ошибка в промисе не должна ронять контейнер */
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', (e && (e.stack || e.message)) || e);
});

const { ensureDeps } = await import('./ensure-deps.js');

try {
  await ensureDeps({ install: true });
} catch (e) {
  console.error('\n[bot] не стартую: ' + e.message + '\n');
  process.exit(1);
}

await import('./app.js');
