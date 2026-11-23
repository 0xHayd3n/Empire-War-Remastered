import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { readLibrary } from './workshop-library.mjs';
import { workshopPage } from './workshop-view.mjs';
import { bindMedia, mediaFile } from './workshop-media.mjs';
import { steamTitles } from './workshop-titles.mjs';

const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const css = fs.readFileSync(new URL('./workshop-view.css', import.meta.url));

// Browse without mounting game data. Only an explicit same-origin POST may start or end a session.
export function serveWorkshop(port, openBrowser, startGame) {
  const discover = () => bindMedia(readLibrary());
  let lib = discover();
  let active = null, busy = false;
  const server = http.createServer(async (req, res) => {
    const host = `127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'self'; font-src 'self'; media-src 'self'; script-src 'self'; form-action 'self' http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'");
    const send = (status, type, body) => { res.writeHead(status, { 'Content-Type': type }); res.end(body); };
    const text = (status, msg) => send(status, 'text/plain', msg);
    if (req.headers.host !== host) return text(403, 'Use the printed loopback address.');
    let url;
    try { url = new URL(req.url, `http://${host}`); } catch { return text(400, 'Invalid URL'); }
    if (req.method === 'GET') {
      if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', workshopPage(lib, url, active));
      if (url.pathname === '/launcher.css') return send(200, 'text/css', css);
      if (url.pathname === '/typography.css') return send(200, 'text/css', fs.readFileSync(new URL('../public/typography.css', import.meta.url)));
      if (url.pathname === '/fonts/oswald/Oswald.ttf') return send(200, 'font/ttf', fs.readFileSync(new URL('../public/fonts/oswald/Oswald.ttf', import.meta.url)));
      if (url.pathname === '/selector.js') return send(200, 'text/javascript', fs.readFileSync(new URL('./workshop-selector.js', import.meta.url)));
      const match = /^\/(icon|scene|theme|wordmark)\/(\d+)$/.exec(url.pathname);
      const m = match && lib.items.get(match[2]);
      const descriptor = m && (match[1] === 'theme' ? m.theme : match[1] === 'scene' ? m.backdrop : match[1] === 'wordmark' ? m.wordmark : m.art && [m.folder, path.basename(m.art), 8*1024*1024]);
      const asset = descriptor && mediaFile(...descriptor);
      if (asset) {
        const { file, size } = asset;
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start > end || start >= size) { res.setHeader('Content-Range', `bytes */${size}`); return text(416, 'Range unavailable'); }
        res.writeHead(range ? 206 : 200, { 'Content-Type': match[1] === 'theme' ? 'audio/mpeg' : mime[path.extname(file).toLowerCase()], 'Accept-Ranges':'bytes', 'Content-Length':end-start+1, 'Cache-Control':'private, max-age=300', ...(range ? { 'Content-Range':`bytes ${start}-${end}/${size}` } : {}) });
        const stream = fs.createReadStream(file,{ start,end });
        res.once('close', () => stream.destroy());
        stream.on('error', () => res.destroy());
        return stream.pipe(res);
      }
      return text(404, 'Not found');
    }
    if (req.method !== 'POST' || req.headers.origin !== `http://${host}`) return text(403, 'Use the local launcher.');
    if (busy) return text(409, 'Session change in progress. Return to the library.');
    busy = true;
    const redirect = to => { res.writeHead(303, { Location: to }); res.end(); };
    try {
      if (url.pathname === '/refresh') {
        if (active) return text(409, 'End the running session before refreshing its library.');
        lib = discover();
        return redirect('/');
      }
      if (url.pathname === '/titles') {
        try { await steamTitles(lib.items); } catch { return redirect('/?names=unavailable'); }
        return redirect('/');
      }
      if (url.pathname === '/end') {
        if (active) await active.close();
        active = null;
        return redirect('/');
      }
      const match = /^\/play\/(\d+)$/.exec(url.pathname);
      if (!match) return text(404, 'Not found');
      const n = Number(match[1]), c = lib.cards[n];
      if (!c || c.problem || c.order.some(id => !fs.existsSync(lib.items.get(id).folder))) return text(409, 'This collection is not ready. Restart to refresh discovery.');
      if (active?.n === n) return redirect(active.url);
      if (active) return text(409, 'End the running session from the library before switching collections.');
      active = { n, ...await startGame(lib.game, c.order.map(id => lib.items.get(id).folder).reverse()) };
      console.log(`Selected ${c.name}: ${active.url}`);
      redirect(active.url);
    } catch (e) {
      console.error(e.message);
      text(500, 'Could not change session. Check the terminal and return to the library.');
    } finally { busy = false; }
  });
  server.once('error', e => { console.error(`Workshop launcher: ${e.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log(`Workshop launcher: ${url}`);
    if (openBrowser && process.platform === 'win32') execFile(path.join(process.env.SystemRoot, 'System32', 'rundll32.exe'),
      ['url.dll,FileProtocolHandler', url], { windowsHide: true }, err => { if (err) console.warn('Open the printed launcher address.'); });
  });
}
