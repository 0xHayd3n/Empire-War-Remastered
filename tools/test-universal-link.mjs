import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { serveUniversal } from './universal-launcher.mjs';

const seen = [],
  options = { home: path.join(os.tmpdir(), 'eaw-link-test'), library: { items: new Map() }, open: url => seen.push(url) };
const startGame = () => assert.fail('Opening the link should not mount a pack twice or touch game files');
const other = http.createServer((req, res) => {
  res.writeHead(302, { Location: '/other' });
  res.end();
});
await new Promise(ok => other.listen(0, '127.0.0.1', ok));
const port = other.address().port,
  url = `http://127.0.0.1:${port}/`;
try {
  await assert.rejects(serveUniversal(port, true, startGame, options), /occupied/);
  assert.deepEqual(seen, []);
} finally {
  await new Promise(ok => other.close(ok));
}
const host = await serveUniversal(port, true, startGame, options);
try {
  assert.deepEqual(seen, [url]);
  assert.match(await (await fetch(url)).text(), /src="\/universalhost.js"/);
  await serveUniversal(port, true, startGame, options);
  assert.deepEqual(seen, [url, url]);
  assert.equal((await fetch(url, { method: 'HEAD' })).headers.get('X-EaW-Universal'), '1');
} finally {
  await host.close();
}
console.log('PASS: cold and repeat launches use the same loopback URL; unrelated listeners are left alone.');
