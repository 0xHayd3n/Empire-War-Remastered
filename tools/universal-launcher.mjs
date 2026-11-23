import http from 'node:http';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { campaignRulesCatalog } from './universal-rule-catalog.mjs';
import { readLibrary } from './workshop-library.mjs';
import { libraryHome, listPacks, loadPack, primaries } from './universal-library.mjs';

const order = ['stock', ...primaries.keys()]; // stable save origins: append new IDs, never reorder
const hostJS = fs.readFileSync(new URL('../public/js/universalhost.js', import.meta.url));
export async function serveUniversal(port, openBrowser, startGame, { home = libraryHome(), library = readLibrary() } = {}) {
  if (!Number.isInteger(port) || port < 1 || port + order.length > 65535)
    throw new Error('Universal needs eight consecutive loopback ports.');
  const origin = `http://127.0.0.1:${port}`,
    origins = order.map((_, i) => `http://127.0.0.1:${port + i + 1}`),
    mounts = new Map();
  const eras = () => [
    { id: 'stock', name: 'Forces of Corruption', ready: true },
    ...listPacks(home).map(e => ({ ...e, ready: e.ready && !library.ambiguous?.has(e.id) }))
  ];
  let catalog;
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
          campaignRules: () => (catalog ||= campaignRulesCatalog(home, library))
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
      `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-src ${origins.join(' ')}; frame-ancestors 'none'; base-uri 'none'`
    );
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    if (req.headers.host !== `127.0.0.1:${port}`) return send(403, 'Use the printed loopback address.');
    if (req.method === 'GET' && req.url === '/universalhost.js') return send(200, hostJS, 'text/javascript');
    if (req.method === 'GET' && req.url === '/')
      return send(
        200,
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Empire War Remastered · Universal</title><style>html,body{margin:0;background:#10161d;color:#e3edf2;font:16px system-ui}iframe{display:block;position:fixed;inset:0;width:100%;height:100%;border:0}aside{position:fixed;inset:0;display:grid;place-content:center;background:#10161d}aside[hidden]{display:none}button{font:inherit}</style><iframe id="game" title="Empire War Remastered" allow="autoplay; fullscreen; gamepad; cross-origin-isolated" allowfullscreen></iframe><aside><p role="status">Opening Empire War Remastered…</p><button hidden>Try again</button></aside><script type="module" src="/universalhost.js"></script></html>`,
        'text/html; charset=utf-8'
      );
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
  await new Promise((ok, no) => server.once('error', no).listen(port, '127.0.0.1', ok));
  console.log(`Universal game: ${origin}/`);
  if (openBrowser && process.platform === 'win32')
    execFile(
      path.join(process.env.SystemRoot, 'System32', 'rundll32.exe'),
      ['url.dll,FileProtocolHandler', origin + '/'],
      { windowsHide: true },
      e => {
        if (e) console.warn('Open the printed game address.');
      }
    );
  return {
    async close() {
      await new Promise(ok => {
        server.close(ok);
        server.closeAllConnections();
      });
      for (const s of mounts.values()) await (await s).close();
    }
  };
}
