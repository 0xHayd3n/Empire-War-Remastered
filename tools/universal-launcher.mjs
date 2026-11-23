import http from 'node:http';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { readLibrary } from './workshop-library.mjs';
import { libraryHome, listPacks, loadPack, primaries } from './universal-library.mjs';

const order = ['stock', ...primaries.keys()]; // stable origins: append new IDs, never reorder these
const style = `:root{color-scheme:dark;font:16px/1.5 system-ui,sans-serif;background:#10151a;color:#e3eaed}body{margin:0}main{max-width:900px;margin:auto;padding:clamp(18px,5vw,64px)}header{border-bottom:1px solid #47545f;margin-bottom:22px}h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.05;margin:.25em 0}small{letter-spacing:.12em;text-transform:uppercase;color:#a2bdcb}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px}article{background:#1c242b;border:1px solid #40515f;border-radius:8px;padding:16px;display:flex;flex-direction:column}h2{font-size:1.14em;margin:.4em 0 1em}p{max-width:75ch}form{margin-top:auto}button{font:inherit;font-weight:600;border:1px solid #7492a1;background:#243a47;color:#f6fcff;border-radius:4px;padding:.35em .8em;cursor:pointer}button:hover,button:focus-visible{background:#344d5f}code{overflow-wrap:anywhere}`;
function page(home, game, active) {
  const cards = [{ id: 'stock', name: 'Forces of Corruption', ready: true }, ...listPacks(home)];
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Universal · Campaign library</title><link rel="stylesheet" href="/library.css"><main><header><small>Empire War Remastered / Universal</small><h1>Campaign library</h1><p>Choose one ruleset. Each keeps its own campaigns, scripts and saves. Identical files use the same local storage.</p></header>${!game ? '<p>Stock install not found. Set SWR_GAME and restart.</p>' : ''}${active ? '<p>A session is open. Resume it, or save your game and end the session before switching.</p><form action="/end" method="post"><button>End session</button></form><hr>' : ''}<section>${cards.map(({ id, name, ready }) => `<article><small>${id === 'stock' ? 'Base game' : order.indexOf(id) <= 3 ? 'Empire at War Expanded' : 'Independent overhaul'}</small><h2>${name}</h2>${ready && game && (!active || active.id === id) ? `<form method="post" action="/play/${id}"><button>${active ? 'Resume' : 'Play'}</button></form>` : `<span>${!ready ? 'Not built locally' : active ? 'End current session to switch' : 'Requires stock install'}</span>`}</article>`).join('')}</section><p>To add or update packs from your Steam subscriptions, run <code>npm run universal:build</code>. No downloads or changes to your Workshop folders.</p></main></html>`;
}
export async function serveUniversal(port, openBrowser, startGame, { home = libraryHome(), library = readLibrary() } = {}) {
  if (!Number.isInteger(port) || port < 1 || port + order.length > 65535)
    throw new Error('Universal needs a library port and seven consecutive game ports.');
  const origin = `http://127.0.0.1:${port}`;
  let active = null,
    busy = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'self'; form-action 'self' http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'"
    );
    const send = (code, data, type = 'text/plain; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type });
      res.end(data);
    };
    const redirect = to => {
      res.writeHead(303, { Location: to });
      res.end();
    };
    if (req.headers.host !== `127.0.0.1:${port}`) return send(403, 'Use the printed loopback address.');
    if (req.method === 'GET' && req.url === '/') return send(200, page(home, library.game, active), 'text/html; charset=utf-8');
    if (req.method === 'GET' && req.url === '/library.css') return send(200, style, 'text/css');
    if (req.method !== 'POST' || req.headers.origin !== origin) return send(403, 'Use the local library.');
    if (busy) return send(409, 'Session change in progress.');
    busy = true;
    try {
      if (req.url === '/end') {
        if (active) await active.close();
        active = null;
        return redirect('/');
      }
      const id = /^\/play\/(stock|\d+)$/.exec(req.url)?.[1];
      if (!order.includes(id)) return send(404, 'Unknown profile');
      if (active) return active.id === id ? redirect(active.url) : send(409, 'End your current session first.');
      if (!library.game) return send(409, 'Stock installation not found.');
      if (id !== 'stock' && !listPacks(home).find(p => p.id === id)?.ready) return send(409, 'Build this profile first.');
      if (id !== 'stock' && library.ambiguous?.has(id)) return send(409, 'Multiple installed parents with this ID.');
      const pack = id === 'stock' ? null : loadPack(home, id, library.items.get(id)?.folder);
      active = { id, ...(await startGame(library.game, [], { port: port + 1 + order.indexOf(id), library: origin, pack })) };
      redirect(active.url);
    } catch (e) {
      console.error('Universal:', e.message);
      send(500, 'Could not open this profile. Check the terminal; rebuild if the parent changed.');
    } finally {
      busy = false;
    }
  });
  await new Promise((ok, no) => server.once('error', no).listen(port, '127.0.0.1', ok));
  console.log(`Universal library: ${origin}/`);
  if (openBrowser && process.platform === 'win32')
    execFile(
      path.join(process.env.SystemRoot, 'System32', 'rundll32.exe'),
      ['url.dll,FileProtocolHandler', origin + '/'],
      { windowsHide: true },
      e => {
        if (e) console.warn('Open the printed URL.');
      }
    );
  return {
    async close() {
      await active?.close();
      await new Promise(ok => {
        server.close(ok);
        server.closeAllConnections();
      });
    }
  };
}
