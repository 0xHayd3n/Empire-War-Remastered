import http from 'node:http';
import fs from 'node:fs';
import { campaignOrbit } from './workshop-battle-art.mjs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { titleWorkshop } from './title-workshop.mjs';
import { atlasStore } from './universal-atlas.mjs';
import { readLibrary } from './workshop-library.mjs';
import { libraryHome, listPacks, loadPack, primaries } from './universal-library.mjs';

const order = ['stock', ...primaries.keys()]; // stable save origins: append new IDs, never reorder
const hostFiles = new Map(
  [
    ['/', 'universal-host.html', 'text/html; charset=utf-8'],
    ['/universalhost.js', 'js/universalhost.js', 'text/javascript'],
    ['/socialidentity.js', 'js/socialidentity.js', 'text/javascript'],
    ['/briefing.css', 'briefing.css', 'text/css'],
    ['/art/briefings.svg', 'art/briefings.svg', 'image/svg+xml'],
    ['/fonts/aurebesh-af/AurebeshAF-Canon.otf', 'fonts/aurebesh-af/AurebeshAF-Canon.otf', 'font/otf']
  ].map(([route, file, type]) => [route, { url: new URL('../public/' + file, import.meta.url), type }])
);
function openWindowsURL(url) {
  if (process.platform === 'win32')
    execFile(
      path.join(process.env.SystemRoot, 'System32', 'rundll32.exe'),
      ['url.dll,FileProtocolHandler', url],
      { windowsHide: true },
      e => {
        if (e) console.warn('Open the printed game address.');
      }
    );
}
export async function serveUniversal(
  port,
  openBrowser,
  startGame,
  { home = libraryHome(), library = readLibrary(), open = openWindowsURL } = {}
) {
  if (!Number.isInteger(port) || port < 1 || port + order.length > 65535)
    throw new Error('Universal needs eight consecutive loopback ports.');
  const origin = `http://127.0.0.1:${port}`,
    origins = order.map((_, i) => `http://127.0.0.1:${port + i + 1}`),
    mounts = new Map();
  const eras = () => [
    { id: 'stock', name: 'Forces of Corruption', ready: true },
    ...listPacks(home).map(e => ({ ...e, ready: e.ready && !library.ambiguous?.has(e.id) }))
  ];
  const atlas = atlasStore({ home, library, eras });
  const workshop = titleWorkshop({ home, library, eras, startGame });
  // A mount is immutable within this run. Opening another era never remounts or disconnects an existing game/tab.
  async function mount(id) {
    if (!mounts.has(id)) {
      if (!library.game) throw new Error('Stock game not found. Install Forces of Corruption or set SWR_GAME and restart.');
      if (!eras().find(e => e.id === id)?.ready) throw new Error('This era is unavailable. Build its local pack first.');
      const pack = id === 'stock' ? null : loadPack(home, id, library.items.get(id)?.folder);
      mounts.set(
        id,
        startGame(library.game, [], {
          port: port + order.indexOf(id) + 1,
          library: origin,
          pack,
          eras,
          atlas,
          workshop,
          profileId: id
        })
      );
    }
    try {
      return await mounts.get(id);
    } catch (e) {
      mounts.delete(id);
      throw e;
    }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Permissions-Policy', `cross-origin-isolated=(self ${origins.map(o => '"' + o + '"').join(' ')})`);
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-src ${origins.join(' ')}; frame-ancestors 'none'; base-uri 'none'`
    );
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    if (req.headers.host !== `127.0.0.1:${port}`) return send(403, 'Use the printed loopback address.');
    if (req.method === 'GET' && hostFiles.has(req.url)) {
      const { url, type } = hostFiles.get(req.url);
      return send(200, fs.readFileSync(url), type);
    }
    if (req.method === 'GET' && req.url === '/campaign-orbit.jpg') {
      const bytes = await campaignOrbit();
      return send(bytes ? 200 : 204, bytes, 'image/jpeg');
    }
    if (req.method === 'HEAD' && req.url === '/') {
      res.setHeader('X-EaW-Universal', '1');
      return send(200, '');
    }
    if (req.method !== 'POST' || req.headers.origin !== origin) return send(403, 'Use the running game.');
    const id = /^\/api\/mount\/(stock|\d+)$/.exec(req.url)?.[1];
    if (!order.includes(id)) return send(404, 'Unknown era');
    try {
      const game = await mount(id);
      return send(200, JSON.stringify({ url: game.url }), 'application/json');
    } catch (e) {
      console.warn('Universal:', e.message);
      return send(
        409,
        library.game ? 'Could not open this era. Check the terminal and local pack.' : 'Stock game not found. Set SWR_GAME and restart.'
      );
    }
  });
  try {
    await new Promise((ok, no) => server.once('error', no).listen(port, '127.0.0.1', ok));
  } catch (e) {
    if (e.code !== 'EADDRINUSE' || !openBrowser) throw e;
    // A simultaneous/second launch may reuse our host, never another app or a redirect.
    const r = await fetch(origin, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(2500) });
    if (r.status !== 200 || r.headers.get('X-EaW-Universal') !== '1')
      throw Error(`Port ${port} is occupied by another app or an older Universal. Nothing was stopped.`);
    console.log(`Universal already running: ${origin}/`);
    open(origin + '/');
    return;
  }
  console.log(`Universal game: ${origin}/`);
  if (library.game) atlas.get(0).catch(e => console.warn('Campaign catalog:', e.message));
  if (openBrowser) open(origin + '/');
  return {
    async close() {
      await new Promise(ok => {
        server.close(ok);
        server.closeAllConnections();
      });
      for (const s of mounts.values()) await (await s).close();
      await workshop.close();
      atlas.closeArt();
    }
  };
}
