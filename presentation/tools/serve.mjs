#!/usr/bin/env node
/* Статический сервер превью: / — мини-апп, /deck — дек, /screenshots — кадры. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.woff2':'font/woff2', '.pdf':'application/pdf' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let name = url.pathname === '/' ? '/miniapp/index.html' : url.pathname;
  const file = path.resolve(ROOT, '.' + name);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const bytes = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('404'); }
}).listen(process.env.PORT || 8090, '0.0.0.0', () => console.log('preview on :', process.env.PORT || 8090));
