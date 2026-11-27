// Exercise the mounted Settings and their input, renderer and mixer consumers in one solo Instant Battle.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }),
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(45000);
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true }),
      tab = name => s.getByRole('tab', { name, exact: true }).click(),
      field = name => s.getByLabel(name);
    await f.getByRole('button', { name: 'System menu' }).click();
    await f.getByRole('button', { name: 'Settings', exact: true }).click();
    await tab('Details');
    await field('Cinematic letterbox height').selectOption('0');
    await field('Time between cinematic cuts').selectOption('2');
    await field('Return to previous map position on exit').check();
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    if (process.env.SWR_CINE_SHOT) await page.screenshot({ path: process.env.SWR_CINE_SHOT });
    await page.setViewportSize({ width: 1280, height: 800 });
    await tab('Audio');
    await field('Background music during mission dialogue').selectOption('0.25');
    await field('Delay before calm tactical music resumes').selectOption('2');
    await tab('Controls');
    await field('Centre camera on control group recall').selectOption('always');
    await field('Always show paths for selected ships').check();
    await field('Allow double right-click to cross hazard fields').uncheck();
    await field('Mouse look speed while tracking or piloting').selectOption('2');
    await field('Invert vertical look while tracking or piloting').check();
    await field('Direct-control camera transition time').selectOption('0');
    if (process.env.SWR_ORDERS_SHOT) await page.screenshot({ path: process.env.SWR_ORDERS_SHOT });
    await tab('Gameplay');
    await s.getByLabel(/direct control of a unit/i).check();
    await tab('HUD');
    await field('Weapon firing arcs').selectOption('outline');
    await field('Direct-control sight size').selectOption('2');
    await field('Show direct-control mouse reminder').uncheck();
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    if (process.argv.includes('--land')) {
      await checkLand(page, f);
      assert.deepEqual(errors, []);
      console.log(
        'PASS: mounted Kuat land skirmish used tracking/chase input and overlays, player vs authored cameras and tactical music timing.'
      );
      return;
    }
    for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_INSTANT_BATTLE_BUTTON'])
      await f.locator(`.title-menu [data-id="${id}"]`).click();
    const board = f.locator('.op-setup');
    await board.getByRole('searchbox').fill('Kuat Forces of Corruption space');
    await board.locator('[data-world="Kuat"][data-domain="space"][data-source="stock"]').first().click();
    await board.getByRole('tab', { name: 'Forces' }).click();
    await board.getByRole('button', { name: 'Edit fleets' }).click();
    await board.getByRole('button', { name: 'Randomize All' }).click();
    await board.locator('.ib-editor .ib-go').click();
    const frame = page.frames().find(x => x.parentFrame() === page.mainFrame());
    await frame.waitForFunction(
      () =>
        window.game?.ui?.groups &&
        game.world.units.length &&
        !document.querySelector('.battle-plate') &&
        !game.cine.on &&
        !game.controlsLocked,
      null,
      { timeout: 150000 }
    );
    const r = await frame.evaluate(() => {
      const ui = game.ui,
        w = game.world,
        rig = game.renderer.rig,
        cine = game.cine;
      const u = [...w.selectables()].find(
        e => e.player === game.human && !e.dead && (e.isMobile || e.isSquad) && w.directArcs(e, []).length
      );
      if (!u) throw Error('No mobile unit with direct-control arcs');
      ui.select([u]);
      const key = ctrl => new KeyboardEvent('keydown', { code: 'Digit1', ctrlKey: ctrl });
      ui.keyDown(key(true));
      ui.select([]);
      rig.x = u.x + 200;
      ui.keyDown(key(false));
      const recalled = ui.selection.includes(u) && Math.abs(rig.x - u.x) < 0.01;
      const p = { clientX: Math.floor(innerWidth / 2), clientY: Math.floor(innerHeight / 2), button: 2, buttons: 2, detail: 2 };
      let issued;
      const send = game.command;
      game.command = function (cmd) {
        issued = cmd;
        return send.call(this, cmd);
      };
      try {
        ui.mouseDown(new MouseEvent('mousedown', p));
        ui.mouseUp(new MouseEvent('mouseup', p));
      } finally {
        game.command = send;
      }
      const safe = issued?.c === 'move' && issued.fast === false;
      // Inspect paths with a live selected unit and a queued leg, without waiting for travel.
      u.setOrder({ kind: 'move', x: u.x + 500, y: u.y + 50 });
      (u.queue ||= []).push({ kind: 'move', x: u.x + 800, y: u.y + 200 });
      ui.updateWaypointBeacons();
      const path = ui._wpPaths.some(pts => pts.length >= 3);
      const home = { x: rig.x, y: rig.y };
      cine.toggle();
      cine.frame(0);
      cine.frame(0.4);
      const longShot = Math.abs(cine.shot?.t - 0.2) < 0.001,
        bars = document.documentElement.style.getPropertyValue('--letterbox');
      cine.stop();
      const returned = rig.x === home.x && rig.y === home.y;
      cine.start();
      cine.frame(0);
      cine.frame(0.4);
      const native =
        Math.abs(cine.shot?.t - 0.4) < 0.001 &&
        parseFloat(document.documentElement.style.getPropertyValue('--letterbox')) === cine.bars * 100;
      cine.stop();
      ui.select([u]);
      ui.startTrack(u, false);
      rig.pitch = 0.6;
      const yaw = rig.yaw;
      ui.mouseMove(new MouseEvent('mousemove', { movementX: 10, movementY: 10 }));
      const orbit = Math.abs(rig.yaw - yaw + 0.08) < 1e-5 && Math.abs(rig.pitch - 0.52) < 1e-5;
      ui.endTrack();
      ui.toggleDirect();
      ui.toggleChase();
      const c = game.renderer.chase,
        a = c.yaw;
      ui.mouseMove(new MouseEvent('mousemove', { movementX: 10, movementY: 10 }));
      c.frame(game.renderer.camera, rig.x, rig.y, 0);
      const chase = c.k === 1 && Math.abs(c.yaw - a + 0.05) < 1e-5 && Math.abs(c.pitch - 0.13) < 1e-5;
      const sight = c.reticle.getBoundingClientRect().width,
        noTip = getComputedStyle(c.note).display === 'none';
      ui.update(0);
      const arcs = ui.arcView.edgeMesh.visible && !ui.arcView.fillMesh.visible;
      ui.releaseDirect();
      const m = game.music;
      game.setMusic('battle');
      w.lastViewerCombat = w.time - 1.5 * m.peace;
      game.updateMusic();
      const delayed = m.mode === 'battle';
      w.lastViewerCombat = w.time - 2.1 * m.peace;
      game.updateMusic();
      return {
        recalled,
        safe,
        path,
        longShot,
        bars,
        returned,
        native,
        orbit,
        chase,
        sight,
        noTip,
        arcs,
        delayed,
        calm: m.mode === 'ambient'
      };
    });
    assert.deepEqual(r, {
      recalled: true,
      safe: true,
      path: true,
      longShot: true,
      bars: '0vh',
      returned: true,
      native: true,
      orbit: true,
      chase: true,
      sight: 68,
      noTip: true,
      arcs: true,
      delayed: true,
      calm: true
    });
    const levels = await frame.evaluate(async () => {
      const a = game.audio,
        sp = a.speech;
      a.unlock();
      await sp.load();
      sp.clear(false);
      const base = () => a.musicMix.levels.get(a.music),
        heard = () => a.music.volume / base();
      if (!a.music || !(base() > 0)) throw Error('Expected live tactical music');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('No playing speech: ' + JSON.stringify(sp.report()))), 18000);
        const off = sp.on('start', r => {
          if (r.name.toUpperCase() !== 'TAR_EVENT_CONQUER_00') return;
          const duck = heard();
          off();
          const voice = a.voiceVolume;
          a.voiceVolume = 0;
          const muted = heard();
          a.voiceVolume = voice;
          sp.suspend();
          const pause = heard();
          sp.resume();
          sp.update();
          const resume = heard();
          sp.clear(false);
          clearTimeout(timer);
          resolve([duck, muted, pause, resume, heard()]);
        });
        sp.enqueue('TAR_EVENT_CONQUER_00');
        sp.update();
      });
    });
    assert.deepEqual(levels, [0.25, 1, 1, 0.25, 1]);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: mounted Kuat space battle used camera and order preferences, manual vs scripted shots, direct-control overlays, combat music timing and installed speech playback/restore.'
    );
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});

