import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame } from './tools/megfs.mjs';
import { mediaFile } from './tools/workshop-media.mjs';
import { NativeFonts } from './tools/native-fonts.mjs';
import { artRoot, campaignOrbit, photoStore, stackKey } from './tools/workshop-battle-art.mjs';
import zlib from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const portArg = process.argv.indexOf('--port');
const workshopMode = process.argv.includes('--workshop');
const PORT = Number((portArg > 0 && process.argv[portArg + 1]) || process.env.PORT || (workshopMode ? 8478 : 8377));
const STATIC = !!process.env.SWR_STATIC || process.argv.includes('--static');
if (STATIC && workshopMode) throw new Error('Workshop launch needs a local game, not --static.');
const universalMode = process.argv.includes('--universal');
if (universalMode && (STATIC || workshopMode || process.argv.includes('--mod') || process.env.SWR_MOD)) throw new Error('Universal profiles cannot be combined with static, Workshop or extra mod layers.');
const assetCache = workshopMode || universalMode ? 'no-store' : 'max-age=86400';
const PUBLIC = path.join(HERE, 'public');
let playlistRevision; // Lazy, shared by immutable mounts for this server run.
const defaultMods = process.argv
  .flatMap((a, i) => (a === '--mod' && process.argv[i + 1] ? [process.argv[i + 1]] : []))
  .concat((process.env.SWR_MOD || '').split(';').filter(Boolean));

function readModInfo(root) {
  try {
    const file = fs.readdirSync(root).find(name => name.toLowerCase() === 'modinfo.json');
    return file ? JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '')) : null;
  } catch {
    return null;
  }
}

function mountedMod(root) {
  const folder = path.basename(path.resolve(root));
  const info = readModInfo(root);
  return {
    name: info?.name || info?.steamdata?.title || folder,
    folder,
    workshop: /^\d+$/.test(folder) ? folder : undefined,
    version: info?.version ? String(info.version) : undefined
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'text/xml; charset=windows-1252',
  '.txt': 'text/plain; charset=windows-1252',
  '.lua': 'text/plain; charset=windows-1252',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.gz': 'application/gzip',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.webmanifest': 'application/manifest+json'
};
const mime = p => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

function send(res, code, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra });
  res.end(body);
}

