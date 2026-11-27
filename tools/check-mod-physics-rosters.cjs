// Catalog contract check, NOT a claim to render every ALO. Load each installed Universal
// profile's own XML. Deliberately give its model-bearing definitions blank art and full
// breakup slots, so success cannot depend on a known mesh, name, or idle capacity.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  try {
    const p = await b.newPage(),
      f = p.frameLocator('#game'),
      body = f.locator('body');
    p.setDefaultTimeout(120000);
    await p.goto('http://127.0.0.1:8590/');
    await f.locator('[data-id="TITLE_PLAY"]').waitFor();
    const profiles = await body.evaluate(async () =>
      (await (await fetch('/api/universal/eras')).json()).filter(p => p.ready).map(p => ({ id: p.id, name: p.name }))
    );
    const requested = process.argv.slice(2);
    for (const id of requested)
      assert(
        profiles.some(p => p.id === id),
        'No locally mounted profile: ' + id
      );
    for (const { id, name } of profiles.filter(p => !requested.length || requested.includes(p.id))) {
      if (id !== 'stock') {
        const moved = p.waitForEvent('framenavigated', {
          predicate: fr => fr.parentFrame() === p.mainFrame() && fr.url().includes('play.html')
        });
        await body.evaluate((_, id) => parent.postMessage({ kind: 'universal-select', mode: 'instant', id }, '*'), id);
        await moved;
        await f.locator(`.op-setup[data-profile="${id}"]`).waitFor();
      }
      const row = await body.evaluate(async (_, expected) => {
        const profile = document.querySelector('meta[name="swr-pack-revision"]')?.content.split(':')[0] || 'stock';
        if (profile !== expected) throw Error('Did not mount requested profile: ' + profile);
        const { db } = await import('/js/gamedata.js'),
          { loadWreckPhysics } = await import('/js/game/rapier-runtime.js'),
          { SpaceWrecks } = await import('/js/game/space-wrecks.js'),
          { Renderer } = await import('/js/game/render.js'),
          { VehicleWrecks } = await import('/js/game/vehicle-wrecks.js'),
          T = await import('three');
        const R = await loadWreckPhysics(),
          scene = new T.Scene(),
          land = new VehicleWrecks(
            R,
            scene,
            () => 0,
            () => false
          ),
          space = new SpaceWrecks(R, scene);
        const renderer = Object.assign(Object.create(Renderer.prototype), { spaceWrecks: space, clones: Array(24), explosion() {} }),
          holder = new T.Group(),
          world = { viewerSees: () => true };
        let landDefs = 0,
          spaceDefs = 0;
        try {
          for (const type of db.types.values()) {
            const u = { type, world, holder, obj: holder, x: 4, y: 3, z: 2, hitRadius: 8, visualRadius: 8 };
            if (type.str('Land_Model_Name')) {
              if (!land.presentDeath(u) || ++landDefs !== land.residue.emitted) throw Error('Missing land fallback: ' + type.name);
            }
            if (type.str('Space_Model_Name')) {
              renderer.deathClone(u, '');
              if (++spaceDefs !== space.residue.emitted) throw Error('Missing space fallback: ' + type.name);
            }
          }
          land.step(1 / 30);
          space.step(1 / 30);
          return { profile, landDefs, spaceDefs, liveBodies: land.world.bodies.len() + space.world.bodies.len() };
        } finally {
          land.dispose();
          space.dispose();
        }
      }, id);
      assert(row.landDefs > 0 && row.spaceDefs > 0 && row.liveBodies <= 48);
      console.log(name, JSON.stringify(row));
    }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
