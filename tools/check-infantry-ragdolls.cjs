// Requires the mounted Universal launcher, the stock game, and playwright-core.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (/Using stock unit death/.test(m.text())) console.warn(m.text());
    });
    await page.goto('http://127.0.0.1:8590/#infantry-ragdolls');
    const frame = page.frameLocator('#game');
    await frame.locator('#loading.hidden').waitFor({ state: 'attached', timeout: 160000 });
    const result = await frame.locator('body').evaluate(async () => {
      const deadline = performance.now() + 90000;
      while ((!window.game?.vehicleWrecks || !game.ui || game.warming) && performance.now() < deadline)
        await new Promise(r => setTimeout(r, 100));
      const g = window.game,
        w = g.world,
        layer = g.vehicleWrecks;
      // Exercise timed cleanup with persistence off. check-ground-offensive
      // covers the default-on frozen bodies and the actual settings switch.
      (await import('/js/gfx.js')).gfx.keepInfantryBodies = false;
      const units = w.units.filter(u => u.foot && u.side <= 1 && u.side >= 0);
      const info = {
        paused: g.paused,
        encounter: g.setup.instant?.physicsEncounter,
        dist: g.view.dist,
        roster: units.map(u => u.type.name),
        samples: []
      };
      for (const name of ['Stormtrooper', 'Rebel_Trooper']) {
        const u = units.find(o => o.type.name === name);
        w.hurt(u, 1e9, null);
        const d = layer.live.find(r => r.u === u)?.doll;
        if (!d) throw Error('No ragdoll: ' + name);
        const mesh = d.root.children.find(m => m.material.defines?.SKINNED);
        mesh.onBeforeRender();
        const palette = mesh.material.uniforms.boneMatrices.value,
          initial = palette.slice();
        const start = d.nodes[0].body.translation(),
          frozen = [u.x, u.y, u.z];
        layer.step(0);
        const held = d.nodes[0].body.translation().z === start.z;
        let maxNeckAngle = 0;
        for (let i = 0; i < 180; i++) {
          layer.step(1 / 60);
          maxNeckAngle = Math.max(maxNeckAngle, d.nodes[0].rotation.angleTo(d.nodes[1].rotation));
        }
        const { heightAt } = await import('/js/game/terrain.js'),
          h = d.nodes.map(({ body }) => {
            const p = body.translation();
            return p.z - heightAt(g.terrain, p.x, p.y);
          });
        // Check the rendered skin, not just the centres of its rigid bodies.
        const { Vector3, Matrix4 } = await import('three');
        const v = new Vector3(),
          temp = new Vector3(),
          out = new Vector3(),
          mat = new Matrix4();
        let skinClearance = Infinity;
        mesh.onBeforeRender();
        const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
        for (let j = 0; j < position.count; j++) {
          v.fromBufferAttribute(position, j);
          out.set(0, 0, 0);
          for (let k = 0; k < 4; k++) {
            const weight = skinWeight.getComponent(j, k);
            if (weight) out.addScaledVector(temp.copy(v).applyMatrix4(mat.fromArray(palette, 16 * skinIndex.getComponent(j, k))), weight);
          }
          out.applyMatrix4(mesh.matrixWorld);
          skinClearance = Math.min(skinClearance, out.z - heightAt(g.terrain, out.x, out.y));
        }
        let worstJointGap = 0;
        layer.world.impulseJoints.forEach(j => {
          const anchor = (b, p) =>
            d.root.position.clone().copy(p).applyQuaternion(d.root.quaternion.clone().copy(b.rotation())).add(b.translation());
          worstJointGap = Math.max(worstJointGap, anchor(j.body1(), j.anchor1()).distanceTo(anchor(j.body2(), j.anchor2())));
        });
        info.samples.push({
          name,
          nodes: d.nodes.length,
          joints: layer.world.impulseJoints.len(),
          held,
          hidden: !u.holder.visible,
          drawn: mesh.visible && d.root.parent === g.scene,
          unchanged: frozen.every((p, i) => p === [u.x, u.y, u.z][i]),
          skinned: palette.every(Number.isFinite) && palette.some((v, i) => Math.abs(v - initial[i]) > 0.1),
          fell: start.z - d.nodes[0].body.translation().z,
          clearance: [Math.min(...h), Math.max(...h)],
          worstJointGap,
          skinClearance,
          maxNeckAngle
        });
      }
      for (let i = 0; i < 750; i++) layer.step(1 / 60);
      info.cleaned = !layer.live.length && !layer.world.bodies.len() && !layer.world.impulseJoints.len() && !layer.world.colliders.len();
      return info;
    });
    console.log(JSON.stringify(result));
    assert(result.paused && result.encounter === 'infantry' && result.dist < 140 && result.cleaned);
    assert.equal(result.roster.filter(n => n === 'Stormtrooper').length, 3);
    assert.equal(result.roster.filter(n => n === 'Rebel_Trooper').length, 3);
    for (const s of result.samples)
      assert(s.maxNeckAngle < 0.6, `${s.name} helmet rolled ${Math.round((s.maxNeckAngle * 180) / Math.PI)} degrees relative to torso`);
    result.samples.forEach((s, i) =>
      assert(
        s.nodes === 10 &&
          s.joints === 9 * (i + 1) &&
          s.hidden &&
          s.held &&
          s.drawn &&
          s.unchanged &&
          s.skinned &&
          s.fell > 2 &&
          s.clearance[0] > -0.5 &&
          s.clearance[1] < 7 &&
          s.skinClearance > -0.2 &&
          s.skinClearance < 0.7 &&
          s.worstJointGap < 1
      )
    );
    await frame
      .locator('canvas')
      .first()
      .evaluate(c => c.ownerDocument.defaultView.focus());
    await page.keyboard.press('p');
    const fight = await frame.locator('body').evaluate(async () => {
      const g = game,
        w = g.world,
        until = performance.now() + 60000;
      while (performance.now() < until && !g.vehicleWrecks.live.length) await new Promise(r => setTimeout(r, 100));
      return { time: w.time, running: !g.paused, casualties: g.vehicleWrecks.live.map(r => r.u.type.name) };
    });
    console.log(JSON.stringify(fight));
    assert(fight.running && fight.casualties.length, 'no physics death in live combat after P');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
