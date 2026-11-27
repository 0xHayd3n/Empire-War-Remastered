// Accept an optional staged public root so web + desktop builds check what will actually ship.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const staging = resolve(root, process.argv[2] || 'public');
const bytes = path => readFileSync(resolve(staging, path));
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json')));
const pin = manifest.dependencies['@dimforge/rapier3d-compat'];
assert.match(pin, /^\d+\.\d+\.\d+$/);
assert.deepEqual(
  bytes('vendor/rapier/rapier.es.js'),
  readFileSync(resolve(root, 'node_modules/@dimforge/rapier3d-compat/rapier.es.js')),
  'Re-run npm run vendor: shipped solver differs from the pinned package'
);
assert.match(bytes('vendor/rapier/LICENSE').toString(), /Apache License/);
const { usesBattleDestruction, loadWreckPhysics } = await import(pathToFileURL(resolve(staging, 'js/game/rapier-runtime.js')));
for (const mode of ['land', 'space']) {
  for (const additions of [{}, { instant: {} }, { restore: {} }, { shooter: true }]) assert(usesBattleDestruction({ mode, ...additions }));
  for (const flag of ['net', 'shooterNet', 'replay', 'campaign', 'linkedTactical', 'spectate', 'attract', 'benchmark']) {
    assert(usesBattleDestruction({ mode, [flag]: true }), `rendered ${mode} ${flag}`);
    assert(!usesBattleDestruction({ mode, headless: {}, [flag]: true }), `headless ${mode} ${flag}`);
  }
}
assert(!usesBattleDestruction({ mode: 'galactic' }));
const land = loadWreckPhysics(),
  space = loadWreckPhysics();
assert.equal(land, space, 'concurrent battles must share one init promise');
const R = await land;
assert.equal(R.version(), pin);
const worlds = [-100, 0].map(z => new R.World({ x: 0, y: 0, z }));
try {
  for (const w of worlds) w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 0, 10).setAdditionalMass(1));
  for (let i = 0; i < 10; i++) for (const w of worlds) w.step();
  const z = worlds.map(w => w.bodies.getAll()[0].translation().z);
  assert(z[0] < 10 && z[1] === 10, 'land and space are distinct worlds');
} finally {
  for (const w of worlds) w.free();
}
console.log(`Rapier ${pin}: local self-contained build, shared initialization, isolated worlds and battle mode guards OK (${staging})`);
