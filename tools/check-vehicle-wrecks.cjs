// Run against the mounted Universal launcher; the handoff must be a playable, paused battle.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (/stock vehicle deaths|wreck kept/.test(m.text())) console.warn(m.text().slice(0,300)); });
    await page.goto('http://127.0.0.1:8590/#vehicle-wrecks');
    const frame = page.frameLocator('#game');
    await frame.locator('#loading.hidden').waitFor({ state: 'attached', timeout: 160000 });
    const result = await frame.locator('body').evaluate(async () => {
      const until = performance.now() + 90000;
      while ((!window.game?.vehicleWrecks || !window.game.ui || window.game.warming || !window.game.world?.units?.some(u => u.type.name === 'AT_ST_Walker')) && performance.now() < until)
        await new Promise(r => setTimeout(r, 100));
      const g = window.game, w = g?.world, layer = g?.vehicleWrecks;
      if (!layer) throw Error('No Rapier in mounted battle: ' + document.body.innerText.slice(-600));
      const armor = w.units.filter(u => /^(AT_ST_Walker|T2B_Tank)$/i.test(u.type.name) && !u.dead);
      const info = { paused: g.paused, mode: g.setup.mode, instant: !!g.setup.instant, map: g.map.file, units: armor.map(u => u.type.name), samples: [] };
      const originals = [];
      for (const name of ['AT_ST_Walker', 'T2B_Tank']) {
        const unit = armor.find(u => u.type.name === name);
        w.hurt(unit, 1e9, null);
        const wreck = layer.live.find(r => r.u === unit);
        if (!wreck) throw Error('Missing ' + name + ' wreck: ' + [unit.kind,unit.dead,unit.holder.visible,unit.seen,unit.inst.skins?.length]);
        originals.push(...wreck.pieces.map(p=>({u:unit,root:p.root})));
        const {root} = wreck.pieces[0], start = root.position.clone(), orientation = root.quaternion.clone();
        const before = wreck.pieces.map(p => p.root.position.clone());
        for (let i=0; i<15; i++) layer.step(1/60);
        const moved = root.position.distanceTo(start), rotation = root.quaternion.angleTo(orientation);
        const offsets = wreck.pieces.map((p,i) => p.root.position.clone().sub(before[i]));
        const relativeMotion = Math.max(...offsets.map(v => v.distanceTo(offsets[0])));
        const caps = wreck.pieces.flatMap(p=>p.root.children).filter(m=>m.material===layer.cuts.interior).length;
        info.samples.push({ name, dead:unit.dead, stockHidden:!unit.holder.visible, drawn:root.visible && root.parent === g.scene, parts:wreck.pieces.length, caps, relativeMotion, moved, rotation });
      }
      for (let i=0; i<300; i++) layer.step(1/60);
      const { heightAt } = await import('/js/game/terrain.js');
      info.groundClearance = layer.live.flatMap(r => r.pieces.map(({root}) => root.position.z - heightAt(g.terrain, root.position.x, root.position.y)));
      for (let i=0; i<430; i++) layer.step(1/60);
      info.parked = !layer.live.length && !layer.world.bodies.len() && !layer.world.colliders.len();
      info.samePieces = originals.filter(({root,u})=>root.parent === g.scene && root.visible && layer.replaced.has(u) && !u.holder.visible).length;
      info.released = originals.length;
      return info;
    });
    // Use the live frame loop too: the actual pause binding should start the skirmish.
    await frame.locator('canvas').first().evaluate(c => c.ownerDocument.defaultView.focus());
    await page.keyboard.press('p');
    const running = await frame.locator('body').evaluate(async () => {
      const g = window.game, w = g.world, until = performance.now() + 35000;
      while (w.time < 0.6 && performance.now() < until) await new Promise(r => setTimeout(r, 100));
      return !g.paused && w.time >= 0.6;
    });
    console.log(JSON.stringify({ ...result, running }));
    assert(running, 'could not start the encounter with P');
    assert.deepEqual(errors, []);
    assert(result.paused && result.instant && result.mode === 'land' && result.units.length === 6 && result.parked);
    assert.equal(result.samePieces,result.released,'same wreck sections should still be present after the old timer, without showing the authored replacement');
    assert(result.groundClearance.every(h => h >= -2 && h < 80), 'parts did not land on the playable terrain');
    assert(result.samples.every(s => s.dead && s.stockHidden && s.drawn && s.parts >= 2 && s.relativeMotion > 0.1 && s.moved > 0.1 && s.rotation > 0.005));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
