import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createWorkbookApi, canDownloadWorkbook } from '../bot/src/workbook.js';
import { createWebAuth } from '../bot/src/web-auth.js';
const content = JSON.parse(fs.readFileSync(new URL('../app/content/content.json', import.meta.url)));
assert(!canDownloadWorkbook({trial_start:Date.now()}));
assert(!canDownloadWorkbook({premium_until:Date.now()-1}));
assert(canDownloadWorkbook({premium_until:Date.now()+60000}));
const db={users:{1:{premium_until:Date.now()+60000},2:{trial_start:Date.now()}}};
const auth=createWebAuth({token:'test',db,save(){}});
let result;
const api=createWorkbookApi({auth,db,content:()=>content,json:(res,status,body)=>result={status,body}});
const url=new URL('http://test/workbook/content?full=1&user_id=1');
for(const [headers,status] of [[{},401],[{authorization:'Bearer fake'},401],[{authorization:'Bearer '+auth.issue(2).session},403],[{authorization:'Bearer '+auth.issue(1).session},200]]) {
  api({method:'GET',headers},{},url); assert.equal(result.status,status);
}
const html=fs.readFileSync(new URL('../app/workbook.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*const esc[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g,'');
for(const status of [401,403,200,503]) {
  const dom=new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g,''),{url:'https://test/workbook.html?full=1',runScripts:'outside-only'});
  const w=dom.window; w.AbortSignal=AbortSignal;
  w.localStorage.setItem('dibitishka.v1',JSON.stringify({premium_until:Date.now()+99999999,trial_started_at:Date.now()}));
  w.fetch=async u=>({ok:!String(u).includes('/workbook/content')||status===200,status,json:async()=>String(u).includes('/workbook/content')?{ok:status===200,content}:content});
  w.eval(script);
  for(let n=0;n<100&&w.document.getElementById('page').textContent.includes('Загружаю');n++) await new Promise(r=>setTimeout(r,5));
  assert.equal(w.document.getElementById('download').hidden,status!==200);
  assert.equal(w.document.querySelectorAll('.practice').length,status===200?content.blocks.reduce((n,b)=>n+b.practices.length,0):5);
  if(status!==200){
    assert(w.document.querySelectorAll('.locked-practice').length>0);
    assert(!w.document.getElementById('page').textContent.includes(content.blocks[0].practices[1].steps[0]));
  }
  w.close();
}
console.log('Workbook: verified auth, paid/trial/expired access, forged query/localStorage, preview and full rendering passed.');
