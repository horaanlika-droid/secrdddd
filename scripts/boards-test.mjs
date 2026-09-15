#!/usr/bin/env node
/* Offline contract tests: auth, private media, CAS, account isolation, retries,
   3-way merges and GIF proxy. No real Telegram/Tenor/S3 requests or keys. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { createBoardMedia } from '../bot/src/board-media.js';
import { createWebAuth, verifyTelegram } from '../bot/src/web-auth.js';
import { createBoardApi, createBoardStore, validateBoards } from '../bot/src/boards.js';
import { createGifApi } from '../bot/src/gif.js';
import { mergeBoardSnapshots, BoardSync, normalizeBoards } from '../app/js/board-sync.js';
import { jpegOrientation, orientationTransform } from '../app/js/image-tools.js';

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('  ✓ ' + name); };
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dibi-boards-'));
const token = '123456:test-only', db = { web_sessions: {} };
const auth = createWebAuth({ token, db, save() {} });
const a = auth.issue(1), b = auth.issue(2);
const headersA = { Authorization: 'Bearer ' + a.session }, headersB = { Authorization: 'Bearer ' + b.session };
const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
const api = createBoardApi({ root, auth, json, env: {} });
const server = http.createServer(async (req, res) => { if (!await api(req, res, new URL(req.url, 'http://x'))) json(res, 404, {}); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = p => `http://127.0.0.1:${server.address().port}${p}`;
const call = (p, opts = {}) => fetch(url(p), opts);
const note = (id, text) => ({ id, kind: 'note', text, tags: [], rot: 0, size: 'm', created: 1 });
const board = (tiles = []) => ({ id: 'b1', title: 'Лето', bg: 'sky', created: 1, tiles });
const post = data => ({ method: 'POST', headers: { ...headersA, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
try {
  check('session is opaque, only its hash is stored', () => { assert.equal(a.session.length, 43); assert(!JSON.stringify(db).includes(a.session)); });
  check('user_id is not authentication', () => assert.equal(auth.authenticate({ headers: {}, url: '/board?user_id=1' }), null));
  const signed = new URLSearchParams({ user: JSON.stringify({ id: 7, first_name: 'Тест' }), auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'test' });
  const sign = fields => createHmac('sha256', createHmac('sha256', 'WebAppData').update(token).digest()).update([...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n')).digest('hex');
  signed.set('hash', sign(signed));
  check('Telegram signed initData verifies', () => assert.equal(verifyTelegram(signed.toString(), token), 7));
  check('tampered Telegram identity rejected', () => assert.equal(verifyTelegram(signed.toString().replace('%3A7', '%3A8'), token), null));
  check('expired Telegram initData rejected', () => assert.equal(verifyTelegram(signed.toString(), token, Date.now() + 2 * 86400000), null));
  check('duplicate initData keys rejected', () => assert.equal(verifyTelegram(signed.toString() + '&user=x', token), null));
  check('expired browser session rejected', () => { const record = Object.values(db.web_sessions).find(x => x.userId === 2); const exp = record.expires; record.expires = 1; assert.equal(auth.authenticate({ headers: { authorization: headersB.Authorization } }), null); record.expires = exp; });
  const denied = await call('/board?user_id=1');
  check('GET /board requires verified identity', () => assert.equal(denied.status, 401));
  const deniedPost = await call('/board', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: 1, boards: [] }) });
  check('POST /board cannot spoof user_id', () => assert.equal(deniedPost.status, 401));
  const image = await fs.readFile(new URL('../app/assets/mascot/faces/even.png', import.meta.url));
  let response = await call('/board/media/photo1', { method: 'POST', headers: headersA, body: image });
  check('private image uploads', () => assert.equal(response.status, 200));
  response = await call('/board/media/photo1', { method: 'POST', headers: headersA, body: image });
  check('image upload retries are idempotent', () => assert.equal(response.status, 200));
  response = await call('/board/media/html', { method: 'POST', headers: headersA, body: '<svg onload="alert(1)"></svg>' });
  check('SVG/HTML is not accepted as an image', () => assert.equal(response.status, 415));
  response = await call('/board/media/photo1', { headers: headersB });
  check('other account cannot read the image', () => assert.equal(response.status, 404));
  response = await call('/board/media/photo1', { headers: headersA });
  const downloaded = Buffer.from(await response.arrayBuffer());
  check('own image is exact and private', () => { assert.deepEqual(downloaded, image); assert.equal(response.headers.get('cache-control'), 'private, no-store'); });
  check('prototype keys rejected', () => { assert.throws(() => validateBoards([{ ...board(), id: '__proto__' }])); assert.throws(() => validateBoards([{ ...board(), id: 'constructor' }])); });
  check('duplicate tile IDs rejected', () => assert.throws(() => validateBoards([board([note('t1','a'), note('t1','b')])])));
  check('non-http media URLs rejected', () => assert.throws(() => validateBoards([board([{ id: 't1', kind: 'gif', src: 'javascript:alert(1)', tags: [] }])])));
  check('board limits enforced', () => assert.throws(() => validateBoards(Array.from({ length: 61 }, (_, i) => ({ ...board(), id: 'b'+i })))));
  const initial = [board([note('t1', 'Первая заметка'), { id: 'p1', kind: 'photo', src: 'photo1', caption: 'Море', tags: ['лето'] }])];
  response = await call('/board', post({ base_revision: 0, boards: initial }));
  const saved = await response.json();
  check('metadata CAS accepts first revision', () => { assert.equal(response.status, 200); assert.equal(saved.revision, 1); });
  response = await call('/board', post({ base_revision: 0, boards: [] }));
  check('stale revision cannot erase data', () => assert.equal(response.status, 409));
  const isolated = await (await call('/board', { headers: headersB })).json();
  check('boards are account-isolated', () => assert.deepEqual(isolated.boards, []));
  const restarted = createBoardStore(root, {});
  check('metadata survives store restart', () => assert.deepEqual(saved.boards, normalizeBoards(initial)));
  assert.deepEqual((await restarted.get(1)).boards, saved.boards); checks++;
  response = await call('/board', post({ base_revision: 1, boards: [board([{ id: 'p2', kind: 'photo', src: 'missing', tags: [] }])] }));
  check('metadata cannot reference a missing upload', () => assert.equal(response.status, 400));
  const base = [board([note('t1', 'Оригинал')])];
  const local = [board([note('t1', 'Оригинал'), note('t2', 'Локальная')])];
  const remote = [board([note('t1', 'Оригинал'), note('t3', 'С телефона')])];
  let merged = mergeBoardSnapshots(base, local, remote);
  check('independent additions merge', () => { assert.equal(merged.boards[0].tiles.length, 3); assert.equal(merged.conflicts, 0); });
  merged = mergeBoardSnapshots(base, [board([note('t1','Моя версия')])], [board([note('t1','Другая версия')])]);
  check('conflicting text preserves both versions', () => { assert.equal(merged.conflicts, 1); assert.deepEqual(new Set(merged.boards[0].tiles.map(t => t.text)), new Set(['Моя версия','Другая версия'])); });
  check('uncontested deletion stays deleted', () => assert.deepEqual(mergeBoardSnapshots(base, [], base).boards, []));
  check('delete-vs-edit preserves the edit', () => assert.equal(mergeBoardSnapshots(base, [], remote).boards.length, 1));
  const memory = new Map(), storage = { getItem: k => memory.get(k) || null, setItem: (k,v) => memory.set(k,v) };
  let localBoards = [], writes = 0, offline = false;
  const client = new BoardSync({ storage, key:'sync', getBoards:()=>localBoards, setBoards:b=>{localBoards=b;}, getMedia:async()=>image, putMedia:async()=>true,
    authHeaders:()=>headersA, apiUrl:url, fetcher:async(...args)=>{ if(offline) throw new Error('offline'); if(args[1].method==='POST') writes++; return fetch(...args); } });
  await client.enable();
  check('new device downloads boards instead of replacing them with empty state', () => assert.equal(localBoards.length, 1));
  localBoards[0].tiles.push(note('offline', 'В дороге'));
  offline = true; client.changed(); await client.sync();
  check('offline changes remain pending and local', () => { assert.equal(client.state.pending, true); assert(localBoards[0].tiles.some(t=>t.id==='offline')); });
  offline = false; await client.sync();
  check('reconnect uploads pending changes', () => { assert.equal(client.status.phase,'synced'); assert.equal(client.state.pending,false); assert(writes>0); });
  const persisted = JSON.parse(memory.get('sync'));
  check('sync base and queue are persistent', () => assert(persisted.base[0].tiles.some(t=>t.id==='offline')));
  client.dispose();
  // Changes during an in-flight POST must not be marked as already uploaded.
  let racingBoards=[], raceMode='', posted=0;
  const racer = new BoardSync({storage,key:'race',getBoards:()=>racingBoards,setBoards:b=>{racingBoards=b;},getMedia:async()=>null,putMedia:async()=>true,
    authHeaders:()=>headersA,apiUrl:url,fetcher:async(endpoint,options)=>{
      if(options.method==='POST' && endpoint.endsWith('/board')) {
        posted++;
        if(raceMode==='conflict') {
          raceMode='';const snap=await (await call('/board',{headers:headersA})).json();
          snap.boards[0].tiles.push(note('peer','С другого телефона'));
          await call('/board',post({base_revision:snap.revision,boards:snap.boards}));
        } else if(raceMode==='typing') {raceMode='';racingBoards[0].tiles.push(note('late','Дописываю во время отправки'));}
      }
      return fetch(endpoint,options);
    }});
  await racer.enable();
  racingBoards[0].tiles.push(note('racing','Новая запись'));raceMode='conflict';await racer.sync();
  check('CAS conflict retries and merges a concurrent device edit',()=>{assert(posted>=2);assert(racingBoards[0].tiles.some(t=>t.id==='peer'));assert(racingBoards[0].tiles.some(t=>t.id==='racing'));});
  racingBoards[0].tiles.push(note('earlier','Начало'));raceMode='typing';await racer.sync();
  check('edit made during upload is retained and still pending',()=>{assert(racingBoards[0].tiles.some(t=>t.id==='late'));assert.equal(racer.state.pending,true);});
  await racer.sync();
  check('next sync uploads the late edit exactly once',()=>{assert.equal(racer.state.pending,false);assert.equal(racingBoards[0].tiles.filter(t=>t.id==='late').length,1);});
  racer.dispose();
  // S3-compatible storage exercised against a local object-store stub.
  const objects=new Map();let signedRequests=0;
  const s3server=http.createServer(async(req,res)=>{
    assert(req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=test-access/'));
    assert(!req.headers.authorization.includes('test-secret'));assert(req.headers['x-amz-content-sha256']);signedRequests++;
    if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);objects.set(req.url,Buffer.concat(chunks));res.writeHead(200);res.end();}
    else if(req.method==='DELETE'){objects.delete(req.url);res.writeHead(204);res.end();}
    else{const value=objects.get(req.url);res.writeHead(value?200:404);res.end(value);}
  });
  await new Promise(r=>s3server.listen(0,'127.0.0.1',r));
  try {
    const media=createBoardMedia(root,{BOARDS_S3_ENDPOINT:`http://127.0.0.1:${s3server.address().port}`,BOARDS_S3_BUCKET:'private',BOARDS_S3_ACCESS_KEY:'test-access',BOARDS_S3_SECRET_KEY:'test-secret'});
    await media.put(1,'photo1',image,'image/png');const object=await media.get(1,'photo1');
    check('private object storage round-trips media using signed requests',()=>{assert.deepEqual(object,image);assert(objects.has('/private/1/photo1'));});
    assert.equal(await media.get(2,'photo1'),null);await media.del(1,'photo1');
    check('object storage keys are account-scoped and deletable',()=>{assert.equal(objects.size,0);assert.equal(signedRequests,4);});
    check('partial S3 settings fail closed',()=>assert.equal(createBoardMedia(root,{BOARDS_S3_BUCKET:'only-one-setting'}).ready,false));
  } finally {await new Promise(r=>s3server.close(r));}
  // EXIF parser: all eight orientations in both TIFF byte orders, malformed buffers.
  for (const le of [true, false]) for (let orientation=1; orientation<=8; orientation++) {
    const data=new ArrayBuffer(40), v=new DataView(data);
    v.setUint16(0,0xffd8);v.setUint16(2,0xffe1);v.setUint16(4,34);v.setUint32(6,0x45786966);v.setUint16(10,0);
    v.setUint16(12,le?0x4949:0x4d4d);v.setUint16(14,42,le);v.setUint32(16,8,le);v.setUint16(20,1,le);
    v.setUint16(22,0x0112,le);v.setUint16(24,3,le);v.setUint32(26,1,le);v.setUint16(30,orientation,le);
    check(`EXIF orientation ${orientation} ${le?'LE':'BE'}`,()=>{const got=jpegOrientation(data);assert.equal(got.orientation,orientation);assert.equal(got.offset,30);});
    const matrix=orientationTransform(orientation,300,200);
    const points=[[0,0],[300,0],[0,200],[300,200]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]);
    assert.equal(Math.max(...points.map(p=>p[0])),orientation>=5?200:300);
    assert.equal(Math.max(...points.map(p=>p[1])),orientation>=5?300:200);
    assert.equal(Math.min(...points.flat()),0);
  }
  check('truncated EXIF falls back safely',()=>assert.equal(jpegOrientation(new ArrayBuffer(1)).orientation,1));
  let gifResult;
  const gifJson=(_,status,body)=>{gifResult={status,body};};
  const gif = createGifApi({ json:gifJson, env:{ TENOR_API_KEY:'test-secret-only' }, fetcher:async endpoint=>{
    assert(endpoint.includes('test-secret-only'));
    return new Response(JSON.stringify({results:[{id:'1',content_description:'Море',media_formats:{gif:{url:'https://media.tenor.com/test.gif'},tinygif:{url:'https://media.tenor.com/small.gif'}}}]}),{status:200});
  }});
  const req={method:'GET',socket:{remoteAddress:'test'}};
  await gif(req,null,new URL('http://x/gif?q=море'));
  check('GIF proxy returns sanitized results, not the key',()=>{assert.equal(gifResult.body.items.length,1);assert(!JSON.stringify(gifResult).includes('test-secret-only'));});
  await createGifApi({json:gifJson,env:{}})(req,null,new URL('http://x/gif?q=море'));
  check('GIF without a key has an explicit fallback',()=>{assert.equal(gifResult.status,200);assert.equal(gifResult.body.enabled,false);});
  console.log(`\nboards-test: ${checks} checks passed`);
} finally { await new Promise(resolve=>server.close(resolve)); await fs.rm(root,{recursive:true,force:true}); }