async function checkLand(page, f) {
  for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_SKIRMISH_GAMES_BUTTON'])
    await f.locator(`.title-menu [data-id="${id}"]`).click();
  const board = f.locator('.op-setup');
  await board.getByRole('searchbox').fill('Kuat Forces of Corruption land');
  await board.locator('[data-world="Kuat"][data-domain="land"][data-source="stock"]').first().click();
  await board.locator('.op-go').click();
  const frame = page.frames().find(x => x.parentFrame() === page.mainFrame());
  await frame.waitForFunction(
    () =>
      window.game?.ownSquads &&
      game.viewTilt &&
      game.world.units.length &&
      game.music &&
      !game.cine.on &&
      !document.querySelector('.battle-plate'),
    null,
    { timeout: 150000 }
  );
  const result = await frame.evaluate(async () => {
    const g = game,
      w = g.world,
      cine = g.cine,
      v = g.view,
      from = w.units.find(u => !u.dead && u.side === g.me);
    let q = g.ownSquads().find(q => q.members.some(m => w.directArcs(m, []).length));
    if (!q) q = await w.spawn('Imperial_Stormtrooper', from.x, from.y, 0, g.me);
    if (!q?.members?.length) throw Error('Expected a ground squad');
    const x = v.x,
      y = v.y;
    cine.toggle();
    cine.frame(0);
    cine.frame(0.4);
    const manual = Math.abs(cine.shot?.t - 0.2) < 0.001 && parseFloat(document.documentElement.style.getPropertyValue('--letterbox')) === 0;
    cine.stop();
    const restored = x === v.x && y === v.y;
    cine.start();
    cine.frame(0);
    cine.frame(0.4);
    const native =
      Math.abs(cine.shot?.t - 0.4) < 0.001 &&
      parseFloat(document.documentElement.style.getPropertyValue('--letterbox')) === cine.bars * 100;
    cine.stop();
    const move = () => window.dispatchEvent(new MouseEvent('mousemove', { movementX: 10, movementY: 10 }));
    g.startTrack(q, false);
    const yaw = v.yaw;
    v.pitch = 0.6;
    move();
    const orbit = Math.abs(v.yaw - yaw + 0.08) < 1e-5 && Math.abs(v.pitch - 0.52) < 1e-5;
    g.endTrack();
    g.ui.select([q]);
    g.toggleDirect();
    g.toggleChase();
    const c = g.chase,
      a = c.yaw;
    move();
    c.frame(g.camera, v.x, v.y, 0);
    const chase = Math.abs(c.yaw - a + 0.05) < 1e-5 && Math.abs(c.pitch - 0.13) < 1e-5 && c.k === 1;
    const sight = c.reticle.getBoundingClientRect().width,
      noTip = getComputedStyle(c.note).display === 'none';
    g.drawMarks();
    const arcs = g.arcView.edgeMesh.visible && !g.arcView.fillMesh.visible;
    g.releaseDirect();
    const m = g.music;
    g.setMusic('battle');
    m.fought = w.time - 1.5 * m.peace;
    g.updateMusic();
    const delayed = m.mode === 'battle';
    m.fought = w.time - 2.1 * m.peace;
    g.updateMusic();
    return { manual, restored, native, orbit, chase, sight, noTip, arcs, delayed, calm: m.mode === 'ambient' };
  });
  assert.deepEqual(result, {
    manual: true,
    restored: true,
    native: true,
    orbit: true,
    chase: true,
    sight: 68,
    noTip: true,
    arcs: true,
    delayed: true,
    calm: true
  });
}