function serveStatic(req, res, rel) {
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found: ' + rel);
    res.writeHead(200, {
      'Content-Type': mime(file),
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      ...(/\.html$/i.test(file) ? { 'Document-Policy': 'js-profiling' } : {}),
      ...(/consolelog\.js$/i.test(file) ? { SourceMap: 'consolelog.js.map' } : {})
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

async function startGame(GAME, MODS, session = {}) {
  const t0 = performance.now();
  const game = !STATIC && fs.existsSync(GAME) ? openGame(GAME, MODS, { packedLayer: session.pack?.entries }) : null;
  const indexMs = Math.round(performance.now() - t0);
  if (game) console.log(`Indexed ${game.index.size} game files in ${indexMs} ms`);
  else console.log('No game install mounted: serving static files only');
  const photos = game && workshopMode && artRoot() && fs.existsSync(artRoot()) ? photoStore(artRoot(), stackKey(game, MODS), game) : null;
  const games = { foc: game && { game, fonts: new NativeFonts(game) }, eaw: null };
function gameFor(url) {
  if (!game || url.searchParams.get('game') !== 'eaw') return games.foc;
  if (!games.eaw) {
    const g = openGame(GAME, MODS, { expansion: false, packedLayer: session.pack?.entries });
    games.eaw = { game: g, fonts: new NativeFonts(g) };
    console.log(`indexed ${g.index.size} files of the original game`);
  }
  return games.eaw;
}
const server = http.createServer(async (req, res) => {
    if (!STATIC) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    }
    const url = new URL(req.url, 'http://x');
    if (url.searchParams.has('jsprofile')) res.setHeader('Document-Policy', 'js-profiling');
    let p;
    try {
      p = decodeURIComponent(url.pathname);
    } catch {
      return send(res, 400, 'bad path');
    }

    if (session.library && (p === '/' || p === '/index.html')) {
      res.writeHead(302, { Location: '/play.html', 'Cache-Control': 'no-store' }); return res.end();
    }
    if (session.workshop && p.startsWith('/api/title-workshop/')) {
      const host = `127.0.0.1:${session.port}`, origin = `http://${host}`;
      if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') return send(res,403,'Use the local game window.');
      res.setHeader('Cache-Control','no-store');
      try {
        if (req.method === 'GET' && p === '/api/title-workshop/catalog') return send(res,200,JSON.stringify(session.workshop.catalog()),MIME['.json']);
        const status = /^\/api\/title-workshop\/status\/([1-9]\d{0,19})$/.exec(p);
        if (req.method === 'GET' && status) return send(res,200,JSON.stringify(session.workshop.status(status[1])),MIME['.json']);
        const pic = /^\/api\/title-workshop\/picture\/(\d+)$/.exec(p);
        if (req.method === 'GET' && pic) {
          const file = session.workshop.picture(pic[1]);
          if (!file) return send(res,404,'Preview unavailable.');
          return send(res,200,await fs.promises.readFile(file.file),({'.ico':'image/x-icon','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'})[path.extname(file.file).toLowerCase()] || 'application/octet-stream',{'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=300'});
        }
        if (req.method !== 'POST' || req.headers.origin !== origin) return send(res,403,'Use the Workshop tab.');
        if (p === '/api/title-workshop/titles') return send(res,200,JSON.stringify(await session.workshop.titles()),MIME['.json']);
        if (p === '/api/title-workshop/refresh') return send(res,200,JSON.stringify(session.workshop.catalog(true)),MIME['.json']);
        if (p === '/api/title-workshop/prepare') {
          let size=0; const bytes=[];
          for await (const b of req) { if ((size+=b.length)>2048) return send(res,413,'Playset too large.'); bytes.push(b); }
          const url=await session.workshop.prepare(JSON.parse(Buffer.concat(bytes).toString()).ids);
          return send(res,200,JSON.stringify({url}),MIME['.json']);
        }
      } catch(e) { return send(res,409,e.code ? 'Playset or preview unavailable. Check the local server and try again.' : e.message); }
      return send(res,404,'Unknown Workshop operation.');
    }
    if (session.eras && p === '/api/universal/eras') return send(res, 200, JSON.stringify(session.eras()), MIME['.json'], { 'Cache-Control':'no-store' });
    if (session.atlas && p.startsWith('/api/universal/portraits/')) {
      const id = /^\/api\/universal\/portraits\/([a-f0-9]{64})\.png$/.exec(p)?.[1];
      try { const bytes = req.method === 'GET' && id && session.atlas.portrait(id);
        return bytes ? send(res, 200, bytes, 'image/png', {'Cache-Control':'private, max-age=31536000, immutable'}) : send(res,404,'Unknown preview sheet.');
      } catch { return send(res,404,'Preview sheet unavailable.'); }
    }
    if (session.atlas && p.startsWith('/api/universal/art/')) {
      const match = /^\/api\/universal\/art\/(stock|\d+)\/(stock|[a-f0-9]{64})\/asset\/(.+)$/i.exec(p);
      if (req.method!=='GET'||!match) return send(res,404,'Unknown preview asset.');
      try { const bytes=session.atlas.picture(match[1],match[2],match[3]);return send(res,bytes?200:204,bytes||'', 'application/octet-stream',{'Cache-Control':'no-store'}); }
      catch {return send(res,409,'Preview art unavailable.');}
    }
    if (session.atlas && p.startsWith('/api/universal/atlas')) {
      const hdr = { 'Cache-Control': 'no-store' };
      try {
        if (p === '/api/universal/atlas' && req.method === 'GET') {
          const { bytes } = await session.atlas.get(url.searchParams.get('language') || 0);
          return send(res, 200, bytes, MIME['.json'], { ...hdr, 'Content-Encoding': 'gzip' });
        }
        if (req.method !== 'POST' || req.headers.origin !== `http://127.0.0.1:${session.port}`) return send(res, 403, 'Use the game window.');
        const parts = [];
        let size = 0;
        for await (const b of req) {
          if ((size += b.length) > 4096) return send(res, 413, 'Selection too large.');
          parts.push(b);
        }
        const q = JSON.parse(Buffer.concat(parts).toString());
        if (p === '/api/universal/atlas/start') return send(res, 200, JSON.stringify(await session.atlas.issue(q)), MIME['.json'], hdr);
        if (p === '/api/universal/atlas/consume') {
          const setup = session.atlas.take(session.profileId, session.pack?.revision || 'stock', q.ticket);
          return send(res, 200, JSON.stringify(setup), MIME['.json'], hdr);
        }
        return send(res, 404, 'Unknown catalog request.');
      } catch (e) {
        return send(res, 409, e.message, 'text/plain', hdr);
      }
    }
    if (session.library && p === '/play.html') {
      // A frame navigation on loopback is cross-origin. Only this document is embeddable, by the trusted ancestors below; assets stay same-origin.
      res.setHeader('Cross-Origin-Resource-Policy','cross-origin');
      res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${session.library}`);
      const html = fs.readFileSync(path.join(PUBLIC, 'play.html'), 'utf8')
        .replace('</head>', `<meta name="swr-universal" content="${session.library}"><script defer src="js/universallaunch.js"></script><link rel="stylesheet" href="universal-modes.css">${session.pack ? `<meta name="swr-pack-revision" content="${session.pack.mounted.workshop}:${session.pack.revision}">` : ''}</head>`);
      return send(res, 200, html, MIME['.html'], { 'Cache-Control':'no-store', 'Document-Policy':'js-profiling' });
    }
    if (req.method === 'GET' && p.startsWith('/api/title-art/')) {
      const key = /^\/api\/title-art\/(rendezvous|solo-command|fleet-command|conquest|resume|story|skirmish|instant|tutorial|archive|internet|lan|network)\.jpg$/.exec(p)?.[1];
      const root = process.env.SWR_TITLE_ART || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'EaWBrowserWorkshop', 'title-art'));
      const file = game && root && key && mediaFile(root, key + '.jpg', 1024 * 1024);
      const bytes = file && await fs.promises.readFile(file.file).catch(() => null);
      return send(res, bytes ? 200 : 204, bytes || '', 'image/jpeg', { 'Cache-Control': 'private, max-age=300' });
    }
    if (game && req.method === 'GET' && p === '/api/title-orbit.jpg') {
      const bytes = await campaignOrbit();
      return send(res, bytes ? 200 : 204, bytes || '', 'image/jpeg', { 'Cache-Control': 'private, no-cache' });
    }
    if (p === '/api/battle-photo') {
      res.setHeader('Cache-Control', 'no-store');
      const q = url.searchParams;
      const photo = req.method === 'GET' && !q.has('game') && await photos?.(q.get('map'), q.get('kind'), q.get('planet') || '');
      return photo ? send(res, 200, photo.bytes, 'image/jpeg', { 'X-Map-SHA256': photo.mapSHA }) : send(res, 204, '');
    }
    if (p.startsWith('/asset/')) {
      const which = gameFor(url),
        nativeFonts = which && which.fonts;
      const assets = which && (url.searchParams.has('language') ? which.game.forLanguage(url.searchParams.get('language')) : which.game);
      let key = assets && assets.resolve(p.slice(7));
      if (!key && nativeFonts && /^Data\/Fonts\/Raster\//i.test(p.slice(7))) {
        try {
          const bytes = await nativeFonts.asset(p.slice(7));
          if (bytes)
            return send(res, 200, zlib.gzipSync(bytes), MIME['.json'], { 'Content-Encoding': 'gzip', 'Cache-Control': assetCache });
        } catch (error) {
          console.warn('font raster:', error.message);
        }
      }
      if (!key) return send(res, 204, '');
      const entry = assets.index.get(key);
      if (entry.ensure) {
        try { entry.ensure(); } catch (error) { console.warn('Universal asset:', error.message); return send(res, 409, 'Pack unavailable. Restore the parent or rebuild the profile.', undefined, { 'Cache-Control':'no-store' }); }
      }
      const size = entry.size,
        range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        const a = range[1] ? +range[1] : Math.max(0, size - +range[2]),
          b = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
        if (a > b || a >= size) return send(res, 416, '', 'text/plain', { 'Content-Range': `bytes */${size}` });
        return send(res, 206, assets.readPart(key, a, b - a + 1), mime(key), {
          'Content-Range': `bytes ${a}-${b}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': assetCache
        });
      }
      return send(res, 200, assets.read(key), mime(key), { 'Accept-Ranges': 'bytes', 'Cache-Control': assetCache });
    }
    if (p === '/api/find') {
      if (!game) return send(res, 404, 'no game mounted');
      let rx;
      try {
        rx = new RegExp(url.searchParams.get('q') || '.', 'i');
      } catch {
        return send(res, 400, 'bad regex');
      }
      const out = [];
      for (const k of gameFor(url).game.index.keys()) if (rx.test(k)) out.push(k);
      return send(res, 200, JSON.stringify(out.sort()), MIME['.json']);
    }
    if (p === '/api/playlist-manifest' && req.method === 'GET') {
      try {
        playlistRevision ||= import('./tools/playlist-build.mjs').then(m => m.playlistBuild(path.join(PUBLIC, 'js')));
        const mods = session.pack ? [session.pack.mounted] : MODS.map(mountedMod);
        return send(res, 200, JSON.stringify({ build: await playlistRevision, mods }), MIME['.json'], { 'Cache-Control': 'no-store' });
      } catch {
        playlistRevision = null;
        return send(res, 503, 'Game build unavailable.');
      }
    }
    if (p === '/api/mounted') {
      return send(res, 200, JSON.stringify(session.pack ? [session.pack.mounted] : MODS.map(mountedMod)), MIME['.json']);
    }
    if (p === '/api/modinfo') {
      const e = game && gameFor(url).game.index.get((url.searchParams.get('key') || '').replace(/\//g, '\\').toUpperCase());
      if (session.pack) return send(res, 200, JSON.stringify(e?.packLoose ? session.pack.info : null), MIME['.json']);
      const at = e && e.file && path.resolve(e.file).toLowerCase(),
        root =
          at &&
          MODS.map(r => path.resolve(r))
            .filter(r => at.startsWith(r.toLowerCase() + path.sep))
            .pop();
      return send(res, 200, JSON.stringify(root ? readModInfo(root) : null), MIME['.json']);
    }
    serveStatic(req, res, p === '/' ? 'index.html' : p.slice(1));
  });
  function release() {
    for (const layer of Object.values(games)) {
      layer?.fonts.close();
      layer?.game.close();
    }
  }
  try {
    await new Promise((ok, fail) => server.once('error', fail).listen(session.port ?? PORT, '127.0.0.1', ok));
  } catch (e) { release(); throw e; }
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`Game server: ${url}/`);
  return { url: url + '/play.html', indexMs, async close() {
    const stopped = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await stopped;
    release();
  } };
}

if (universalMode) {
  const { serveUniversal } = await import('./tools/universal-launcher.mjs');
  await serveUniversal(Number(portArg > 0 ? process.argv[portArg + 1] : process.env.SWR_UNIVERSAL_PORT || 8590), process.argv.includes('--open'), startGame);
} else if (workshopMode) {
  const { serveWorkshop } = await import('./tools/workshop-launcher.mjs');
  serveWorkshop(Number(process.env.SWR_LAUNCHER_PORT ?? 8490), process.argv.includes('--open'), startGame);
} else await startGame(process.env.SWR_GAME || path.resolve(HERE, '..', 'Star Wars Empire at War'), defaultMods);
