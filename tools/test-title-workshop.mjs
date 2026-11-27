import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPack } from './universal-library.mjs';
import { titleWorkshop } from './title-workshop.mjs';
import { checkFleet } from '../public/js/game/fleetpresets.js';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eaw-desk-'));
try {
  const ids = ['11', '22', '33', '44'],
    mounts = [],
    items = new Map(
      ids.map(id => {
        const folder = path.join(home, id);
        fs.mkdirSync(path.join(folder, 'Data'), { recursive: true });
        return [id, { id, name: 'Item ' + id, folder }];
      })
    );
  const data = {
    home,
    library: { items, cards: [], game: home, ambiguous: new Set(['44']) },
    eras: () => [
      { id: '11', ready: true },
      { id: '33', ready: true }
    ],
    startGame: async (_game, order, { port }) => {
      mounts.push([order.map(f => path.basename(f)), port]);
      return { url: `http://127.0.0.1:${port}/play.html`, close: async () => {} };
    }
  };
  const w = titleWorkshop(data);
  const catalog = w.catalog();
  assert.equal(catalog.mods.length, 4);
  assert(!JSON.stringify(catalog).includes(JSON.stringify(home).slice(1, -1)));
  assert(
    catalog.mods.every(m => !m.nativeId && !m.baseId),
    'Ready Universal packs are not stripped editions'
  );
  const reviewed = titleWorkshop({
    ...data,
    verifiedEditions: [{ base: '11', native: '22', evidence: 'Fixture author: 22 is my stripped edition of 11.' }]
  });
  const match = reviewed.catalog().mods.find(m => m.id === '11');
  assert.equal(match.nativeId, '22');
  assert.equal(reviewed.catalog().mods.find(m => m.id === '22').baseId, '11');
  await assert.rejects(() => reviewed.prepare(['11', '22']), /edition|primary overhaul/);
  await assert.rejects(() => reviewed.prepare(['33', '22']), /primary overhaul/);
  assert.throws(() => titleWorkshop({ ...data, verifiedEditions: [{ base: '11', native: '11', evidence: 'Same source' }] }));
  assert.throws(() => titleWorkshop({ ...data, verifiedEditions: [{ base: '11', native: '22', evidence: '' }] }));
  // Build both real storage modes from the same disposable source. A pack never establishes a Steam installation or an edition.
  const sourceId = '1125571106',
    parent = path.join(home, sourceId),
    packHome = path.join(home, 'packs');
  fs.mkdirSync(path.join(parent, 'Data'), { recursive: true });
  fs.writeFileSync(path.join(parent, 'Data', 'unit.txt'), 'Author unit data');
  const thin = buildPack(packHome, sourceId, parent);
  const offline = titleWorkshop({
    ...data,
    home: packHome,
    library: { ...data.library, items: new Map() },
    eras: () => [{ id: sourceId, ready: true }]
  });
  const absent = offline.catalog().mods[0];
  assert(!absent.ready && !absent.installed && !absent.nativeId && !absent.baseId);
  assert.equal(thin.revision, buildPack(packHome, sourceId, parent, { materialize: true }).revision);
  fs.rmSync(parent, { recursive: true });
  const detached = offline.catalog().mods[0];
  assert(detached.ready && !detached.installed && !detached.nativeId && !detached.baseId);
  await assert.rejects(() => offline.prepare([sourceId]), /installed/);
  for (const order of [[], ['bad'], ['11', '11'], ['44'], ['11', '33'], ['../11'], ['99']]) await assert.rejects(() => w.prepare(order));
  const a = await w.prepare(['22', '11']);
  assert.deepEqual(mounts[0][0], ['11', '22']);
  assert.equal(await w.prepare(['22', '11']), a);
  assert.equal(mounts.length, 1);
  assert.notEqual(await w.prepare(['11', '22']), a);
  await w.close();
  const w2 = titleWorkshop(data);
  assert.equal(await w2.prepare(['22', '11']), a);
  await w2.close();
  await reviewed.prepare(['22']);
  assert.deepEqual(mounts.at(-1)[0], ['22'], 'Native mounts its own distinct item, never the base');
  await reviewed.close();
  fs.rmdirSync(path.join(home, '22', 'Data'));
  assert.equal(w.catalog().mods.find(m => m.id === '22').installed, false, 'Stale item directory is not an installation');
  await assert.rejects(() => w.prepare(['22']), /installed/);
  const roster = [
      { name: 'fighter', cost: 150 },
      { name: 'hero', hero: true, cost: 800 }
    ],
    bp = { faction: 'Rebel', units: ['fighter', 'fighter'] };
  assert.deepEqual(checkFleet(bp, 'Rebel', roster, 300), { cost: 300 });
  for (const result of [
    checkFleet(bp, 'Empire', roster),
    checkFleet(bp, 'Rebel', roster, 299),
    checkFleet({ ...bp, units: ['hero', 'hero'] }, 'Rebel', roster),
    checkFleet({ ...bp, units: ['unmounted'] }, 'Rebel', roster)
  ])
    assert(result.error);
  console.log(
    'PASS: reviewed editions only, thin/offline source availability, actual edition target, stable playset ports, exact priority, invalid stacks, no private paths, fleet validation.'
  );
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
