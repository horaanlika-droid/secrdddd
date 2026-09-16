#!/usr/bin/env node
/* Behaviour checks against the real ES modules in jsdom. No keys or network.
   Run with --experimental-vm-modules (Node 18+). Browser geometry is checked
   separately by browser-smoke.mjs, not guessed from jsdom's empty layout. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = JSON.parse(await fs.readFile(path.join(ROOT, 'app/content/content.json'), 'utf8'));
const html = (await fs.readFile(path.join(ROOT, 'app/index.html'), 'utf8')).replace(/<script[\s\S]*?<\/script>/g, '');
const DB = 'dibitishka.v1', BOARDS = 'dibitishka.boards.v1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('  ✓ ' + name); }
async function until(fn, description = 'condition') {
  const end = Date.now() + 5000;
  while (!fn()) { if (Date.now() > end) throw new Error('Timed out: ' + description); await sleep(15); }
}
async function app(seed = {}, { boardSeed, privateMode = false, apiContent = null, config = null, audio = null } = {}) {
  const dom = new JSDOM(html, { url: 'https://dibi.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const objectUrls = new Map(); let objectId = 0;
  w.DIBI_CONFIG = Object.assign({ bot_public_url: apiContent ? 'https://bot.dibi.test' : '', bot_username: 'test', subscription: { trial_days: 7 } }, config || {});
  /* v40: install_hint_seen — подсказка про иконку всплывает сама. В общих
     прогонах она считается показанной, чтобы не закрывать чужие листы в самый
     неподходящий момент; её собственное поведение проверяется отдельным
     запуском (см. «pops up by itself once»). */
  w.localStorage.setItem(DB, JSON.stringify({ onboarded: true, trial_started_at: Date.now(), mood_schema: 2, install_hint_seen: true, ...seed }));
  if (boardSeed !== undefined) w.localStorage.setItem(BOARDS, JSON.stringify(boardSeed));
  w.fetch = async url => {
    const href = String(url);
    const body = href.includes('pay-url') ? { ok: true, url: 'https://t.me/tribute/app?startapp=dSmoke' }
      : href.startsWith('https://bot.dibi.test/content') ? apiContent
      : href.includes('content') ? CONTENT : { ok: true, ai: false, enabled: false, items: [] };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  /* v43: Web Audio подставляется записывающим моком — иначе jsdom честно
     говорит «AudioContext не умею» и плеер бинауральных ритмов не проверить. */
  if (audio) w.AudioContext = audio.Ctx;
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.AbortController = AbortController; w.Blob = Blob; w.File = File; w.structuredClone = structuredClone;
  w.indexedDB = privateMode ? { open() { throw new Error('SecurityError'); } } : new IDBFactory(); w.IDBKeyRange = IDBKeyRange;
  w.URL.createObjectURL = blob => { const url = 'blob:https://dibi.test/' + ++objectId; objectUrls.set(url, blob); return url; };
  w.URL.revokeObjectURL = url => objectUrls.delete(url);
  w.requestAnimationFrame = callback => { callback(Date.now()); return 1; };
  w.scrollTo = () => {}; w.matchMedia = () => ({ matches: false });
  w.createImageBitmap = async () => ({ width: 800, height: 600, close() {} });
  w.Image = function() {
    const img = w.document.createElement('img'); img.width = 512; img.height = 512;
    Object.defineProperty(img, 'src', { get() { return this.getAttribute('src'); }, set(value) { this.setAttribute('src', value); queueMicrotask(() => this.onload?.()); } });
    return img;
  };
  const context2d = new Proxy({
    measureText: text => ({ width: [...String(text)].length * 12 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} })
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  w.HTMLCanvasElement.prototype.getContext = () => context2d;
  w.HTMLCanvasElement.prototype.toBlob = function(cb, type) { cb(new Blob(['test image bytes'], { type: type || 'image/png' })); };
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
  w.HTMLAnchorElement.prototype.click = function() {}; // Do not navigate jsdom on a download.
  const errors = [];
  w.addEventListener('error', e => errors.push(e.error || e.message));
  const context = dom.getInternalVMContext(), cache = new Map();
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = new vm.SourceTextModule(await fs.readFile(file, 'utf8'), { context, identifier: file });
    cache.set(file, module);
    await module.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier)));
    return module;
  }
  await (await load(path.join(ROOT, 'app/js/app.js'))).evaluate();
  await until(() => w.document.querySelector('.screen'), 'boot');
  const q = selector => w.document.querySelector(selector);
  const qa = selector => [...w.document.querySelectorAll(selector)];
  const textButton = (text, root = w.document) => [...root.querySelectorAll('button')].find(x => x.textContent.trim() === text);
  const click = text => { const node = textButton(text); assert(node, 'button exists: ' + text); node.click(); return node; };
  const input = (node, value) => { node.value = value; node.dispatchEvent(new w.Event('input', { bubbles: true })); };
  async function go(route) { w.location.hash = '#/' + route; await sleep(35); }
  return { dom, w, q, qa, textButton, click, input, go, errors, objectUrls, state: () => JSON.parse(w.localStorage.getItem(DB)), boards: () => JSON.parse(w.localStorage.getItem(BOARDS + '.guest')) };
}
let current;
try {
  current = await app();
  const { w, q, qa, input, click, go, state, boards, textButton } = current;
  check('home has 9 named heads from one 4×4 sprite', () => {
    assert.equal(qa('.mood').length,9);
    qa('.chip-face').forEach((head, i) => {
      assert(head.classList.contains('mood-sprite'));
      assert.equal(head.getAttribute('role'),'img');
      assert(head.getAttribute('aria-label'));
      assert.equal(parseFloat(head.style.getPropertyValue('--face-x')), (i % 4) * 100 / 3);
      assert.equal(parseFloat(head.style.getPropertyValue('--face-y')), Math.floor(i / 4) * 100 / 3);
    });
    assert.equal(qa('.mood img').length,0);
  });
  check('note is above the mood choices',()=>assert(q('.mood-note-wrap').compareDocumentPosition(q('.mood-chips')) & w.Node.DOCUMENT_POSITION_FOLLOWING));
  check('confirmation initially disabled, no share button',()=>{assert(q('.mood-confirm').disabled);assert(!current.textButton('Поделиться'));});
  check('hero keeps the calm face until a mood is saved',()=>{
    const mascot=q('.live-mascot');
    assert(mascot,'hero mascot renders');
    assert(!mascot.classList.contains('has-mood'));
    assert(mascot.querySelector('.live-mascot-base').src.includes('assets/mascot/hello.png'));
    assert.equal(mascot.getAttribute('aria-label'),'Дибитишка рядом');
  });
  check('home chat button is renamed to «Пережить вместе»',()=>{
    assert([...w.document.querySelectorAll('button')].some(b=>b.textContent.includes('Пережить вместе')));
    assert(![...w.document.querySelectorAll('button')].some(b=>b.textContent.includes('Открыть чат')));
  });
  const startScales = state().game?.scales;
  input(q('#mood-note'),'Слышу море');
  qa('.mood')[1].click(); qa('.mood')[6].click(); qa('.mood')[8].click();
  check('tapping choices only updates the draft',()=>{assert.equal(state().mood_entries?.length || 0,0);assert.deepEqual(state().game?.scales,startScales);assert.equal(qa('.mood.on').length,1);});
  check('selection keeps the note and enables confirm',()=>{assert.equal(q('#mood-note').value,'Слышу море');assert(!q('.mood-confirm').disabled);assert.equal(qa('.mood')[8].getAttribute('aria-pressed'),'true');});
  await go('diary');
  check('unconfirmed draft absent from diary',()=>assert(!q('#app').textContent.includes('Слышу море')));
  await go('');
  check('navigation does not submit or lose the in-memory draft',()=>{assert.equal(q('#mood-note').value,'Слышу море');assert.equal(qa('.mood.on').length,1);});
  const submit = q('.mood-confirm'); submit.click(); submit.click();
  check('confirmation saves one combined entry, double click does not duplicate',()=>{assert.equal(state().mood_entries.length,1);assert.equal(state().mood_entries[0].value,8);assert.equal(state().mood_entries[0].note,'Слышу море');});
  check('successful submit clears draft and disarms button',()=>{assert.equal(q('#mood-note').value,'');assert.equal(qa('.mood.on').length,0);assert(q('.mood-confirm').disabled);assert(q('.daily-mood-status').textContent.includes('Настроение отмечено'));});
  check('hero face follows the saved mood',()=>{
    const mascot=q('.live-mascot'),face=mascot.querySelector('.live-mascot-face');
    // эмоция i лежит в ячейке i+1 сетки 4×3: столбцы 0/33.3/66.7/100%, ряды 0/50/100%
    const cell=mood=>{const i=mood+1;return{x:(i%4)*100/3,y:Math.floor(i/4)*50};};
    assert(mascot.classList.contains('has-mood'));
    assert.equal(parseFloat(face.style.getPropertyValue('--face-x')),cell(8).x);   // «Непонятно» → ячейка 9
    assert.equal(parseFloat(face.style.getPropertyValue('--face-y')),cell(8).y);
    assert(face.classList.contains('mood-in'));
    assert(mascot.getAttribute('aria-label').includes('Непонятно'));
  });
  qa('.mood')[8].click(); q('.mood-confirm').click();
  check('same emotion can be confirmed again; note is optional',()=>{assert.equal(state().mood_entries.length,2);assert(!state().mood_entries[1].note);});
  input(q('#mood-note'),'Не теряй черновик'); qa('.mood')[0].click();
  const originalSet = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function(k,v){if(k===DB)throw new Error('QuotaExceededError');return originalSet.call(this,k,v);};
  q('.mood-confirm').click();
  check('failed write preserves note and does not create a ghost diary entry',()=>{assert.equal(state().mood_entries.length,2);assert.equal(q('#mood-note').value,'Не теряй черновик');assert(!q('.mood-confirm').disabled);});
  w.Storage.prototype.setItem = originalSet;
  q('.mood-confirm').click();
  check('retry after quota error saves exactly once',()=>assert.equal(state().mood_entries.length,3));
  await go('diary');
  check('confirmed note appears in diary with sprite heads',()=>{assert(q('#app').textContent.includes('Не теряй черновик'));assert(qa('.ric-face').every(n=>n.classList.contains('mood-sprite')));});
  await go('');
  /* v39: заметка «Дела» на «Сегодня» — свои дела на день, локально и по дням */
  const dNow = new Date();
  const dayKey = `${dNow.getFullYear()}-${String(dNow.getMonth() + 1).padStart(2, '0')}-${String(dNow.getDate()).padStart(2, '0')}`;
  const btnWith = (text, root = w.document) => [...root.querySelectorAll('button')].find(x => x.textContent.includes(text));
  check('home shows the daily deeds note',()=>assert(q('.deeds-card')));
  input(q('.deeds-input'),'Позвонить маме'); q('.deeds-add').click(); await sleep(30);
  input(q('.deeds-input'),'Полить цветок'); q('.deeds-add').click(); await sleep(30);
  check('deeds save under the day key and render as a list',()=>{
    const items=state().deeds[dayKey].items;
    assert.equal(items.length,2);
    assert.equal(items[0].text,'Позвонить маме');
    assert.equal(qa('.deed').length,2);
    assert.equal(q('.deeds-count').textContent,'0 из 2 сделано');
    assert(!btnWith('Перенести'),'carry button stays hidden while today has deeds');
  });
  qa('.deed-check')[0].click(); await sleep(30);
  check('checking a deed persists and updates the counter',()=>{
    assert.equal(state().deeds[dayKey].items[0].done,true);
    assert.equal(q('.deeds-count').textContent,'1 из 2 сделано');
    assert(qa('.deed')[0].classList.contains('done'));
  });
  qa('.deed-del')[1].click(); await sleep(30);
  check('removing a deed keeps the rest of the list',()=>{
    const items=state().deeds[dayKey].items;
    assert.equal(items.length,1);
    assert.equal(items[0].text,'Позвонить маме');
  });
  /* v40: подсказка про иконку — маленькая и всплывающая, со ссылкой на мини-приложение */
  check('home keeps no install card or guide section: the hint takes no interface space',()=>{
    assert(!q('.install-teaser'));
    assert(!q('#app').textContent.includes('Дибитишка рядом'));
    assert.equal(qa('#app .step-n').length,0);
  });
  await go('profile');
  check('profile row is the permanent one-line entry and shows the mini app link',()=>{
    const row=btnWith('Иконка на экране «Домой»');
    assert(row);
    assert(row.textContent.includes('t.me/test/dibitishka'));
  });
  btnWith('Иконка на экране «Домой»').click(); await sleep(60);
  check('the entry opens one small sheet: mascot icon, link, a single platform step, details closed',()=>{
    assert(q('.sheet-install.on'));
    assert(q('.sheet-install .install-ico').getAttribute('src').includes('assets/icons/apple-touch-180.png'));
    assert.equal(q('.sheet-install .install-link code').textContent,'t.me/test/dibitishka');
    assert.equal(qa('.sheet-install .install-step').length,1);
    assert.equal(q('.sheet-install .install-more').open,false);
    assert(!q('.sheet-install').textContent.includes('null'),'условные узлы не должны превращаться в текст «null»');
    assert(!q('.sheet-install .navbar'));
    assert(q('.sheet-install .install-copy[aria-label="Скопировать ссылку"]'));
    assert(q('.sheet-install .install-copy[aria-label="Открыть ссылку"]'));
  });
  q('.sheet-install .install-copy[aria-label="Скопировать ссылку"]').click(); await sleep(40);
  check('the link is copyable without leaving the sheet',()=>{
    // jsdom не умеет execCommand/clipboard — важен сам отклик и что лист остался
    assert(/Скопировано|Скопировать не вышло/.test(q('.toast').textContent),q('.toast').textContent);
    assert(q('.sheet-install.on'));
  });
  btnWith('Позже').click(); await sleep(400);
  check('«Позже» closes the sheet, snoozes for a week and allows one more pop later',()=>{
    assert(!q('.sheet-install.on'));
    assert(state().install_snoozed>Date.now()+6*86400000);
    assert.equal(state().install_hint_seen,false);
  });
  await go(''); await go('profile');
  check('while snoozed nothing pops up on its own, the profile entry stays',()=>{
    assert(!q('.sheet-install'));
    assert(btnWith('Иконка на экране «Домой»'));
  });
  btnWith('Иконка на экране «Домой»').click(); await sleep(60);
  btnWith('Готово').click(); await sleep(400);
  check('«Готово» remembers the icon so the hint stays away',()=>{
    assert.equal(state().install_done,true);
    assert(!q('.sheet-install.on'));
  });
  await go('install');
  check('the retired #/install link lands on home and reopens the sheet instead of a separate screen',()=>{
    assert.equal(w.location.hash,'#/');
    assert(q('.sheet-install.on'));
    assert(q('.sheet-install').textContent.includes('Похоже, я уже стою на твоём экране'));
    assert(!q('#app').textContent.includes('Четыре шага'));
  });
  q('.sheet-install').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await sleep(380);
  await go('');
  check('splash shows the 3D mascot with orbiting elements and an XP-style loading bar',()=>{
    assert(q('.splash-mascot').src.includes('assets/brand/splash-mascot-3d.png'));
    assert(q('.splash-wordmark').src.includes('assets/brand/splash-wordmark-hq.png'));
    assert(qa('.orbit-ring').length===2 && qa('.orbit-ring .orb').length>=8);
    assert(q('.splash-bar'));
    assert(q('.hero-brand').src.includes('assets/brand/logo-1024.png'));
  });
  await go('profile'); qa('.palette-opt')[1].click(); await go('');
  check('pink palette puts the 1025 cut (letters + character, no pink halo) on the first page',()=>{
    assert(q('.hero-brand').src.includes('assets/brand/logo-1025-clean.png'));
  });
  await go('profile'); qa('.palette-opt')[0].click(); await go('');
  check('blue palette restores the 1024 hero logo',()=>{
    assert(q('.hero-brand').src.includes('assets/brand/logo-1024.png'));
  });
  const opened = [];
  const payApp = await app({}, { apiContent: structuredClone(CONTENT) });
  payApp.w.open = (u) => opened.push(u);
  await payApp.go('profile');
  const payBtn = payApp.textButton('Поддержка в Tribute') || payApp.textButton('Минимальный донат');
  assert(payBtn, 'profile has the monthly pay button');
  payBtn.click(); await sleep(40);
  check('monthly pay opens the Tribute payment window in-app right away, like the one-time donate',()=>{
    assert.equal(opened.length, 1);
    assert(opened[0].includes('t.me/tribute/app?startapp=dSmoke'));
    assert(!payApp.q('.sheet.on'), 'no intermediate sheet between the click and the payment window');
  });
  payApp.dom.window.close();
  /* v41: «Купить подписку» внутри печатной тетради ведёт на #/workbook?pay=1
     и должна открывать то же окно, а не просить ещё один клик на экране. */
  const wbApp = await app({}, { apiContent: structuredClone(CONTENT) });
  const wbOpened = [];
  wbApp.w.open = (u) => wbOpened.push(u);
  await wbApp.go('workbook?pay=1');
  await sleep(140);
  check('the workbook paywall CTA opens the same payment window without a second click', () => {
    assert.equal(wbOpened.length, 1);
    assert(wbOpened[0].includes('t.me/tribute/app?startapp=dSmoke'));
    assert(!wbApp.q('.sheet.on'), 'no intermediate sheet between the click and the payment window');
    assert.equal(wbApp.w.location.hash, '#/workbook', 'the ?pay=1 flag is stripped, so a refresh does not reopen it');
    assert(wbApp.q('#app').textContent.includes('Тетрадь'), 'lands on the workbook screen, not somewhere else');
  });
  wbApp.dom.window.close();
  await go('profile');
  check('profile keeps the privacy disclaimer: everything stays in local memory',()=>{
    assert(q('#app').textContent.includes('остаётся только на твоём телефоне'));
    assert(q('#app').textContent.includes('Мы ничего не собираем'));
  });
  await go('chat');
  check('local chat offers eight different starting prompts',()=>assert.equal(qa('.chat-hints .chip').length,8));
  click('Мне тревожно'); await sleep(500); click('Мне тревожно'); await sleep(500);
  check('local Dibitishka does not repeat the same response immediately',()=>{
    const replies=qa('.msg.bot .bubble').map(n=>n.textContent);
    assert(replies.length>=2); assert.notEqual(replies.at(-1),replies.at(-2));
  });
  for (const route of ['skills', ...CONTENT.blocks.map(b=>'skills/'+b.id), 'p/'+CONTENT.blocks[0].practices[0].id, 'chat', 'profile', 'tasks', 'task/'+CONTENT.tasks[0].id, 'workbook','merch','install','boards']) {
    await go(route); check('route '+route+' renders',()=>assert(q('#app .screen')));
  }
  check('boards use the generated creative-mess composition',()=>assert(q('.boards-hero img').src.includes('creative-mess.webp')));
  check('default boards are persisted once',()=>assert.equal(boards().length,1));
  click('+ Новая доска');
  input(q('.sheet.on input[aria-label="Название доски"]'),'Море'); click('Создать'); await sleep(45);
  check('create board opens it',()=>{assert.equal(boards().length,2);assert(q('.board-head').textContent.includes('Море'));});
  click('+ Добавить'); qa('.sheet.on .add-opt').find(x=>x.textContent.includes('Заметка, стихи, мысль')).click();
} catch (e) { current?.dom.window.close(); throw e; }

