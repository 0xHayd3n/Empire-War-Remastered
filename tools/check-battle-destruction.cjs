// Enter through mounted Universal. Use the real damage and death paths with stock assets.
const { chromium } = require('playwright-core'),
  assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 1024, height: 700 }, reducedMotion: 'reduce' }),
      errors = [];
    p.setDefaultTimeout(160000);
    p.on('pageerror', e => errors.push(e.message));
    const land = process.argv.includes('--land');
    await p.goto('http://127.0.0.1:8590/' + (land ? '#ground-offensive' : ''));
    const f = p.frameLocator('#game');
    if (!land) {
      await f.locator('.title-menu [data-id="TITLE_PLAY"]').waitFor();
      await require('./mounted-space-roster.cjs')(f, 8);
    } else await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    const report = await f.locator('body').evaluate(async (_, land) => {
      const wait = () => new Promise(r => setTimeout(r, 100)),
        start = performance.now();
      while (
        !(land ? window.game?.vehicleWrecks && game.ui && !game.warming : window.game?.renderer?.spaceWrecks && game.world?.time > 6)
      ) {
        if (performance.now() - start > 140000) throw Error('No mounted battle');
        await wait();
      }
      const T = await import('three'),
        g = game,
        w = g.world;
      g.paused = true;
      function strikePoint(root, mesh) {
        root.updateWorldMatrix(true, true);
        const a = mesh.geometry.attributes.position,
          I = mesh.geometry.index;
        const p = new T.Vector3();
        for (let j = 0; j < 3; j++) p.add(new T.Vector3().fromBufferAttribute(a, I ? I.getX(j) : j));
        return p.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
      }
      if (land) {
        g.paused = false;
        while (w.time < 1.3) await wait();
        g.paused = true;
        const armorMesh = u => {
          let mesh;
          u.holder?.traverseVisible(m => {
            if (!mesh && m.isMesh && !m.geometry.attributes.skinIndex && !m.material.transparent && !m.geometry.groups.length) mesh = m;
          });
          return mesh;
        };
        const u = w.units.find(
          u =>
            u.kind === 'VEHICLE' &&
            !u.dead &&
            u !== g.openingWreck &&
            !u.foot &&
            !u.structure &&
            !u.flies &&
            u.seen !== false &&
            u.holder?.visible &&
            u.health > 60 &&
            u.side >= 0 &&
            armorMesh(u)
        );
        if (!u) throw Error('No rigid vehicle');
        g.armorDamage.clear();
        const at = strikePoint(u.holder, armorMesh(u)),
          s = { ax: at.x, ay: at.y, z: at.z };
        const start = u.health;
        u.shield = 100;
        w.hurt(u, 8, null, '', null, s);
        const protectedHit = !g.armorDamage.rows.size && u.health === start && u.shield < 100;
        u.shield = 0;
        w.hurt(u, 55, null, '', null, s);
        const damaged = [...g.armorDamage.rows.values()].some(r => r.u === u) && u.health < start;
        const cr = g.craters,
          heights = w.terrain.heights.slice(),
          before = cr.hits;
        w.hurt(u, 1e8, null);
        return {
          unit: u.type.name,
          protectedHit,
          damaged,
          depth: cr.offsetAt(u.x, u.y),
          unchanged: heights.every((a, i) => a === w.terrain.heights[i]),
          wreck: g.vehicleWrecks.replaced.has(u),
          newCrater: cr.hits > before
        };
      }
      const r = g.renderer,
        armor = r.armorDamage,
        { stockHull } = await import('/js/game/destroyer-detail.js');
      const u = w.units.find(u => u.obj?.visible && stockHull(u) && u.player === g.human);
      if (!u) throw Error('No flagship');
      armor.clear();
      const at = strikePoint(u.obj, stockHull(u)),
        hp = u.health,
        sh = u.shield;
      const hit = (d, o = {}) => w.damage(u, d, { damageType: 'Damage_Default', x: at.x, y: at.y, z: at.z, ...o });
      hit(3);
      const protectedHit = u.health === hp && u.shield < sh && !armor.rows.size;
      hit(45, { shields: false });
      const damaged = u.health < hp && [...armor.rows.values()].some(r => r.breaches > 0);
      const engine = u.hardpoints.find(h => h.kind === 'HARD_POINT_ENGINE');
      hit(engine.health * 10, { shields: false, hp: engine });
      const engineDisabled = !engine.alive && !u.dead;
      u.l1x = u.x - 3;
      u.l1y = u.y;
      u.l1z = u.z;
      w.kill(u, null);
      const authored = r.clones.length;
      for (let i = 0; i < 2100 && !r.spaceWrecks.pieces.length; i++) r.updateClones(1 / 30);
      const pieces = r.spaceWrecks.pieces,
        pos = pieces.map(p => p.obj.position.clone()),
        vel = pieces.map(p => p.body.linvel());
      for (let i = 0; i < 120; i++) r.spaceWrecks.step(1 / 60);
      const drift = pieces.map((p, i) => p.obj.position.distanceTo(pos[i])),
        dv = pieces.map((p, i) => new T.Vector3().copy(p.body.linvel()).distanceTo(vel[i]));
      return { unit: u.type.name, protectedHit, damaged, engineDisabled, authored, pieces: pieces.length, drift, dv };
    }, land);
    console.log(report);
    assert(report.protectedHit && report.damaged);
    if (land) {
      assert(report.unchanged && report.depth < -0.1 && report.wreck && report.newCrater);
    } else {
      assert(
        report.engineDisabled && report.authored && report.pieces >= 2 && report.drift.every(d => d > 1) && report.dv.every(d => d < 0.001)
      );
    }
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
