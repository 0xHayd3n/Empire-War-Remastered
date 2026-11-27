import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workshopSnapshot, steamCommits } from './workshop-status.mjs';
import { titleWorkshop } from './title-workshop.mjs';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eaw-receipts-'));
try {
  const a = path.join(home, 'a'),
    b = path.join(home, 'b'),
    roots = [a, b],
    id = '101',
    folder = path.join(a, 'steamapps/workshop/content/32470', id);
  fs.mkdirSync(path.join(folder, 'Data'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'Data', 'test.txt'), 'ok');
  const write = (root, rel, text) => {
    const target = path.join(root, 'steamapps', rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  const acf = (root, appid, ids) =>
    write(
      root,
      'workshop/appworkshop_32470.acf',
      `"AppWorkshop" { "appid" "${appid}" "WorkshopItemsInstalled" { ${ids.map(i => `"${i}" { "manifest" "175" "size" "88" }`).join(' ')} } }`
    );
  acf(a, '32470', []);
  acf(b, '32470', [id]);
  const m = { id, folder };
  assert.equal(workshopSnapshot(roots, id).verified, false, 'receipt on B + data on A != verified');
  assert.equal(steamCommits(roots)(m), false);
  const desk = titleWorkshop({ home, library: { game: home, roots, items: new Map([[id, m]]), cards: [] }, eras: () => [] });
  assert.equal(desk.catalog().mods[0].installed, false);
  await assert.rejects(() => desk.prepare([id]), /installed/);
  assert.throws(() => desk.status('123'), /known item/);
  assert.throws(() => workshopSnapshot(roots, '../22'));
  acf(a, '32470', [id]);
  assert.equal(desk.status(id).verified, true);
  assert.equal(desk.catalog().mods[0].steamVerified, true);
  assert.equal(desk.catalog().clientDetected, false);
  const app = (flags, done, total, scheduled = 0, appid = '32470') =>
    write(
      a,
      'appmanifest_32470.acf',
      `"AppState" { "appid" "${appid}" "StateFlags" "${flags}" "ScheduledAutoUpdate" "${scheduled}" "BytesDownloaded" "${done}" "BytesToDownload" "${total}" }`
    );
  const snapshot = () => workshopSnapshot(roots, id);
  app(4, 20, 20);
  assert.equal(snapshot().job, null, 'idle counters are not a transfer');
  app(1048576, 3, 0);
  assert.deepEqual(snapshot().job, { state: 'downloading' });
  app(1048576, 0, 8);
  assert.deepEqual(snapshot().job, { state: 'downloading', done: 0, total: 8 });
  app(2, 0, 0, Date.now() / 1000 + 500, '999');
  assert.equal(snapshot().job, null);
  app(2, 0, 0, Math.ceil(Date.now() / 1000) + 500);
  assert.deepEqual(snapshot().job, { state: 'scheduled' });
  assert(!('job' in snapshot().item));
  acf(a, '123', [id]);
  assert.equal(workshopSnapshot([a], id).acf, false);
  write(a, 'workshop/appworkshop_32470.acf', '"AppWorkshop" { "appid" "32470"');
  assert.equal(workshopSnapshot([a], id).item, null);
  console.log(
    'PASS: fixed app/ID, same-library receipt + files, partial install rejected, stale/unknown/scheduled/app-wide counters, missing client and malformed manifests.'
  );
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
