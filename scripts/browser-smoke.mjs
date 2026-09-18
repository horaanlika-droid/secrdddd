#!/usr/bin/env node
/* Real Chromium: mobile layout, pixels, gallery/IndexedDB, EXIF, PNG/PDF export.
   No external services. `npx playwright install --with-deps chromium` first.
   A sandbox may pass PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH and LD_LIBRARY_PATH. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'test-results/ui'); await fs.mkdir(ART, { recursive: true });
/* Геометрия лица внутри позы: по ней проверяем, что в кадре меняется только лицо. */
const moodAtlas = JSON.parse(await fs.readFile(path.join(ROOT, 'app/assets/mascot/hero-moods.json'), 'utf8'));
/* v45: записи природы для тихой музыки отдаём audio/mp4 — ровно так же, как бот;
   с octet-stream decodeAudioData в части вебвью не срабатывает. */
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.m4a':'audio/mp4' };
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://x');
  if (url.pathname === '/gif') {
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify(url.searchParams.get('q') === 'море' ? {enabled:true,items:[{id:'1',title:'Море',url:'https://media.tenor.com/test.gif',preview:'https://media.tenor.com/test.gif'}]} : {enabled:false,items:[]}));
  }
  if (url.pathname === '/chat/status' || url.pathname === '/health') {res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"ok":true,"ai":false}');}
  const name = url.pathname === '/' ? 'index.html' : url.pathname === '/content.json' ? 'content/content.json' : url.pathname.slice(1);
  const file = path.resolve(ROOT,'app',name);
  if (!file.startsWith(path.join(ROOT,'app')+path.sep)) {res.writeHead(403);return res.end();}
  try {
    let bytes = await fs.readFile(file);
    if (name === 'config.js') bytes = Buffer.from(bytes.toString()+'\nwindow.DIBI_CONFIG.bot_public_url=location.origin;');
    res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});res.end(bytes);
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, checks=0;
/* Одна упавшая проверка не должна прятать остальные: собираем все падения,
   показываем их в конце и дублируем аннотацией — в CI полный лог большого
   шага не читается, а аннотацию видно прямо в проверках. */