try {
  const { w, q, qa, input, click, go, boards } = current;
  await sleep(400);
  check('opening child sheet survives parent close timer',()=>assert.equal(q('.sheet.on h3').textContent,'Заметка на доску'));
  input(q('.sheet.on textarea'),'Первая строка\nВторая строка');
  input(q('.sheet.on .board-input'),'море, #тепло'); click('Добавить на доску'); await sleep(400);
  check('note and tags saved on board',()=>{const b=boards().find(b=>b.title==='Море');assert.equal(b.tiles[0].text,'Первая строка\nВторая строка');assert.deepEqual(b.tiles[0].tags,['море','тепло']);});
  q('.tile').click(); await sleep(30);
  check('editing a note starts with its saved multiline text',()=>assert.equal(q('.sheet.on textarea').value,'Первая строка\nВторая строка'));
  input(q('.sheet.on textarea'),'Обновлённая заметка'); click('Сохранить'); await sleep(400);
  check('edited note persists',()=>assert.equal(boards().find(b=>b.title==='Море').tiles[0].text,'Обновлённая заметка'));
  click('+ Добавить'); qa('.sheet.on .add-opt').find(x=>x.textContent.includes('Фото из галереи')).click();
  const picker=q('input[type=file]');
  Object.defineProperty(picker,'files',{value:[new File(['a'],'a.jpg',{type:'image/jpeg'}),new File(['b'],'b.png',{type:'image/png'})]});
  picker.dispatchEvent(new w.Event('change'));
  await until(()=>boards().find(b=>b.title==='Море').tiles.length===3,'multiple photos');
  check('multiple gallery photos create real media tiles',()=>{assert.equal(qa('.tile-photo').length,2);assert(qa('.tile-photo img').every(img=>img.dataset.media));});
  input(q('.board-search'),'не существует');
  check('board filter has an explicit empty result',()=>assert(q('.board-empty').textContent.includes('По этому тегу ничего нет')));
  input(q('.board-search'),'');
  await until(()=>qa('.tile-photo img').every(img=>img.src.startsWith('blob:')),'rehydrate after filter');
  check('photo URLs hydrate again after clearing search',()=>assert.equal(qa('.tile-photo img').length,2));
  qa('.tile-photo')[0].click(); await sleep(30); click('Поставить фоном доски'); await sleep(400);
  const photoKey=boards().find(b=>b.title==='Море').bgKey;
  qa('.tile-photo')[0].click(); await sleep(30); click('Убрать с доски'); await sleep(400);
  check('removing a tile does not remove its photo when used as background',()=>{assert.equal(boards().find(b=>b.title==='Море').bgKey,photoKey);assert(q('.board-space-bg').style.backgroundImage.includes('blob:'));});
  click('Сохранить и распечатать');
  await until(()=>current.textButton('Скачать PDF',q('.sheet.on')),'board export');
  check('export offers PDF and PNG without sharing emotions',()=>{assert(current.textButton('Скачать PNG',q('.sheet.on')));assert(q('.board-export-preview'));});
  q('.sheet.on').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await sleep(350);
  await go('boards');
  input(q('.board-search'),'море');
  check('global search finds notes by tag',()=>assert(q('.found-list').textContent.includes('Обновлённая заметка')));
  check('all interactions had no uncaught errors',()=>assert.deepEqual(current.errors,[]));
  current.dom.window.close();
  current=await app({}, {boardSeed:[]});
  await current.go('boards');
  check('all boards deleted: warm empty state, not just a button',()=>assert(current.q('.boards-empty').textContent.includes('Здесь будет то, что дорого тебе')));
  current.dom.window.close();
  current=await app({mood_schema:1,mood_entries:[0,1,2,3,4].map((value,i)=>({ts:Date.now()-i*1000,value}))});
  check('legacy five-state mood migration preserves meaning',()=>assert.deepEqual(current.state().mood_entries.map(e=>e.value),[0,2,3,4,6]));
  current.dom.window.close();
  current=await app({mood_entries:[{ts:Date.now()-3*86400000,value:1}]});
  check('hero keeps the last mood even when it arrived three days ago',()=>{
    const mascot=current.q('.live-mascot'),face=mascot.querySelector('.live-mascot-face');
    assert(mascot.classList.contains('has-mood'));
    assert.equal(parseFloat(face.style.getPropertyValue('--face-x')),(2%4)*100/3);  // «Грустно» → ячейка 2
    assert.equal(parseFloat(face.style.getPropertyValue('--face-y')),0);
    assert(mascot.getAttribute('aria-label').includes('Грустно'));
  });
  current.dom.window.close();
  current=await app({}, {privateMode:true});
  await current.go('board/'+current.boards()[0].id);
  const before=current.boards()[0].tiles.length;
  current.click('+ Добавить'); current.qa('.sheet.on .add-opt').find(x=>x.textContent.includes('Фото из галереи')).click();
  const picker2=current.q('input[type=file]');Object.defineProperty(picker2,'files',{value:[new File(['a'],'a.jpg',{type:'image/jpeg'})]});picker2.dispatchEvent(new current.w.Event('change'));
  await until(()=>current.q('.toast')?.textContent.includes('приватном режиме'),'IDB error feedback');
  check('private-mode storage failure has no fake/broken tile',()=>{assert.equal(current.boards()[0].tiles.length,before);assert.deepEqual(current.errors,[]);});
  current.dom.window.close();
  const oldApiContent=structuredClone(CONTENT);
  oldApiContent.version=7;
  oldApiContent.meta.mascot_lines.paywall[0]='СТАРАЯ ЦЕНА ИЗ API';
  current=await app({trial_started_at:Date.now()-9*86400000},{apiContent:oldApiContent});
  check('new local content supersedes an older persisted API copy',()=>{
    assert(current.q('#app').textContent.includes('Минимальный донат'));
    assert(!current.q('#app').textContent.includes('СТАРАЯ ЦЕНА ИЗ API'));
  });
  current.dom.window.close();
  const yDay=new Date(); yDay.setDate(yDay.getDate()-1);
  const yKey=`${yDay.getFullYear()}-${String(yDay.getMonth()+1).padStart(2,'0')}-${String(yDay.getDate()).padStart(2,'0')}`;
  const tDay=new Date();
  const tKey=`${tDay.getFullYear()}-${String(tDay.getMonth()+1).padStart(2,'0')}-${String(tDay.getDate()).padStart(2,'0')}`;
  current=await app({deeds:{[yKey]:{items:[{id:'y1',text:'Полить цветок',done:false},{id:'y2',text:'Вчерашнее сделано',done:true}]}}});
  check('open deeds from yesterday carry into a fresh today',()=>{
    const carry=[...current.w.document.querySelectorAll('button')].find(b=>b.textContent.includes('Перенести'));
    assert(carry,'carry button is offered on an empty today list');
    carry.click();
    const items=current.state().deeds[tKey].items;
    assert.equal(items.length,1);
    assert.equal(items[0].text,'Полить цветок');
    assert.equal(items[0].done,false);
  });
  current.dom.window.close();
  /* v40: подсказка всплывает сама — один раз, маленьким листом, и больше не лезет */
  current=await app({ install_hint_seen:false });
  current.q('#splash').classList.add('gone');   // прелоад в jsdom идёт 3.2 с — закрываем, как в жизни
  await until(()=>current.q('.sheet-install.on'),'the home-screen hint pops up by itself');
  check('the hint pops up by itself once: home stays clean, state remembers the pop',()=>{
    assert.equal(current.state().install_hint_seen,true);
    assert(!current.q('#app .install-teaser'));
    assert.equal(current.q('.sheet-install .install-link code').textContent,'t.me/test/dibitishka');
  });
  current.q('.sheet-install').dispatchEvent(new current.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  await sleep(420);
  await current.go('profile'); await current.go(''); await sleep(800);
  check('after the first pop the hint does not reopen on every screen',()=>{
    assert.equal(current.qa('.sheet-install').length,0);
    assert.equal(current.state().install_hint_seen,true);
  });
  current.dom.window.close();
  current=await app({},{config:{miniapp_url:'https://t.me/dbtrobot/dibitishka'}});
  await current.go('profile');
  check('miniapp_url from config.js wins over the link built from bot_username',()=>{
    const row=[...current.w.document.querySelectorAll('button')].find(b=>b.textContent.includes('Иконка на экране «Домой»'));
    assert(row,'profile entry exists');
    assert(row.textContent.includes('t.me/dbtrobot/dibitishka'),row.textContent);
  });
  current.dom.window.close();
  current=await app({ onboarded: false });
  check('onboarding shows the local-only privacy disclaimer',()=>{
    assert(current.q('.privacy-note').textContent.includes('остаётся только на твоём телефоне'));
    assert(current.q('.privacy-note').textContent.includes('Мы ничего не собираем'));
  });
  check('welcome has brand introduction and both directions on last slide', () => {
    assert(current.q('.onboard-text').textContent.includes('маленькая слезинка'));
    current.q('[aria-label="Дальше"]').click(); current.q('[aria-label="Дальше"]').click();
    assert(!current.q('.onboard-foot').classList.contains('hidden'));
    assert(!current.q('[aria-label="Назад"]').disabled);
    current.q('[aria-label="Назад"]').click();
    assert.equal(current.q('.onboard-title').textContent, 'Дневник, задания и чат');
    const screen = current.q('.onboard');
    const start = new current.w.Event('touchstart'); Object.defineProperty(start, 'touches', { value: [{clientX:250,clientY:200}] }); screen.dispatchEvent(start);
    const end = new current.w.Event('touchend'); Object.defineProperty(end, 'changedTouches', { value: [{clientX:80,clientY:210}] }); screen.dispatchEvent(end);
    assert.equal(current.q('.onboard-title').textContent, 'Медленно — тоже вперёд');
    screen.dispatchEvent(new current.w.KeyboardEvent('keydown', {key:'ArrowLeft'}));
    assert.equal(current.q('.onboard-title').textContent, 'Дневник, задания и чат');
  });
  current.dom.window.close(); current = await app();
  await current.go('profile');
  current.q('button.stat-pill').click(); await sleep(40);
  check('record count links to emotion diary', () => assert.equal(current.w.location.hash, '#/diary'));
  for (const route of ['mind','base','stress','sense']) {
    await current.go('profile');
    const index = ['mind','base','stress','sense'].indexOf(route);
    current.qa('button.scale-card')[index].click(); await sleep(40);
    check('progress links to skills/' + route, () => assert.equal(current.w.location.hash, '#/skills/' + route));
  }
  await current.go('workbook');
  check('trial does not offer full workbook download', () => {
    assert(!current.textButton('Скачать / распечатать тетрадь'));
    assert(current.q('#app').textContent.includes('по одному заданию'));
  });
  await current.go('merch');
  check('two real product mockups and contact buttons', () => {
    assert.equal(current.qa('.merch-photo img').length, 2);
    assert(current.q('.merch-photo img').src.endsWith('/cap.webp'));
    assert.equal(current.qa('.mcard button').length, 2);
    assert(current.q('#app').textContent.includes('@vasmedoljno'));
  });
  check('merch mascot stands behind the counter as the shopkeeper', () => {
    assert(current.q('.mascot-wrap .mascot').src.includes('/cashier.png'),
      'на экране мерча Дибитишка должен стоять за прилавком, а не просто выглядывать');
  });
  check('merch has honest base descriptions and mockup disclaimer', () => {
    const notes = current.qa('.mcard .mb span').map(n => n.textContent);
    assert.equal(notes.length, 2);
    assert(notes.some(t => t.includes('Рабочая тетрадь для тренировки')), 'в описании тетради — базовое «Рабочая тетрадь для тренировки когнитивно-поведенческих навыков»');
    assert(notes.some(t => t.includes('Пятипанелька') || t.includes('хлопка')), 'в описании кепки — базовый хлопок 5-панель');
    assert(current.q('.mascot-wrap .bubble').textContent.includes('Ну-ка, примерь!'), 'на экране мерча реплика «Ну-ка, примерь!»');
    assert(!/уточняй у @vasmedoljno\.$/.test(current.q('.merch-contact').textContent));
    assert(current.q('.foot').textContent.includes('мокапы'), 'честно про то, что картинки — визуализации');
  });
  await current.go('skills');
  check('skills screen sits with the mascot in meditation, whole pose visible', () => {
    const img = current.q('.mascot-wrap.zen .mascot');
    assert(img && img.src.includes('/meditate.png'), '«Навыки» показывают медитирующую позу');
    assert(img.alt === 'Дибитишка медитирует', 'альт описывает позу, а не просто имя');
    assert(!current.q('.mascot-wrap.peeking'), 'позу нельзя прятать за край реплики — в лотосе видны ноги');
    assert(current.q('.mascot-wrap.zen .bubble small').textContent.includes('дышу'), 'реплика поддерживает позу');
  });

  /* ---------- v43: бинауральные ритмы ---------- */
  const audio = { contexts: [] };
  class MockParam {
    constructor(v = 0) { this.value = v; this.events = []; }
    setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; return this; }
    linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); this.value = v; return this; }
    setTargetAtTime(v, t, c) { this.events.push(['target', v, t, c]); this.value = v; return this; }
    cancelScheduledValues() { return this; }
  }
  class MockNode {
    constructor(kind) { this.kind = kind; this.outs = []; this.disconnected = false; }
    connect(dest, outChannel = 0, inChannel = 0) { this.outs.push({ dest, outChannel, inChannel }); return dest; }
    disconnect() { this.disconnected = true; this.outs = []; }
  }
  audio.Ctx = class MockAudioContext {
    constructor() {
      this.sampleRate = 44100; this.state = 'running'; this.closed = false; this.nodes = [];
      this.destination = new MockNode('destination');
      audio.contexts.push(this);
    }
    get currentTime() { return 0; }
    createGain() { const n = new MockNode('gain'); n.gain = new MockParam(1); this.nodes.push(n); return n; }
    createChannelMerger(channels) { const n = new MockNode('merger'); n.channels = channels; this.nodes.push(n); return n; }
    createOscillator() {
      const n = new MockNode('osc'); n.type = 'sine'; n.frequency = new MockParam(440);
      n.start = () => {}; n.stop = () => { n.stoppedAt = 0; };
      this.nodes.push(n); return n;
    }
    createBufferSource() {
      const n = new MockNode('buffer'); n.loop = false; n.buffer = null;
      n.start = () => {}; n.stop = () => {};
      this.nodes.push(n); return n;
    }
    createBiquadFilter() { const n = new MockNode('biquad'); n.type = 'lowpass'; n.frequency = new MockParam(350); this.nodes.push(n); return n; }
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length);
      return { numberOfChannels: channels, length, sampleRate, getChannelData: () => data };
    }
    suspend() { this.state = 'suspended'; }
    resume() { this.state = 'running'; }
    close() { this.closed = true; this.state = 'closed'; }
  };

  current.dom.window.close();
  current = await app({}, { audio });
  check('home: бинауральные ритмы стоят между доской впечатлений и «Пережить вместе»', () => {
    const sects = current.qa('.sect').map(n => n.textContent.trim());
    const boards = sects.indexOf('Доска впечатлений');
    const sound = sects.indexOf('Бинауральные ритмы');
    const chat = sects.indexOf('Чат поддержки');
    assert.ok(boards >= 0 && sound > boards && chat > sound, `порядок секций: ${sects.join(' → ')}`);
    assert(current.q('.sound-teaser'), 'тизер плеера на главной есть');
    assert(!current.q('.sound-pill'), 'пока звук выключен, плашки нет');
  });
  await current.go('sound');
  check('экран объясняет эффект и предупреждает про наушники', () => {
    const txt = current.q('#app').textContent;
    assert(current.q('.sound-formula').textContent.includes('Гц'), 'схема показывает частоты');
    assert(txt.includes('Нужны наушники'), 'про наушники сказано прямо');
    assert(txt.includes('не заменяет'), 'честно: терапию ритмы не заменяют');
    assert.equal(current.qa('.sound-preset').length, 4, 'четыре пресета');
    assert.equal(current.qa('.sound-time').length, 5, 'пять длительностей');
  });
  check('числа в схеме — настоящие частоты выбранного пресета', () => {
    const [left, right, beat] = current.qa('.sound-formula b').map(n => parseFloat(n.textContent));
    assert.ok(left > 0 && right > left, `левое ${left} < правого ${right}`);
    assert.equal(Math.round((right - left) * 10) / 10, beat, 'разница равна пульсу');
  });
  current.click('Включить');
  check('по нажатию звук строится: два синуса в разные уши', () => {
    assert.equal(audio.contexts.length, 1, 'аудиоконтекст один');
    const ctx = audio.contexts[0];
    const osc = ctx.nodes.filter(n => n.kind === 'osc');
    assert.equal(osc.length, 2, 'два осциллятора');
    assert.equal(osc[0].type, 'sine');
    const merger = ctx.nodes.find(n => n.kind === 'merger');
    const channels = [...osc[0].outs, ...osc[1].outs].filter(o => o.dest === merger).map(o => o.inChannel).sort();
    assert.deepEqual(channels, [0, 1], 'каждый тон — в свой канал');
    assert(current.q('.sound-play').textContent.includes('Пауза'), 'кнопка стала паузой');
    assert(!current.q('.sound-stop').classList.contains('hidden'), 'стоп виден');
    assert(current.q('.sound-screen').classList.contains('playing'), 'экран в состоянии «играет»');
  });
  await current.go('');
  check('на другом экране сессию держит плашка', () => {
    assert(current.q('.sound-pill'), 'плашка появилась');
    assert(current.q('.sound-teaser').classList.contains('on'), 'тизер показывает идущую сессию');
    assert(/Тета|Дельта|Альфа|Бета/.test(current.q('.sound-teaser').textContent), 'в тизере назван пресет');
  });
  current.q('.sound-pill-stop').click();
  await sleep(750);   // полсекунды звук затухает, потом граф разбирается
  check('звук останавливается из плашки', () => {
    assert(!current.q('.sound-pill'), 'плашка ушла сразу, не дожидаясь затухания');
    assert.equal(audio.contexts[0].closed, true, 'контекст закрыт — батарея не тратится');
  });
  await current.go('sound');
  check('выбор пресета и длительности сохраняется в памяти телефона', () => {
    current.qa('.sound-preset')[3].click();
    current.qa('.sound-time')[0].click();
    const st = current.state().sound;
    assert.equal(st.preset, 'beta');
    assert.equal(st.minutes, 5);
    const [left, right, beat] = current.qa('.sound-formula b').map(n => parseFloat(n.textContent));
    assert.equal(Math.round((right - left) * 10) / 10, beat);
    assert.equal(current.qa('.sound-preset')[3].getAttribute('aria-pressed'), 'true');
  });

  console.log(`\ndom-smoke: ${checks} checks passed`);
} finally { current?.dom.window.close(); }
