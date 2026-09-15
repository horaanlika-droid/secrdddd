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
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg' };
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
    const message=String(e&&e.message||e).split('\n')[0];
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
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&r.url().startsWith(origin))missing.push(`${r.status()} ${r.url()}`);});
  await page.route('https://telegram.org/**',route=>route.abort());
  await page.route('https://media.tenor.com/**',route=>route.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'),headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.addInitScript(()=>{if(!localStorage.getItem('dibitishka.v1'))localStorage.setItem('dibitishka.v1',JSON.stringify({onboarded:true,trial_started_at:Date.now(),mood_schema:2}));});
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
  await page.locator('.tile-photo').first().click();await page.getByRole('button',{name:'Поставить фоном доски',exact:true}).click();
  await page.reload({waitUntil:'networkidle'});await page.locator('#splash.gone').waitFor({state:'attached'});await page.waitForTimeout(500);
  await page.waitForFunction(()=>document.querySelector('.board-space-bg').style.backgroundImage.includes('blob:'));
  await page.locator('.tile-photo').first().click();await page.getByRole('button',{name:'Убрать с доски',exact:true}).click();
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
  for(const width of [320,390,768]) {
    await page.setViewportSize({width,height:900});
    for(const route of ['', 'skills','profile','boards',boardRoute.split('#/')[1]]) {
      await page.goto(origin+'/#/'+route,{waitUntil:'networkidle'});await page.locator('#splash.gone').waitFor({state:'attached'});await page.waitForTimeout(500);
      const layout=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,bar:document.querySelector('#tabbar').hidden?getComputedStyle(document.querySelector('#tabbar')).display:'visible',nav:(()=>{const back=document.querySelector('.navbar .back'),title=document.querySelector('.navbar h2');return back&&title?back.getBoundingClientRect().right<=title.getBoundingClientRect().left:true;})()}));
      check(`${width}px ${route||'home'}: no horizontal overflow or navbar collision`,()=>{assert(layout.scroll<=layout.viewport,JSON.stringify(layout));assert(layout.nav);if(['boards','board'].includes(route.split('/')[0]))assert.equal(layout.bar,'none');});
      if(route.startsWith('board/')) {
        const fits=await page.locator('.tile').evaluateAll(tiles=>tiles.every(tile=>{const a=tile.getBoundingClientRect(),b=tile.closest('.board-canvas').getBoundingClientRect();return a.left>=b.left&&a.right<=b.right&&a.top>=b.top&&a.bottom<=b.bottom;}));
        check(`${width}px rotated tiles stay inside board`,()=>assert(fits));
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
  check('browser run has no script errors or missing local assets',()=>{assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);});
  if(failures.length) {
    console.log(`\n✗ упало проверок: ${failures.length} из ${checks+failures.length}`);
    process.exitCode=1;
  }
  console.log(`\nbrowser-smoke: ${checks} checks passed; screenshots in test-results/ui`);
} catch (e) {
  // Сценарий оборвался до проверок (например, элемент не появился): в CI
  // полный лог шага не читается, поэтому причина нужна аннотацией.
  const message=String(e&&e.message||e).split('\n')[0];
  console.log('  ✗ сценарий оборвался — '+message);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=browser-smoke crashed::${message.slice(0,800)}`);
  process.exitCode=1;
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
