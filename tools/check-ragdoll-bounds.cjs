// Crowded blast regression. Exercise the real moving skin and the Rapier joints,
// including overlapping casualties in adjacent update ticks.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage();
    await page.goto('http://127.0.0.1:8590/#infantry-ragdolls');
    const f = page.frameLocator('#game'),
      body = f.locator('body');
    await f.locator('#loading.hidden').waitFor({ state: 'attached', timeout: 160000 });
    const result = await body.evaluate(async () => {
      const end = performance.now() + 90000;
      while ((!window.game?.vehicleWrecks || !game.ui || game.warming) && performance.now() < end)
        await new Promise(r => setTimeout(r, 70));
      const g = game,
        w = g.world,
        L = g.vehicleWrecks,
        { Vector3, Quaternion, Matrix4 } = await import('three');
      g.paused = false;
      while (w.time < 0.5) await new Promise(requestAnimationFrame);
      g.paused = true;
      const a = w.units.find(u => u.foot && u.side === 0),
        units = w.units.filter(u => u.foot && u.side <= 1 && !u.dead);
      // A pile at a single open cell represents troops killed together at a choke point.
      for (const [i, u] of units.entries()) {
        u.x = a.x;
        u.y = a.y;
        u.z = a.z;
        u.holder.position.set(u.x, u.y, u.z);
        u.holder.updateWorldMatrix(true, true);
        w.hurt(u, 1e7, null);
      }
      const dolls = L.live.map(r => r.doll).filter(Boolean),
        q = new Quaternion(),
        v = new Vector3(),
        t = new Vector3(),
        p = new Vector3(),
        m = new Matrix4();
      let gap = 0,
        rise = 0,
        edge = 0;
      const at = (b, s) => new Vector3().copy(s).applyQuaternion(q.copy(b.rotation())).add(b.translation());
      for (let i = 0; i < 110; i++) {
        // Adversarial impulses are a safety-bound test, not representative stock explosion tuning.
        if (i === 24) {
          dolls[0].nodes[0].body.setLinvel({ x: 0, y: 0, z: 240 }, true);
          dolls[0].nodes[2].body.setLinvel({ x: 900, y: 0, z: 180 }, true);
        }
        if (i === 6) L.blast(a.x - 3, a.y + 2, a.z + 5, 60);
        L.step(1 / 60);
        L.world.impulseJoints.forEach(j => {
          gap = Math.max(gap, at(j.body1(), j.anchor1()).distanceTo(at(j.body2(), j.anchor2())));
        });
        for (const d of dolls) {
          const n = d.nodes[0];
          rise = Math.max(rise, n.position.z - n.center.z);
          for (const o of d.root.children) {
            if (!o.material.defines?.SKINNED) continue;
            o.onBeforeRender();
            const pal = o.material.uniforms.boneMatrices.value,
              { position: pos, skinIndex: si, skinWeight: sw } = o.geometry.attributes,
              idx = o.geometry.index?.array;
            const vs = [];
            for (let j = 0; j < pos.count; j++) {
              v.fromBufferAttribute(pos, j);
              p.set(0, 0, 0);
              for (let k = 0; k < 4; k++) {
                const weight = sw.getComponent(j, k);
                if (weight) p.addScaledVector(t.copy(v).applyMatrix4(m.fromArray(pal, si.getComponent(j, k) * 16)), weight);
              }
              vs.push(p.clone().applyMatrix4(o.matrixWorld));
            }
            for (let j = 0; j < (idx?.length ?? pos.count); j += 3) {
              const a = vs[idx ? idx[j] : j],
                b = vs[idx ? idx[j + 1] : j + 1],
                c = vs[idx ? idx[j + 2] : j + 2];
              edge = Math.max(edge, a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
            }
          }
        }
      }
      return { dolls: dolls.length, detached: dolls.filter(d => d.detached).length, gap, rise, edge };
    });
    console.log(result);
    assert(
      result.dolls >= 4 && result.detached > 0 && result.gap < 0.45 && result.rise < 3 && result.edge < 17,
      'stretched joint/triangle or a launched torso'
    );
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