const failures=[];
const check=(name,fn)=>{
  try {
    const result=fn();
    if(result&&typeof result.then==='function') throw new Error('проверка вернула промис: check() синхронный, await — снаружи');
    checks++; console.log('  ✓ '+name);
  }
  catch (e) {
    /* Первая строка ошибки assert — это наше пояснение («плашка с музыкой есть»),
       а суть (что именно не совпало) живёт дальше. В CI читается аннотация, а не
       лог шага, поэтому в неё кладём несколько строк, иначе вместо причины видно
       только заголовок проверки. */
    const lines=String((e&&e.message)||e).split('\n').map((l)=>l.replace(/\s+/g,' ').trim()).filter(Boolean);
    const message=lines.slice(0,8).join(' | ');
    failures.push({name,message});
    console.log('  ✗ '+name+(message?' — '+message:''));
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=${name}::${message.slice(0,800)}`);
  }
};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(orientation=6) {
  const width=80,height=40,data=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const color=y<20?(x<40?[240,20,20]:[20,190,20]):(x<40?[20,20,240]:[240,220,20]);
    const p=(y*width+x)*4;data.set([...color,255],p);
  }
  const raw=jpeg.encode({data,width,height},95).data;
  const exif=Buffer.alloc(36);exif.writeUInt16BE(0xffe1,0);exif.writeUInt16BE(34,2);exif.write('Exif',4);exif.writeUInt16BE(0x4949,10);exif.writeUInt16LE(42,12);exif.writeUInt32LE(8,14);exif.writeUInt16LE(1,18);exif.writeUInt16LE(0x0112,20);exif.writeUInt16LE(3,22);exif.writeUInt32LE(1,24);exif.writeUInt16LE(orientation,28);
  return Buffer.concat([raw.subarray(0,2),exif,raw.subarray(2)]);
}
try {
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote']});
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,acceptDownloads:true});
  const errors=[],missing=[],faceRequests=[],moodAtlasRequests=[];
  page.on('request',r=>{if(r.url().includes('/assets/mascot/faces/'))faceRequests.push(r.url());});
  page.on('request',r=>{if(r.url().includes('/assets/mascot/hero-moods.webp'))moodAtlasRequests.push(r.url());});
  const ambienceRequests=[];
  page.on('request',r=>{if(r.url().includes('/assets/ambience/'))ambienceRequests.push(r.url());});
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&r.url().startsWith(origin))missing.push(`${r.status()} ${r.url()}`);});
  await page.route('https://telegram.org/**',route=>route.abort());
  await page.route('https://media.tenor.com/**',route=>route.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'),headers:{'Access-Control-Allow-Origin':'*'}}));
  /* v40: install_hint_seen — подсказка про иконку всплывает сама, а этот прогон
     длинный и кликает по всему приложению: лист перехватывал бы чужие кнопки.
     Поведение всплывашки проверяется отдельной страницей ниже. */
  await page.addInitScript(()=>{if(!localStorage.getItem('dibitishka.v1'))localStorage.setItem('dibitishka.v1',JSON.stringify({onboarded:true,trial_started_at:Date.now(),mood_schema:2,install_hint_seen:true}));});
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.locator('#splash.gone').waitFor({state:'attached'});await page.waitForTimeout(500);
  await page.locator('.live-mascot').waitFor();
  /* Пиксельная проверка обещания «меняется только выражение лица»: снимаем
     персонажа целиком, ищем прямоугольник различий и сравниваем тело.
     Чтобы сравнивать именно персонажа, а не фон:
     — координаты считаем от документа: клики прокручивают страницу, и
       координаты окна поехали бы сами по себе, без движения персонажа;
     — на время снимка убираем всё, что рисуется за персонажем: fixed-градиент
       `#bg-blobs` и стекло карточки (`backdrop-filter` показывает фон, который
       зависит от положения в окне), ореол-подсветку, тосты и конфетти;
     — возвращаемся в начало страницы и выключаем проявление лица. */
  const HERO_ISOLATION=[
    'html,body{background:#fff!important}',
    '#bg-blobs,.hero::before,.hero-mascot-wrap::before,.toast,.confetti{display:none!important}',
    '.hero{background:#fff!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important}',
    '.live-mascot-face{animation:none!important}'
  ].join('');
  const heroShot=async(extra='')=>{
    await page.evaluate(()=>scrollTo(0,0));
    const tag=await page.addStyleTag({content:HERO_ISOLATION+extra});
    await page.waitForTimeout(60);
    const png=PNG.sync.read(await page.locator('.live-mascot').screenshot({animations:'disabled'}));
    await tag.evaluate(node=>node.remove());
    return png;
  };
  /* Сравнение двух кадров: прямоугольник, число различных пикселей, размеры
     обоих кадров и разбор по полосам (над лицом / лицо / ниже лица) с
     максимальной и средней разницей — по аннотации видно, что именно разошлось. */
  const diffStats=(a,b,faceBox)=>{
    const w=Math.min(a.width,b.width),h=Math.min(b.height,b.height||h);
    let box=null,count=0,maxDelta=0,maxOutside=0,sumDelta=0,above=0,inside=0,below=0,worst=null;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=(y*a.width+x)*4,j=(y*b.width+x)*4;
      const delta=Math.abs(a.data[i]-b.data[j])+Math.abs(a.data[i+1]-b.data[j+1])+Math.abs(a.data[i+2]-b.data[j+2]);
      if(delta===0) continue;
      count++; sumDelta+=delta;
      const inFace=!!faceBox&&y>=faceBox.y0&&y<=faceBox.y1&&x>=faceBox.x0&&x<=faceBox.x1;
      if(!inFace&&delta>maxOutside) maxOutside=delta;
      if(delta>maxDelta){maxDelta=delta; worst={x,y,a:[a.data[i],a.data[i+1],a.data[i+2]],b:[b.data[j],b.data[j+1],b.data[j+2]]};}
      box=box?{x0:Math.min(box.x0,x),y0:Math.min(box.y0,y),x1:Math.max(box.x1,x),y1:Math.max(box.y1,y)}:{x0:x,y0:y,x1:x,y1:y};
      if(inFace) inside++; else if(faceBox&&y<faceBox.y0) above++; else below++;
    }
    return {box,count,maxDelta,maxOutside,meanDelta:count?+(sumDelta/count).toFixed(1):0,above,inside,below,worst,
      aSize:[a.width,a.height],bSize:[b.width,b.height]};
  };
  const heroState=async()=>page.locator('.live-mascot').evaluate(node=>{const r=node.getBoundingClientRect(),face=node.querySelector('.live-mascot-face');
    return {hasMood:node.classList.contains('has-mood'),label:node.getAttribute('aria-label'),faceDisplay:getComputedStyle(face).display,
      faceX:face.style.getPropertyValue('--face-x'),faceY:face.style.getPropertyValue('--face-y'),base:node.querySelector('img').getAttribute('src'),
      rect:{x:Math.round(r.x+scrollX),y:Math.round(r.y+scrollY),w:Math.round(r.width),h:Math.round(r.height)},
      transform:getComputedStyle(node).transform};});
  const calm=await heroState();
  const calmPixels=await heroShot();
  // Самопроверка: два снимка одного и того же состояния обязаны совпасть.
  // Иначе «различия» ниже показывали бы шум съёмки, а не смену выражения.
  const repeatPixels=await heroShot();
  check('two shots of the same hero state are pixel-identical',()=>{
    const stats=diffStats(calmPixels,repeatPixels);
    assert.equal(stats.count,0,`различий ${stats.count} (${JSON.stringify(stats.box)}), кадры ${stats.aSize}/${stats.bSize}`);
  });
  check('hero starts as the calm hello.png: no mood yet, no atlas download',()=>{
    assert.equal(calm.hasMood,false);
    assert.equal(calm.faceDisplay,'none');
    assert(calm.base.includes('hello.png'));
    assert(!calm.label.includes('настроение:'));
    assert.deepEqual(moodAtlasRequests,[]);
  });
  const boxes=await page.locator('.mood').evaluateAll(nodes=>nodes.map(n=>({w:n.offsetWidth,h:n.offsetHeight,head:n.querySelector('.chip-face').offsetWidth})));
  const backgrounds=await page.locator('.chip-face').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundImage));
  check('all emotion heads load from one shared image',()=>{
    assert.equal(faceRequests.length,1);
    assert(faceRequests[0].endsWith('/faces/sprite.webp'));
    assert(backgrounds.every(background=>background.includes('/faces/sprite.webp')));
  });
  check('compact emotion controls keep accessible tap targets',()=>assert(boxes.every(b=>b.h<=74&&b.h>=44&&b.w>=44&&b.head===34)));
  await page.locator('#mood-note').fill('Полароид и море');await page.locator('.mood').nth(6).click();
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('dibitishka.v1')).mood_entries||[]);
  check('browser: selection is not a saved diary entry',()=>assert.equal(before.length,0));
  await page.locator('.mood-form').screenshot({path:path.join(ART,'emotions.png')});
  await page.getByRole('button',{name:'Оставить запись',exact:true}).click();
  // Первый значок («Первый отклик») запускает конфетти поверх экрана, в том
  // числе над персонажем: для пиксельного сравнения ждём, пока оно уберётся.
  await page.waitForFunction(()=>!document.querySelector('.confetti'));
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('dibitishka.v1')).mood_entries);
  check('browser: confirm saves chosen emotion and note together',()=>{assert.equal(after.length,1);assert.equal(after[0].note,'Полароид и море');});
  const mood=await heroState();
  const moodPixels=await heroShot();
  check('hero face changes right after the mood is confirmed (no reload)',()=>{
    assert.equal(mood.hasMood,true);
    assert.equal(mood.faceDisplay,'block');
    assert(mood.label.includes('Радостно'),mood.label);
    assert.equal(mood.faceX,'100%');            // «Радостно» → ячейка 7 сетки 4×3
    assert.equal(mood.faceY,'50%');
    // Лица всех эмоций — в одном файле: сколько бы раз он ни запрашивался,
    // это всегда одна и та же сетка, а не картинка на каждое настроение.
    assert(moodAtlasRequests.length>=1);
    assert(moodAtlasRequests.every(url=>url.includes('/assets/mascot/hero-moods.webp')));
  });
  check('hero never moves, scales or sways when the expression changes',()=>{
    assert.equal(mood.transform,'none');
    assert.deepEqual(mood.rect,calm.rect,`${JSON.stringify(calm.rect)} → ${JSON.stringify(mood.rect)}`);
  });
  /* Тот же кадр, но слой лица принудительно скрыт: если он совпадает со
     спокойным снимком до отметки, значит сам персонаж не изменился ни на
     пиксель — добавилось ровно одно лицо. */
  const noFacePixels=await heroShot('.live-mascot-face{display:none!important}');
  const faceBox=()=>{const scale=moodPixels.width/1024,face=moodAtlas.box,slack=3;
    return {x0:Math.floor(face[0]*scale)-slack,y0:Math.floor(face[1]*scale)-slack,
      x1:Math.ceil(face[2]*scale)+slack,y1:Math.ceil(face[3]*scale)+slack};};
  check('mood does not repaint the character: the same frame without the face layer is identical',()=>{
    const stats=diffStats(calmPixels,noFacePixels,faceBox());
    assert.equal(stats.count,0,`различий ${stats.count} px (${JSON.stringify(stats.box)}), дельта ${stats.maxDelta}, `
      +`полосы над/в/под лицом ${stats.above}/${stats.inside}/${stats.below}, кадры ${stats.aSize}/${stats.bSize}`);
  });
  /* Сравниваем один и тот же кадр со слоем лица и без него. Вне области лица
     допустим только шум сглаживания (несколько единиц из 255 на пиксель):
     заметное движение или перерисовка тела дают большую разницу на контурах.
     Кадры при этом одинакового размера и сняты в одном состоянии страницы,
     поэтому все крупные различия обязаны лежать внутри лица. */
  /* Независимая проверка того же обещания: на белом фоне (фон мы убрали выше)
     считаем, где находится сам персонаж и сколько места он занимает. Если бы
     тело сдвинулось, изменило размер или перерисовалось, контур или площадь
     поехали бы заметно — это видно даже при шуме сглаживания. */
  const inkBox=png=>{let x0=png.width,y0=png.height,x1=-1,y1=-1,count=0;
    for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
      const i=(y*png.width+x)*4;
      if(255-Math.min(png.data[i],png.data[i+1],png.data[i+2])<=24) continue;
      count++; x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x); y1=Math.max(y1,y);
    }
    return {x0,y0,x1,y1,count};};
  check('the character keeps its outline and area: the body did not move or scale',()=>{
    const plain=inkBox(noFacePixels), withFace=inkBox(moodPixels);
    assert.deepEqual([withFace.x0,withFace.y0,withFace.x1,withFace.y1],[plain.x0,plain.y0,plain.x1,plain.y1],
      `контур ${JSON.stringify(plain)} → ${JSON.stringify(withFace)}`);
    const drift=Math.abs(withFace.count-plain.count)/plain.count;
    // Порог вольный: пиксели у самого порога «чернил» могут перескочить из-за
    // сглаживания, но сдвиг или масштаб тела двигают счёт в разы заметнее.
    assert(drift<0.03,`закрашенных пикселей ${plain.count} → ${withFace.count} (${(drift*100).toFixed(2)}%)`);
  });
  check('only the face pixels change: body, hood and hands stay identical',()=>{
    const box=faceBox(), AA_TOLERANCE=24;
    const stats=diffStats(noFacePixels,moodPixels,box);
    const detail=`различий ${stats.count} px, прямоугольник ${JSON.stringify(stats.box)}, `
      +`максимум вне лица ${stats.maxOutside}${stats.worst?` (${JSON.stringify(stats.worst)})`:''}, `
      +`полосы над/в/под лицом ${stats.above}/${stats.inside}/${stats.below}, кадры ${stats.aSize}/${stats.bSize}`;
    assert(stats.inside>0,`лицо настроения действительно нарисовано: ${detail}`);
    assert(stats.maxOutside<=AA_TOLERANCE,`вне лица различия больше шума сглаживания (${AA_TOLERANCE}): ${detail}`);
  });
  await page.reload({waitUntil:'networkidle'});await page.locator('#splash.gone').waitFor({state:'attached'});await page.waitForTimeout(500);
  const reloaded = await page.evaluate(()=>JSON.parse(localStorage.getItem('dibitishka.v1')).mood_entries);
  check('browser: confirmation persists through reload',()=>assert.deepEqual(reloaded,after));
  const afterReload=await heroState();
  check('hero face survives reload: it comes from the diary, not from one render',()=>{
    assert.equal(afterReload.hasMood,true);
    assert(afterReload.label.includes('Радостно'));
    assert.equal(afterReload.faceX,'100%');
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  const reduced=await page.evaluate(()=>({running:document.querySelector('.live-mascot').getAnimations({subtree:true}).length,
    face:getComputedStyle(document.querySelector('.live-mascot-face')).display,base:document.querySelector('.live-mascot-base').naturalWidth}));
  check('reduced motion: still mood face, nothing animating',()=>{assert.equal(reduced.running,0);assert.equal(reduced.face,'block');assert(reduced.base>0);});
  await page.emulateMedia({reducedMotion:'no-preference'});
  // Both native bitmap decoding and the explicit EXIF fallback: all 8 orientations.
  for(const fallback of [false,true]) for(let orientation=1;orientation<=8;orientation++) {
    const result=await page.evaluate(async({encoded,fallback,orientation})=>{
      const tools=await import('/js/image-tools.js');
      const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
      const original=window.createImageBitmap;
      if(fallback)window.createImageBitmap=undefined;
      let compressed;try{compressed=await tools.compressImage(new File([bytes],'camera.jpg',{type:'image/jpeg'}));}finally{window.createImageBitmap=original;}
      const bitmap=await original(compressed);
      const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const g=c.getContext('2d');g.drawImage(bitmap,0,0);bitmap.close();
      const matrix=tools.orientationTransform(orientation,80,40);
      const samples=[[20,10],[60,10],[20,30],[60,30]].map(([x,y])=>Array.from(g.getImageData(Math.min(c.width-1,matrix[0]*x+matrix[2]*y+matrix[4]),Math.min(c.height-1,matrix[1]*x+matrix[3]*y+matrix[5]),1,1).data).slice(0,3));
      return {width:c.width,height:c.height,samples};
    },{encoded:fixture(orientation).toString('base64'),fallback,orientation});
    check(`camera orientation ${orientation}, ${fallback?'EXIF fallback':'native bitmap'} has correct pixels`,()=>{
      assert.equal(result.width,orientation>=5?40:80);assert.equal(result.height,orientation>=5?80:40);
      const expected=[[240,20,20],[20,190,20],[20,20,240],[240,220,20]];
      result.samples.forEach((color,i)=>color.forEach((value,j)=>assert(Math.abs(value-expected[i][j])<35,`${i}:${j} expected ${expected[i][j]}, got ${value}`)));
    });
  }
  await page.goto(origin+'/#/boards');await page.locator('.boards-hero img').waitFor();
  await page.screenshot({path:path.join(ART,'boards.png'),fullPage:true});
  await page.getByRole('button',{name:'+ Новая доска',exact:true}).click();
  await page.getByRole('textbox',{name:'Название доски',exact:true}).fill('Море и маленькие радости');
  await page.getByRole('button',{name:'Создать',exact:true}).click();
  await page.getByRole('button',{name:'+ Добавить',exact:true}).click();
  await page.getByRole('button',{name:/Заметка, стихи, мысль/}).click();await page.waitForTimeout(450);
  await page.getByRole('textbox',{name:'Текст заметки',exact:true}).fill('Море шумит.\nА я могу просто быть.');
  await page.locator('.sheet.on .board-input').fill('море, тепло');
  await page.getByRole('button',{name:'Добавить на доску',exact:true}).click();
  await page.getByRole('button',{name:'+ Добавить',exact:true}).click();
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:/Фото из галереи/}).click();
  await (await chooser).setFiles([{name:'rotated-camera.jpg',mimeType:'image/jpeg',buffer:fixture(6)},{name:'memory.webp',mimeType:'image/webp',buffer:await fs.readFile(path.join(ROOT,'app/assets/boards/creative-mess.webp'))}]);
  await page.waitForFunction(()=>document.querySelectorAll('.tile-photo img').length===2&&[...document.querySelectorAll('.tile-photo img')].every(img=>img.complete&&img.naturalWidth));
  const gallerySize=await page.locator('.tile-photo img').first().evaluate(img=>[img.naturalWidth,img.naturalHeight]);
  check('gallery batch uploads preserve camera orientation in IndexedDB',()=>assert.deepEqual(gallerySize,[40,80]));
  const boardRoute=page.url();
  await page.reload({waitUntil:'networkidle'});await page.locator('#splash.gone').waitFor({state:'attached'});await page.waitForTimeout(500);
  await page.waitForFunction(()=>[...document.querySelectorAll('.tile-photo img')].length===2&&[...document.querySelectorAll('.tile-photo img')].every(img=>img.naturalWidth));
  await page.locator('.board-search').fill('море');
  await page.locator('.board-search').fill('');
  await page.waitForFunction(()=>document.querySelectorAll('.tile-photo img').length===2&&[...document.querySelectorAll('.tile-photo img')].every(img=>img.naturalWidth));
  check('images survive reload and filter redraw',()=>assert.equal(page.url(),boardRoute));
  /* Доска — свободный коллаж (итерация 43): плитки лежат абсолютно и по замыслу
     наезжают друг на друга. Поэтому «кликни первую плитку» в лоб не работает —
     Playwright честно ждёт, что клик достанется именно ей, а его перехватывает
     соседняя плитка, и через 30 с сценарий обрывается. Ищем точку, где нужная
     плитка действительно сверху: ровно так же её открыл бы человек. Заодно это
     содержательная проверка — фото, целиком закрытое соседями, не открыть. */
  const tilePoint=async(sel)=>{
    await page.locator(sel).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    return page.evaluate((s)=>{
      const tiles=[...document.querySelectorAll(s)];
      const spots=[[.5,.5],[.5,.3],[.3,.5],[.7,.5],[.5,.7],[.25,.25],[.75,.25],[.25,.75],[.75,.75],[.5,.15],[.5,.85]];
      for(let i=0;i<tiles.length;i++){
        const r=tiles[i].getBoundingClientRect();
        if(r.bottom<0||r.top>innerHeight) continue;
        for(const [fx,fy] of spots){
          const x=Math.round(r.left+r.width*fx),y=Math.round(r.top+r.height*fy);
          const hit=document.elementFromPoint(x,y);
          if(hit&&tiles[i].contains(hit)) return {index:i,x,y};
        }
      }
      return null;
    },sel);
  };
  const photoTap=await tilePoint('.tile-photo');
  check('свободный холст: фото открывается касанием, а не спрятано под соседями',()=>assert(photoTap,'ни одна точка фото-плитки не доступна для касания — её не открыть'));
  await page.mouse.click(photoTap.x,photoTap.y);
  await page.getByRole('button',{name:'Поставить фоном доски',exact:true}).click();
  await page.reload({waitUntil:'networkidle'});await page.locator('#splash.gone').waitFor({state:'attached'});await page.waitForTimeout(500);
  await page.waitForFunction(()=>document.querySelector('.board-space-bg').style.backgroundImage.includes('blob:'));
  const photoTap2=await tilePoint('.tile-photo');
  check('после перезагрузки фото снова можно открыть касанием',()=>assert(photoTap2,'после перезагрузки плитка фото недоступна для касания'));
  await page.mouse.click(photoTap2.x,photoTap2.y);
  await page.getByRole('button',{name:'Убрать с доски',exact:true}).click();
  await page.reload({waitUntil:'networkidle'});await page.locator('#splash.gone').waitFor({state:'attached'});await page.waitForTimeout(500);
  await page.waitForFunction(()=>document.querySelector('.board-space-bg').style.backgroundImage.includes('blob:'));
  const remainingPhotos=await page.locator('.tile-photo').count();
  check('photo used as background survives deleting its tile and reload',()=>assert.equal(remainingPhotos,1));
  await page.getByRole('button',{name:'+ Добавить',exact:true}).click();await page.getByRole('button',{name:/Гифка/}).click();
  await page.getByRole('searchbox',{name:'Поиск GIF',exact:true}).fill('море');await page.getByRole('button',{name:'Найти',exact:true}).click();
  await page.locator('.gif-result').first().click();await page.getByRole('button',{name:'Добавить на доску',exact:true}).click();
  await page.locator('.tile-gif img').waitFor();
  await page.getByRole('button',{name:'Сохранить и распечатать',exact:true}).click();
  await page.getByRole('button',{name:'Скачать PDF',exact:true}).waitFor({timeout:30000});
  const pdfDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать PDF',exact:true}).click();
  const pdfPath=await (await pdfDownload).path(), pdf=await fs.readFile(pdfPath);
  check('PDF is a real printable file',()=>{assert.equal(pdf.subarray(0,8).toString(),'%PDF-1.4');assert(pdf.includes(Buffer.from('startxref')));assert(pdf.length>10000);});
  const pngDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать PNG',exact:true}).click();
  const pngPath=await (await pngDownload).path(), png=PNG.sync.read(await fs.readFile(pngPath));
  check('PNG exports an actual high-resolution board',()=>{assert.equal(png.width,1200);assert.equal(png.height,1697);});
  await fs.copyFile(pngPath,path.join(ART,'board-export.png'));await fs.copyFile(pdfPath,path.join(ART,'board-export.pdf'));
  await page.keyboard.press('Escape');await page.waitForTimeout(400);
  // Long notes at maximum tilt: no clipping at the board boundary.
  await page.evaluate(()=>{
    const key='dibitishka.boards.v1.guest';const boards=JSON.parse(localStorage.getItem(key));const b=boards.find(b=>b.title==='Море и маленькие радости');
    b.bg='sky';delete b.bgKey;b.tiles[0].rot=8;b.tiles[0].text='Длинная строка о море и о том, как можно просто быть. '.repeat(60);localStorage.setItem(key,JSON.stringify(boards));
  });
  await page.reload({waitUntil:'networkidle'});await page.locator('#splash.gone').waitFor({state:'attached'});await page.waitForTimeout(500);
  const longText=await page.locator('.tile-note-copy').innerText();
  check('maximum-tilt test really uses the long saved note',()=>assert(longText.length>2500));
  /* ---------- v44: тихая музыка в настоящем Web Audio ----------
     jsdom Web Audio не умеет, поэтому генераторы, панораму и свёртку
     проверяем только здесь. Зонд ставится до навигации: движок
     запоминает AudioContext в момент создания, подменять его задним
     числом бесполезно. */
  await page.addInitScript(()=>{
    window.__ctxCount=0;window.__osc=[];window.__pans=0;window.__convolvers=0;
    const Real=window.AudioContext||window.webkitAudioContext;
    if(!Real)return;
    window.AudioContext=class extends Real{
      constructor(opts){super(opts);window.__ctxCount++;}
      createOscillator(){
        const node=super.createOscillator();
        const inner=node.start.bind(node);
        node.start=(...args)=>{window.__osc.push({type:node.type,freq:node.frequency.value});return inner(...args);};
        return node;
      }
      createStereoPanner(){window.__pans++;return super.createStereoPanner();}
      createConvolver(){window.__convolvers++;return super.createConvolver();}
    };
  });
  /* Переход с «/#/boards/...» на «/#/sound» меняет только якорь: документ не
     перезагружается, и зонд, поставленный через addInitScript, не появляется.
     Поэтому грузим страницу по-настоящему — иначе window.__osc нет, и раздел
     музыки падает на первом же evaluate. */
  await page.goto(origin+'/#/sound',{waitUntil:'networkidle'});
  await page.reload({waitUntil:'networkidle'});
  await page.locator('#splash.gone').waitFor({state:'attached'});await page.waitForTimeout(400);
  const probe=await page.evaluate(()=>({ctx:typeof window.__ctxCount,osc:Array.isArray(window.__osc),pan:typeof window.__pans}));
  check('зонд Web Audio поставлен до загрузки приложения',()=>{
    assert.equal(probe.ctx,'number','window.__ctxCount не появился: addInitScript не отработал');
    assert.equal(probe.osc,true,'window.__osc не массив — считать генераторы нечем');
    assert.equal(probe.pan,'number','window.__pans не появился');
  });
  const musicCopy=await page.evaluate(()=>({
    explain:(document.querySelector('.sound-what')||{}).innerText||'',
    chord:(document.querySelector('.sound-chord')||{}).innerText||'',
    notes:(document.querySelector('.sound-notes')||{}).innerText||'',
    scenes:document.querySelectorAll('.sound-scene').length,
    times:document.querySelectorAll('.sound-time').length,
    headphones:document.querySelectorAll('.sound-headphones,.sound-formula').length
  }));
  check('экран тихой музыки объясняет генерацию, а не бинауральные ритмы',()=>{
    assert(musicCopy.explain.includes('не повторяется'),'сказано, что музыка каждый раз другая');
    assert(musicCopy.explain.includes('без интернета'),'сказано, что интернет не нужен');
    assert(/[A-G]/.test(musicCopy.chord),`показан живой аккорд: ${musicCopy.chord}`);
    assert(/[A-G]\d/.test(musicCopy.notes),`перечислены ноты: ${musicCopy.notes}`);
    assert.equal(musicCopy.scenes,6,'шесть сцен');
    assert.equal(musicCopy.times,5,'пять длительностей');
    assert.equal(musicCopy.headphones,0,'механики ритмов на экране больше нет');
  });
  await page.getByRole('button',{name:'Включить',exact:true}).click();
  await page.waitForTimeout(700);
  const playing=await page.evaluate(()=>({
    ctx:window.__ctxCount,osc:window.__osc.length,pans:window.__pans,conv:window.__convolvers,
    clock:(document.querySelector('.sound-clock')||{}).textContent||'',
    label:(document.querySelector('.sound-play')||{}).innerText||''
  }));
  check('музыка строится в реальном Web Audio: голоса, панорама, свёртка',()=>{
    assert.equal(playing.ctx,1,'аудиоконтекст создан один раз');
    assert.ok(playing.osc>=8,`генераторов ${playing.osc}: два на голос, не меньше четырёх голосов`);
    /* голос — это по четыре частичных тона на ноту и до двух фраз на аккорд,
       поэтому генераторов заметно больше, чем в версии с одним полотном */
    assert.ok(playing.osc<=200,`генераторов ${playing.osc} — слишком много для одной сессии`);
    assert.ok(playing.pans>=4,`панорама есть у ${playing.pans} голосов`);
    assert.equal(playing.conv,1,'свёрточное эхо собрано один раз');
    assert.ok(/^(\d+:\d\d|∞)$/.test(playing.clock.trim()),`отсчёт сессии: ${playing.clock}`);
    assert(playing.label.includes('Пауза'),`кнопка стала паузой: ${playing.label}`);
  });
  /* v45: записи природы — настоящая сеть, настоящий decodeAudioData.
     Сначала спрашиваем сам браузер, умеет ли он вообще расшифровать AAC:
     в сборках Chromium без проприетарных кодеков decodeAudioData честно
     откажет, и тогда проверять надо не запись, а фолбэк — движок обязан
     остаться на запасном шуме и написать об этом на экране. */
  const aacOk = await page.evaluate(async () => {
    try {
      const r = await fetch('assets/ambience/chimes.m4a');
      if (!r.ok) return false;
      const bytes = await r.arrayBuffer();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      return await new Promise((res) => {
        let done = false;
        const fin = (v) => { if (!done) { done = true; try { ctx.close(); } catch (e) {} res(v); } };
        let p;
        try { p = ctx.decodeAudioData(bytes, () => fin(true), () => fin(false)); } catch (e) { fin(false); }
        /* Chromium возвращает промис, даже когда переданы обратные вызовы.
           Отказ надо забрать: иначе «Unable to decode audio data» всплывает
           ошибкой страницы и валит проверку «нет ошибок страницы», хотя
           приложение этот отказ обрабатывает (app/js/ambient.js, decodeAudio). */
        if (p && typeof p.then === 'function') p.then(() => {}, () => {});
        setTimeout(() => fin(false), 4000);
      });
    } catch (e) { return false; }
  });
  if (!aacOk) console.log('  · этот Chromium не расшифровал AAC — проверяю честный фолбэк на запасной шум');
  await page.waitForTimeout(2500);   // петля сцены успевает доехать и сменить запасной шум
  const airNow=await page.evaluate(()=>({
    air:(document.querySelector('.sound-air')||{}).textContent||'',
    motif:(document.querySelector('.sound-motif')||{}).textContent||'',
    mixers:document.querySelectorAll('.sound-mixer').length,
    voiceLabel:(document.querySelector('.sound-mixer:nth-child(3) .sound-val')||{}).textContent||'',
    label:(document.querySelector('.sound-play')||{}).innerText||''
  }));
  check('запись сцены загружается, декодируется и становится воздухом',()=>{
    assert(ambienceRequests.some(u=>u.endsWith('/assets/ambience/sea.m4a')),'браузер реально запросил петлю моря');
    if (aacOk) assert(airNow.air.includes('настоящая запись'),`строка воздуха: ${airNow.air}`);
    else assert(airNow.air.includes('запасной шум'),`браузер не умеет AAC — экран обязан сказать про запасной шум: ${airNow.air}`);
    /* фраза приходит не сразу (первая нота — через 4–27 с), поэтому экран
       обязан показывать либо ноты звучащей фразы, либо честное ожидание */
    assert(/[A-G]\d/.test(airNow.motif)||airNow.motif.includes('ждём фразу'),`строка мотива: ${airNow.motif}`);
    assert.equal(airNow.mixers,3,'микшера три: громкость, воздух, голос');
    assert(/%|выключен/.test(airNow.voiceLabel),`значение «Голоса»: ${airNow.voiceLabel}`);
    assert(airNow.label.includes('Пауза'),'музыка продолжает идти');
  });
  await page.evaluate(()=>{const b=[...document.querySelectorAll('.sound-scene')].find(x=>x.textContent.includes('Дождь'));b&&b.click();});
  await page.waitForTimeout(2500);
  const switched=await page.evaluate(()=>({
    air:(document.querySelector('.sound-air')||{}).textContent||'',
    scene:(document.querySelector('.sound-scene.on')||{}).textContent||'',
    label:(document.querySelector('.sound-play')||{}).innerText||''
  }));
  check('смена сцены на ходу подгружает другую запись и не прерывает музыку',()=>{
    assert(switched.scene.includes('Дождь'),`выбрана сцена: ${switched.scene}`);
    if (aacOk) assert(switched.air.includes('настоящая запись'),`воздух после смены: ${switched.air}`);
    else assert(switched.air.includes('запасной шум'),`воздух после смены (без AAC): ${switched.air}`);
    assert(ambienceRequests.some(u=>u.endsWith('/assets/ambience/rain.m4a')),'браузер запросил петлю дождя');
    assert(switched.label.includes('Пауза'),'сессия не прервалась');
  });
  const ambienceFiles=await page.evaluate(async()=>{
    const out=[];
    for(const n of ['sea','rain','hearth','forest','lullaby','space','chimes']){
      const r=await fetch('assets/ambience/'+n+'.m4a');
      const b=await r.arrayBuffer();
      out.push({name:n,ok:r.ok,type:r.headers.get('content-type'),bytes:b.byteLength});
    }
    return out;
  });
  check('семь записей отдаются с audio/mp4 и укладываются в 3 МБ',()=>{
    let total=0;
    for(const f of ambienceFiles){
      assert(f.ok,`${f.name}: файл не отдался`);
      assert.equal(f.type,'audio/mp4',`${f.name}: тип ${f.type} — с ним decodeAudioData работает не везде`);
      total+=f.bytes;
    }
    for(const f of ambienceFiles.filter(x=>x.name!=='chimes')){
      assert(f.bytes>=250*1024&&f.bytes<=600*1024,`${f.name}: ${Math.round(f.bytes/1024)} КБ вне бюджета 250–600 КБ`);
    }
    assert(total<=3*1024*1024,`весь звук ${(total/1048576).toFixed(2)} МБ — бюджет 3 МБ`);
  });
  await page.screenshot({path:path.join(ART,'sound-screen.png'),fullPage:true});
  /* Музыка не должна обрываться при переходе на другой экран. Переходим так,
     как это делает человек, — тапом по вкладке, то есть сменой якоря внутри
     приложения: page.goto(origin+'/') может перезагрузить документ, и тогда
     проверка измерит не «музыка пережила переход», а «страница перезагрузилась»
     (вместе с ней обнуляется и зонд, и движок). */
  await page.evaluate(()=>{location.hash='';});
  await page.waitForTimeout(600);
  const onHome=await page.evaluate(()=>({
    pill:document.querySelectorAll('.sound-pill').length,
    teaser:(document.querySelector('.sound-teaser')||{}).className||'',
    hash:location.hash,
    ctxCount:window.__ctxCount,
    osc:(window.__osc||[]).length,
    pillText:(document.querySelector('.sound-pill-copy')||{}).textContent||''
  }));
  check('музыка переживает переход на главную: плашка и живой тизер',()=>{
    assert(onHome.ctxCount>=1,`документ перезагрузился, зонд обнулился: ${JSON.stringify(onHome)}`);
    assert.equal(onHome.pill,1,`плашка с музыкой: ${JSON.stringify(onHome)}`);
    assert(onHome.teaser.includes('on'),`тизер показывает идущую сессию: ${onHome.teaser}`);
  });
  await page.evaluate(()=>{
    const btn=document.querySelector('.sound-stop:not(.hidden)')||document.querySelector('.sound-pill-stop');
    btn&&btn.click();
  });
  await page.waitForTimeout(1100);
  const afterStop=await page.evaluate(()=>({
    pill:document.querySelectorAll('.sound-pill').length
  }));
  check('музыка выключается и сессия не остаётся висеть',()=>assert.equal(afterStop.pill,0,'плашки сессии нет'));
  await page.goto(origin+'/#/music',{waitUntil:'networkidle'});await page.locator('#splash.gone').waitFor({state:'attached'});await page.waitForTimeout(400);
  const musicRoute=await page.evaluate(()=>({
    title:(document.querySelector('.navbar h2')||{}).innerText||'',
    label:(document.querySelector('.sound-play')||{}).innerText||''
  }));
  check('адрес #/music — тот же экран, и после остановки плеер снова предлагает включить',()=>{
    assert(musicRoute.title.includes('Тихая музыка'),`заголовок экрана: ${musicRoute.title}`);
    assert(musicRoute.label.includes('Включить'),`кнопка вернулась в «Включить»: ${musicRoute.label}`);
  });
  await page.evaluate(()=>{window.__ctxCount=0;window.__osc=[];window.__pans=0;window.__convolvers=0;});



  for(const width of [320,390,768]) {
    await page.setViewportSize({width,height:900});
    // 'install' последним: в v40 это не экран, а лист поверх «Сегодня» — пусть он откроется в самом конце прогона
    for(const route of ['', 'sound','skills','profile','boards',boardRoute.split('#/')[1],'install']) {
      await page.goto(origin+'/#/'+route,{waitUntil:'networkidle'});await page.locator('#splash.gone').waitFor({state:'attached'});await page.waitForTimeout(500);
      const layout=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,bar:document.querySelector('#tabbar').hidden?getComputedStyle(document.querySelector('#tabbar')).display:'visible',nav:(()=>{const back=document.querySelector('.navbar .back'),title=document.querySelector('.navbar h2');return back&&title?back.getBoundingClientRect().right<=title.getBoundingClientRect().left:true;})()}));
      check(`${width}px ${route||'home'}: no horizontal overflow or navbar collision`,()=>{assert(layout.scroll<=layout.viewport,JSON.stringify(layout));assert(layout.nav);if(['boards','board'].includes(route.split('/')[0]))assert.equal(layout.bar,'none');});
      if(route.startsWith('board/')) {
        /* Доска — свободный коллаж (итерация 43): плитки повёрнуты и могут
           выступать за холст, это замысел. Обязательное другое — плитка не
           должна уезжать за экран (иначе до неё не дотянуться и появляется
           горизонтальная прокрутка). Насколько плитки выступают за холст,
           печатаем в лог: по этим числам видно, не уехал ли коллаж слишком. */
        const fit=await page.locator('.tile').evaluateAll(tiles=>{
          return tiles.map((tile,i)=>{
            const canvas=tile.closest('.board-canvas');
            if(!canvas) return {i,none:true};
            const a=tile.getBoundingClientRect();                       /* повёрнутая коробка */
            const w=tile.offsetWidth,h=tile.offsetHeight;               /* коробка до поворота */
            const rot=parseFloat(getComputedStyle(tile).getPropertyValue('--rot'))||0;
            const rad=Math.abs(rot*Math.PI/180);
            /* насколько поворот вообще может расширить коробку — считаем из
               размеров и угла этой же плитки, а не на глаз */
            const growH=Math.max(0,(w*Math.abs(Math.cos(rad))+h*Math.abs(Math.sin(rad))-w)/2);
            const growV=Math.max(0,(w*Math.abs(Math.sin(rad))+h*Math.abs(Math.cos(rad))-h)/2);
            const b=canvas.getBoundingClientRect();
            return {i,rot:Math.round(rot*10)/10,w,h,
              hidden:!w||!h,
              /* раскладка (left/top/width) — внутри холста: за его краем
                 плитку не увидеть целиком и не достать пальцем */
              layoutOver:Math.round(Math.max(-tile.offsetLeft,-tile.offsetTop,
                tile.offsetLeft+w-canvas.clientWidth,tile.offsetTop+h-canvas.clientHeight,0)),
              /* повёрнутая коробка против холста и против экрана */
              overCanvas:Math.round(Math.max(b.left-a.left,a.right-b.right,b.top-a.top,a.bottom-b.bottom,0)),
              outView:Math.round(Math.max(-a.left,a.right-innerWidth,0)),
              growH:Math.round(growH),growV:Math.round(growV)};
          });
        });
        const real=fit.filter(t=>!t.none&&!t.hidden);
        const worst=(k)=>real.length?Math.max(...real.map(t=>t[k])):0;
        const notice=`${width}px доска: плиток ${real.length}/${fit.length}, поворот до ${worst('rot')}°, раскладка за холстом до ${worst('layoutOver')}px, повёрнутая коробка за холстом до ${worst('overCanvas')}px (поворот объясняет ${worst('growH')}px), за экраном до ${worst('outView')}px`;
        console.log('  · '+notice);
        if (process.env.GITHUB_ACTIONS) console.log(`::notice title=доска ${width}px::${notice}`);
        check(`${width}px rotated tiles stay inside board`,()=>{
          assert.equal(fit.filter(t=>t.none).length,0,`плитки вне холста: ${JSON.stringify(fit.filter(t=>t.none))}`);
          const badLayout=real.filter(t=>t.layoutOver>1);
          assert.equal(badLayout.length,0,`раскладка плитки вылезла за холст (поворот ни при чём): ${JSON.stringify(badLayout.slice(0,3))}`);
          /* за край экрана плитку может вытолкнуть только её собственный поворот */
          const badView=real.filter(t=>t.outView>t.growH+1);
          assert.equal(badView.length,0,`плитка за экраном больше, чем объясняет поворот: ${JSON.stringify(badView.slice(0,3))}`);
          const badCanvas=real.filter(t=>t.overCanvas>Math.max(t.growH,t.growV)+1);
          assert.equal(badCanvas.length,0,`повёрнутая коробка дальше от холста, чем объясняет поворот: ${JSON.stringify(badCanvas.slice(0,3))}`);
        });
        await page.screenshot({path:path.join(ART,`board-${width}.png`),fullPage:true});
      }
    }
  }
  const multi = await page.evaluate(async()=>{
    const { renderBoardPages, boardPdf } = await import('/js/board-export.js');
    const b = JSON.parse(localStorage.getItem('dibitishka.boards.v1.guest')).find(b=>b.title==='Море и маленькие радости');
    // 4000 chars with real newlines, plus an unavailable photo: export must
    // include every line and show a warning, not silently drop a tile.
    b.bg='sky';b.tiles=[{id:'long',kind:'note',text:'Берег, ракушки, любимые строки.\n'.repeat(100),tags:[],rot:8},
      {id:'missing',kind:'photo',src:'missing',caption:'Важное фото',tags:[],rot:0}];
    const {pages,warnings}=await renderBoardPages(b,{mediaUrl:async()=>''});
    const pdf=await boardPdf(pages);
    return {pages:pages.length,warnings,bytes:pdf.size};
  });
  check('long poems produce multiple PDF pages and missing media is explicit',()=>{assert(multi.pages>1);assert(multi.warnings.length);assert(multi.bytes>10000);});
  /* v40: подсказка про иконку на экран «Домой» — маленькая всплывашка со ссылкой
     на мини-приложение. Проверяем вживую: всплывает сама ровно один раз, много
     экрана не занимает, на «Сегодня» под неё ничего не стоит, «Позже» откладывает. */
  const hintPage=await browser.newPage({viewport:{width:390,height:844}});
  hintPage.on('pageerror',e=>errors.push(e.message));
  hintPage.on('response',r=>{if(r.status()>=400&&r.url().startsWith(origin))missing.push(`${r.status()} ${r.url()}`);});
  await hintPage.route('https://telegram.org/**',route=>route.abort());
  // Состояние не перезаписываем на каждой навигации: «Позже» должно пережить переходы
  await hintPage.addInitScript(()=>{if(!localStorage.getItem('dibitishka.v1'))localStorage.setItem('dibitishka.v1',JSON.stringify({onboarded:true,trial_started_at:Date.now(),mood_schema:2}));});
  await hintPage.goto(origin,{waitUntil:'networkidle'});
  await hintPage.locator('.sheet-install.on').waitFor({timeout:20000});
  const autoHint=await hintPage.evaluate(()=>{
    const sh=document.querySelector('.sheet-install');
    return {seen:JSON.parse(localStorage.getItem('dibitishka.v1')).install_hint_seen===true,
            link:sh.querySelector('.install-link code').textContent,
            steps:document.querySelectorAll('.sheet-install .install-step').length,
            teaser:!!document.querySelector('#app .install-teaser'),
            clean:!sh.textContent.includes('null'),
            head:sh.querySelector('.install-head h3').textContent,
            ico:sh.querySelector('.install-ico').getAttribute('src')};
  });
  check('the hint pops up by itself once: mini app link, one platform step, no card on home',()=>{
    assert.equal(autoHint.seen,true);
    assert.equal(autoHint.link,'t.me/dbtrobot/dibitishka');
    assert.equal(autoHint.steps,1);
    assert.equal(autoHint.teaser,false);
    assert.equal(autoHint.head,'Иконка на экран «Домой»');
    assert(autoHint.ico.includes('assets/icons/apple-touch-180.png'));
    assert.equal(autoHint.clean,true,'no literal «null» text inside the sheet');
  });
  await hintPage.getByRole('button',{name:'Позже'}).click();
  await hintPage.waitForTimeout(500);
  const snoozed=await hintPage.evaluate(()=>{const st=JSON.parse(localStorage.getItem('dibitishka.v1'));return{days:(st.install_snoozed-Date.now())/86400000,seen:st.install_hint_seen,open:!!document.querySelector('.sheet-install.on')};});
  check('«Позже» closes the sheet and snoozes the hint for about a week',()=>{
    assert(snoozed.days>6&&snoozed.days<8,JSON.stringify(snoozed));
    assert.equal(snoozed.seen,false);
    assert.equal(snoozed.open,false);
  });
  for(const width of [320,390,768]) {
    await hintPage.setViewportSize({width,height:844});
    await hintPage.goto(origin+'/#/profile',{waitUntil:'networkidle'});
    await hintPage.waitForTimeout(700);
    const popped=await hintPage.locator('.sheet-install').count();
    await hintPage.getByRole('button',{name:/Иконка на экране «Домой»/}).click();
    await hintPage.locator('.sheet-install.on').waitFor();
    await hintPage.waitForTimeout(450);
    const box=await hintPage.evaluate(()=>{
      const sh=document.querySelector('.sheet-install'),a=sh.getBoundingClientRect();
      return {h:Math.round(a.height),vh:innerHeight,scroll:document.documentElement.scrollWidth,vw:innerWidth,
              fits:a.left>=0&&a.right<=innerWidth+1,details:sh.querySelector('.install-more').open};
    });
    check(`${width}px: while snoozed nothing pops up, and the opened hint stays a compact sheet`,()=>{
      assert.equal(popped,0);
      assert(box.h<=box.vh*0.6,`the sheet is ${box.h}px of ${box.vh}px — too much interface`);
      assert(box.scroll<=box.vw,JSON.stringify(box));
      assert.equal(box.fits,true);
      assert.equal(box.details,false);
    });
    await hintPage.screenshot({path:path.join(ART,`install-hint-${width}.png`)});
    await hintPage.keyboard.press('Escape'); await hintPage.waitForTimeout(450);
  }
  await hintPage.close();

  check('browser run has no script errors or missing local assets',()=>{
    /* без содержимого в сообщении аннотация показывает только «не равны» —
       а смотреть нужно именно что за ошибка и какой файл не отдался */
    assert.equal(errors.length,0,'ошибки страницы: '+errors.slice(0,3).join(' ;; ').slice(0,600));
    assert.equal(missing.length,0,'не отдались: '+missing.slice(0,6).join(' ;; ').slice(0,600));
  });
  if(failures.length) {
    console.log(`\n✗ упало проверок: ${failures.length} из ${checks+failures.length}`);
    process.exitCode=1;
  }
  console.log(`\nbrowser-smoke: ${checks} checks passed; screenshots in test-results/ui`);
} catch (e) {
  /* Сценарий оборвался до проверок (например, элемент не появился): в CI
     полный лог шага не читается, поэтому причина нужна аннотацией.
     Одной первой строки мало — Playwright объясняет, какой именно элемент
     не дался и что ему мешало («не стабилен», «перехватывает события»,
     «не виден»), дальше по строкам. Плюс номер строки сценария: без него
     непонятно, какой из полутора сотен кликов упал. */
  const message=String((e&&e.message)||e);
  const lines=message.split('\n').map((l)=>l.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,14).join(' | ');
  const at=/browser-smoke\.mjs:(\d+):(\d+)/.exec(String((e&&e.stack)||''));
  const where=at?`browser-smoke.mjs:${at[1]}`:'строка сценария неизвестна';
  console.log('  ✗ сценарий оборвался на '+where+' — '+lines);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=browser-smoke crashed at ${where}::${lines.slice(0,800)}`);
  process.exitCode=1;
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
