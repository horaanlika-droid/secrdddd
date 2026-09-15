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
async function app(seed = {}, { boardSeed, privateMode = false, apiContent = null } = {}) {
  const dom = new JSDOM(html, { url: 'https://dibi.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const objectUrls = new Map(); let objectId = 0;
  w.DIBI_CONFIG = { bot_public_url: apiContent ? 'https://bot.dibi.test' : '', bot_username: 'test', subscription: { trial_days: 7 } };
  w.localStorage.setItem(DB, JSON.stringify({ onboarded: true, trial_started_at: Date.now(), mood_schema: 2, ...seed }));
  if (boardSeed !== undefined) w.localStorage.setItem(BOARDS, JSON.stringify(boardSeed));
  w.fetch = async url => {
    const href = String(url);
    const body = href.startsWith('https://bot.dibi.test/content') ? apiContent
      : href.includes('content') ? CONTENT : { ok: true, ai: false, enabled: false, items: [] };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
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
  const { w, q, qa, input, click, go, state, boards } = current;
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
  check('splash shows the clean logo (logo-clean.png), background cut to alpha',()=>{
    assert(q('.splash-logo-clean').src.includes('assets/brand/logo-clean.png'));
    assert(q('.hero-brand').src.includes('assets/brand/logo-1024.png'));
  });
  await go('chat');
  check('local chat offers eight different starting prompts',()=>assert.equal(qa('.chat-hints .chip').length,8));
  click('Мне тревожно'); await sleep(500); click('Мне тревожно'); await sleep(500);
  check('local Dibitishka does not repeat the same response immediately',()=>{
    const replies=qa('.msg.bot .bubble').map(n=>n.textContent);
    assert(replies.length>=2); assert.notEqual(replies.at(-1),replies.at(-2));
  });
  for (const route of ['skills', ...CONTENT.blocks.map(b=>'skills/'+b.id), 'p/'+CONTENT.blocks[0].practices[0].id, 'chat', 'profile', 'tasks', 'task/'+CONTENT.tasks[0].id, 'workbook','merch','boards']) {
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
  console.log(`\ndom-smoke: ${checks} checks passed`);
} finally { current?.dom.window.close(); }
