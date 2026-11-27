// Mounted acceptance test: game-authoritative ramming
// for land vehicles and ships, exercised through the real mounted Universal
// world update.
//
//   npm run test:ramming                # land + space
//   npm run test:ramming -- --space     # space only
//
// Requires the mounted window at http://127.0.0.1:8590/ (EW_BASE overrides).
// Nothing here edits the app: every check runs inside the mounted game frame.
//
// What "forced" means below: the test places two hostile units on a clear line,
// gives them the same movement intent the game uses (land: path + heading + mv,
// space: u.direct throttle), and then calls the real World.update tick by tick.
// Damage is never applied by the test; it only wraps hurt/damage to observe.
// Natural AI-initiated rams are reported separately (untagged impacts) and are
// not an assertion.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const BASE = process.env.EW_BASE || 'http://127.0.0.1:8590/';
async function launch(){
  const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));return {browser,page,errors};
}
const waitGame=frame=>frame.waitForFunction(()=>window.game?.world?.units?.length>0,null,{timeout:180000});
const setFrameQuery=(page,key)=>page.locator('#game').evaluate((f,k)=>{const u=new URL(f.src);u.searchParams.set(k,'');f.src=u.href;},key);

const results = {};
const PAGE = { timeout: 190000 };

function log(name, value) {
  results[name] = value;
  console.log(`\n[${name}]`, JSON.stringify(value, null, 2));
}

async function frameAt(page, urlPart) {
  const until = Date.now() + 190000;
  for (;;) {
    const f = page.frames().find(f => f !== page.mainFrame() && f.url().includes(urlPart));
    if (f) {
      try {
        if (await f.evaluate(() => !!document.querySelector('canvas'))) return f;
      } catch {}
    }
    if (Date.now() > until) throw Error(`mounted frame matching ${urlPart} did not start`);
    await new Promise(r => setTimeout(r, 250));
  }
}

// Rule scope guard: live solo tactical sessions only, never unmarked replays or
// network peers (lockstep/replay integrity).
async function scopeGuard(frame) {
  return frame.evaluate(async () => {
    const { wantsRamming } = await import('/js/game/ram-impacts.js');
    return {
      liveSoloSpace: wantsRamming({ mode: 'space' }),
      liveSoloLand: wantsRamming({ mode: 'land' }),
      net: wantsRamming({ mode: 'space', net: {} }),
      shooterNet: wantsRamming({ mode: 'land', shooterNet: {} }),
      legacyReplay: wantsRamming({ mode: 'space', replay: { version: 1 } }),
      markedReplay: wantsRamming({ mode: 'space', replay: { version: 2 }, ramRule: 1 }),
      headless: wantsRamming({ mode: 'space', headless: true }),
      attract: wantsRamming({ mode: 'space', attract: true }),
    };
  });
}

function assertScope(scope) {
  assert.equal(scope.liveSoloSpace, true, 'live solo space sessions must enable ramming');
  assert.equal(scope.liveSoloLand, true, 'live solo land sessions must enable ramming');
  assert.equal(scope.net, false, 'network peers must not enable ramming before a rules handshake');
  assert.equal(scope.shooterNet, false, 'network shooter peers must not enable ramming');
  assert.equal(scope.legacyReplay, false, 'replays without the ram marker must not gain new damage');
  assert.equal(scope.markedReplay, true, 'replays recorded with the ram marker keep it');
  assert.equal(scope.headless, false, 'headless runs must not enable ramming');
  assert.equal(scope.attract, false, 'attract mode must not enable ramming');
}

// ---------------------------------------------------------------------------
// Land: stock ground-offensive opening encounter (mounted, paused on open).
// ---------------------------------------------------------------------------
async function land() {
  const { browser, page, errors } = await launch();
  try {
    await page.goto(BASE + '#ground-offensive');
    const frame = await frameAt(page, 'play.html');
    await frame.locator('#loading.hidden').waitFor({ state: 'attached', timeout: PAGE.timeout });
    await waitGame(frame);

    const boot = await frame.evaluate(async () => {
      const until = performance.now() + 90000;
      while ((!window.game?.world?.ramImpacts || game.warming) && performance.now() < until)
        await new Promise(r => setTimeout(r, 100));
      const g = game, w = g.world;
      return {
        mode: g.setup?.mode,
        type: g.setup?.type,
        paused: !!g.paused,
        net: !!g.setup?.net,
        replay: !!g.setup?.replay,
        units: w.units.length,
        vehicles: w.units.filter(u => u.kind === 'VEHICLE' && !u.foot && !u.structure).length,
        ram: !!w.ramImpacts,
        ramBegin: typeof w.ramImpacts?.begin,
        ramEnd: typeof w.ramImpacts?.end,
        ramImpacts: w.ramImpacts?.impacts,
      };
    });
    log('land.boot', boot);
    assert.equal(boot.mode, 'land');
    assert.equal(boot.net, false, 'land fixture must be a live solo session');
    assert.equal(boot.replay, false, 'land fixture must be a live session, not a replay');
    assert.ok(
      boot.ram && boot.ramBegin === 'function' && boot.ramEnd === 'function',
      'BLOCKER: mounted land world has no ramImpacts.begin/end; game-authoritative ramming is not live in this checkout'
    );
    assert.ok(boot.vehicles >= 4, `need at least 4 eligible land vehicles, saw ${boot.vehicles}`);

    const scope = await scopeGuard(frame);
    log('land.scope', scope);
    assertScope(scope);

    // Setup forced approach + stationary overlap control. Observations wrap the
    // real methods and always call through.
    const setup = await frame.evaluate(async () => {
      const g = game, w = g.world;
      g.paused = true;
      const { CELL } = await import('/js/game/terrain.js');
      const span = w.terrain.size * CELL;
      const mob = w.units.filter(
        u =>
          u.kind === 'VEHICLE' &&
          !u.foot &&
          !u.structure &&
          !u.flies &&
          !u.flight &&
          !u.rope &&
          !u.inside &&
          !u.cinematicTransport &&
          !u.untargetable &&
          !u.dead &&
          u.speed > 0 &&
          u.maxHealth > 0 &&
          (u.side === 0 || u.side === 1)
      );
      // Quiet every other vehicle so only the placed pairs can meet during ticks.
      for (const u of mob) {
        u.target = null;
        u.path = [];
        u.mv = 0;
        if (u.squad) {
          u.squad.foe = null;
          u.squad.post = null;
          u.squad.march = null;
          u.squad.leash = null;
          u.squad.legs = null;
        }
      }
      const spots = [];
      for (let gy = 0.15; gy <= 0.85; gy += 0.05)
        for (let gx = 0.15; gx <= 0.85; gx += 0.05) {
          if (spots.length >= 2) break;
          const x = gx * span, y = gy * span;
          if (!w.isOpen(x, y, 6)) continue;
          if (spots.some(s => Math.hypot(s.x - x, s.y - y) < 260)) continue;
          if (w.units.some(u => !u.dead && Math.hypot(u.x - x, u.y - y) < 160)) continue;
          spots.push({ x, y });
        }
      const first = mob.find(u => u.side === 1), second = mob.find(u => u.side === 0);
      const pairs = [
        [first, second],
        // Allied overlap control: no weapon fire can be confused with ram damage.
        [mob.find(u => u.side === 1 && u !== first), mob.find(u => u.side === 1 && u !== first && u !== mob.find(v => v.side === 1 && v !== first))],
      ];
      if (spots.length < 2 || pairs.some(p => p.some(u => !u))) return { error: 'not enough open ground / vehicles', mob: mob.length, spots: spots.length };

      const [a, b] = pairs[0], [c, d] = pairs[1];
      a.__ramKey = 'A';
      b.__ramKey = 'B';
      c.__ramKey = 'C';
      d.__ramKey = 'D';
      const place = (u, x, y, heading, pathTo) => {
        u.x = x;
        u.y = y;
        u.heading = heading;
        u.mv = 0;
        u.path = [{ x: pathTo, y, free: true }];
        u.target = null;
        u.lastX = u.x;
        u.lastY = u.y;
        if (u.squad) {
          u.squad.foe = null;
          u.squad.post = null;
          u.squad.march = null;
          u.squad.leash = null;
          u.squad.legs = null;
        }
      };
      const [s1, s2] = spots;
      const gap = a.hitRadius + b.hitRadius + 12;
      place(a, s1.x - gap / 2, s1.y, 0, s1.x + 500);
      place(b, s1.x + gap / 2, s1.y, Math.PI, s1.x - 500);
      a.mv = a.speed;
      b.mv = b.speed;
      // Stationary overlap control: two fresh allied vehicles on the same point.
      place(c, s2.x, s2.y, 0, s2.x + 500);
      place(d, s2.x, s2.y, 0, s2.x + 500);
      c.path = [];
      d.path = [];
      c.mv = 0;
      d.mv = 0;
      c.range = 0;
      d.range = 0;

      w.__ram = { impacts: [], damage: [], start: w.ramImpacts.impacts };
      const end = w.ramImpacts.end.bind(w.ramImpacts);
      w.ramImpacts.end = (units, cb) =>
        end(units, (x, y, amount, at) => {
          w.__ram.impacts.push({ a: x.__ramKey || `u${x.side}`, b: y.__ramKey || `u${y.side}`, amount, at });
          return cb(x, y, amount, at);
        });
      const hurt = w.hurt.bind(w);
      w.hurt = (u, amount, from, how, shot, contact) => {
        w.__ram.damage.push({
          key: u.__ramKey || `u${u.side}`,
          amount,
          from: from && (from.__ramKey || `u${from.side}`),
          shot: !!shot,
          contact: !!contact,
          t: +w.time.toFixed(3),
        });
        return hurt(u, amount, from, how, shot, contact);
      };

      return {
        mob: mob.length,
        spots,
        counterBefore: w.__ram.start,
        forced: {
          A: { key: 'A', type: a.type.name, hp: a.health, max: a.maxHealth, speed: a.speed, r: a.hitRadius },
          B: { key: 'B', type: b.type.name, hp: b.health, max: b.maxHealth, speed: b.speed, r: b.hitRadius },
          gap,
        },
        control: {
          C: { key: 'C', type: c.type.name, hp: c.health, max: c.maxHealth },
          D: { key: 'D', type: d.type.name, hp: d.health, max: d.maxHealth },
        },
      };
    });
    log('land.setup', setup);
    assert.ok(!setup.error, `land fixture could not be prepared: ${setup.error}`);

    const forced = await frame.evaluate(async () => {
      const w = game.world;
      const a = w.units.find(u => u.__ramKey === 'A'), b = w.units.find(u => u.__ramKey === 'B');
      const before = { a: { hp: a.health, shield: a.shield || 0 }, b: { hp: b.health, shield: b.shield || 0 } };
      const trace = [];
      for (let i = 0; i < 240 && !w.__ram.impacts.length; i++) {
        // Re-issue the same move intent; this is the order mover's own input,
        // not a teleport between poses.
        for (const [u, h, far] of [[a, 0, 500], [b, Math.PI, -500]]) {
          if (u.dead) continue;
          u.target = null;
          u.heading = h;
          if (!u.path || !u.path.length) u.path = [{ x: u.x + far, y: u.y, free: true }];
        }
        w.update(1 / 30);
        if (i % 10 === 0 || w.__ram.impacts.length) trace.push({ i, t: +w.time.toFixed(2), d: +Math.hypot(a.x - b.x, a.y - b.y).toFixed(1), mva: +a.mv.toFixed(1), mvb: +b.mv.toFixed(1) });
      }
      return {
        trace,
        impacts: w.__ram.impacts,
        damage: w.__ram.damage,
        before,
        after: { a: { hp: a.health, shield: a.shield || 0, dead: a.dead }, b: { hp: b.health, shield: b.shield || 0, dead: b.dead } },
        counter: w.ramImpacts.impacts,
      };
    });
    log('land.forced', forced);
    const ramHits = forced.damage.filter(
      d => !d.shot && d.contact && ((d.key === 'A' && d.from === 'B') || (d.key === 'B' && d.from === 'A'))
    );
    assert.ok(forced.impacts.length >= 1, 'a high-speed land contact must register a ram impact');
    assert.equal(forced.counter, setup.counterBefore + forced.impacts.length, 'ram impact counter must match observed impacts');
    assert.equal(ramHits.length, 2, `both land vehicles must take contact damage through hurt(), saw ${JSON.stringify(forced.damage)}`);
    const dropA = forced.before.a.hp + forced.before.a.shield - (forced.after.a.hp + forced.after.a.shield);
    const dropB = forced.before.b.hp + forced.before.b.shield - (forced.after.b.hp + forced.after.b.shield);
    assert.ok(dropA > 0 && dropB > 0, `both hulls must lose health, got A ${dropA} B ${dropB}`);
    assert.ok(Math.abs(dropA - dropB) <= Math.max(1, 0.02 * Math.max(dropA, dropB)), 'a symmetric ram should hit both hulls equally');
    assert.ok(ramHits.every(d => d.amount > 0), 'ram damage must be positive');

    // Control: stationary / spawn-overlap must not charge ram damage.
    const control = await frame.evaluate(async () => {
      const w = game.world;
      const c = w.units.find(u => u.__ramKey === 'C'), d = w.units.find(u => u.__ramKey === 'D');
      const impacts0 = w.ramImpacts.impacts;
      const damage0 = w.__ram.damage.length;
      const before = { c: c.health + (c.shield || 0), d: d.health + (d.shield || 0) };
      for (let i = 0; i < 40; i++) {
        // Keep them touching and stationary, the way a fresh spawn can overlap.
        for (const u of [c, d]) {
          u.path = [];
          u.mv = 0;
          u.target = null;
        }
        w.update(1 / 30);
      }
      return {
        distance: +Math.hypot(c.x - d.x, c.y - d.y).toFixed(2),
        newImpacts: w.ramImpacts.impacts - impacts0,
        newDamage: w.__ram.damage.slice(damage0),
        delta: { c: before.c - (c.health + (c.shield || 0)), d: before.d - (d.health + (d.shield || 0)) },
      };
    });
    log('land.stationaryOverlap', control);
    assert.ok(control.distance <= 10, `control pair must stay touching (collision nudge was ${control.distance})`);
    assert.equal(control.newImpacts, 0, 'stationary overlap must not produce ram damage');
    assert.deepEqual(
      control.newDamage.filter(x => !x.shot && x.contact),
      [],
      'stationary overlap must not call hurt() as a ram'
    );
    assert.ok(control.delta.c <= 0.001 && control.delta.d <= 0.001, 'stationary overlap must not damage either vehicle');

    assert.deepEqual(errors, [], 'no page errors during the land leg');
    log('land.verdict', {
      pass: true,
      forcedApproach: 'placed hostile vehicles on open ground, real World.update ticks, real hurt() path',
      naturalAiObserved: forced.impacts.some(i => !'ABCD'.includes(i.a) || !'ABCD'.includes(i.b)),
      note: 'Forced motion is used only for reproducibility; whether AI initiates rams on its own is not asserted.',
    });
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Space: mounted Universal instant battle with the page authoring the World
// (no space worker) so the authoritative world.ramImpacts is observable.
// ---------------------------------------------------------------------------
async function space() {
  const { browser, page, errors } = await launch();
  try {
    await page.goto(BASE);
    let frame = await frameAt(page,'play.html');
    await frame.locator('.title-menu [data-id="TITLE_PLAY"]').waitFor({ timeout: PAGE.timeout });
    // Launch through the mounted window, but ask the page for the main-thread world.
    await setFrameQuery(page, 'nospaceworker');
    frame = await frameAt(page, 'nospaceworker');
    await frame.locator('.title-menu [data-id="TITLE_PLAY"]').waitFor({ timeout: PAGE.timeout });

    const fleet = await frame.evaluate(async () => {
      const { instantRoster, shipsOf, INSTANT_BUDGET_MAX: budget } = await import('/js/game/instantbattle.js');
      const players = ['Empire', 'Rebel'].map((faction, team) => {
        const rows = instantRoster(faction),
          shielded = rows.filter(r => shipsOf(r.type).some(t => t.num('Shield_Points', 0) > 0)),
          big = shielded.filter(r => r.cls >= 4),
          pick = (big[0] || shielded[0] || rows[0]).name,
          escort = (rows.find(r => r.cls >= 2 && r.cls <= 4 && r.name !== pick) || rows[1]).name;
        return { faction, team, budget, kind: team ? 'medium' : 'you', army: [pick, escort, pick, escort] };
      });
      localStorage.setItem('swr-instant-setup', JSON.stringify({ turn: 0, budget, players }));
      return players.map(p => ({ faction: p.faction, army: p.army }));
    });
    log('space.fleet', fleet);

    for (const id of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON'])
      await frame.locator(`.title-menu [data-id="${id}"]`).click({ timeout: 60000 });
    const board = frame.locator('.op-setup');
    await board.waitFor({ timeout: 90000 });
    await board.getByRole('searchbox').fill('Abregado Rae Forces of Corruption space');
    await board.locator('[data-world="Abregado_Rae"][data-domain="space"][data-source="stock"]').first().click({ timeout: 90000 });
    await board.locator('.op-go').click();
    await frame.locator('#loading.hidden').waitFor({ state: 'attached', timeout: PAGE.timeout });
    await waitGame(frame);

    const boot = await frame.evaluate(async () => {
      const g = game, w = g.world;
      const until = performance.now() + 60000;
      while (!w.ramImpacts && performance.now() < until) await new Promise(r => setTimeout(r, 100));
      return {
        mode: g.setup?.mode,
        type: g.setup?.type,
        worker: !!g.workerMode,
        ramRule: g.setup?.ramRule,
        net: !!g.setup?.net,
        replay: !!g.setup?.replay,
        ram: !!w.ramImpacts,
        units: w.units.length,
        mobile: w.units.filter(u => u.isMobile && !u.isPad && !u.isStation).length,
      };
    });
    log('space.boot', boot);
    assert.equal(boot.mode, 'space');
    assert.equal(boot.worker, false, 'this leg needs the page-authoritative World (worker off)');
    assert.equal(boot.net, false);
    assert.equal(boot.replay, false);
    assert.equal(boot.ramRule, 1, 'live solo space session must record ramRule = 1');
    assert.ok(boot.ram, 'BLOCKER: mounted space world has no ramImpacts; game-authoritative ramming is not live in this checkout');

    const scope = await scopeGuard(frame);
    log('space.scope', scope);
    assertScope(scope);

    const setup = await frame.evaluate(async () => {
      const g = game, w = g.world;
      g.paused = true;
      // Let hyper arrivals land: hyper units are invulnerable and ignored.
      // The opening cinematic freezes the live loop, so step the same real update.
      for (let i = 0; i < 300 && w.units.filter(u => !u.hyper && !u.dead).length < 6; i++) w.update(1 / 30);
      const { directState } = await import('/js/game/sim.js');
      const mob = w.units.filter(u => u.isMobile && !u.isPad && !u.isStation && !u.isFighter && !u.dead && !u.hyper && u.maxHealth > 0 && u.player);
      const viewer = w.viewer;
      const mine = mob.filter(u => u.player.team === viewer.team),
        foes = mob.filter(u => u.player.team !== viewer.team);
      if (mine.length < 3 || foes.length < 3) return { error: 'need 3 ships per side', mine: mine.length, foes: foes.length, mob: mob.length };
      // Quiet every mobile hull so only the placed pairs can meet.
      for (const u of mob) {
        u.target = null;
        u.speed = 0;
        u.direct = directState();
        u.direct.firing = false;
        u.setOrder?.({ kind: 'idle' });
        u.syncObj?.();
      }
      const pairs = [0, 1, 2].map(i => {
        const a = foes[i], b = mine[i];
        a.__ramKey = `A${i + 1}`;
        b.__ramKey = `B${i + 1}`;
        return [a, b];
      });
      const [p1, p2, p3] = pairs;
      // Scenario 2: raise B2 shielding so the same high-speed hit is absorbed
      // without touching its hull (the real applyDamage order).
      p2[1].maxShield = 4000;
      p2[1].shield = 4000;
      const ramRadius = u => {
        const r0 = Math.min(u.hitRadius, ...(u.hitB > 0 && u.hitC > 0 ? [u.hitB, u.hitC] : []));
        const radius = Number.isFinite(r0) && r0 > 0 ? r0 : 10;
        const span = Number.isFinite(u.hitA) ? Math.max(0, Math.min(1600, u.hitA - radius)) : 0;
        return span + radius;
      };
      const ext = { x: (w.min.x + w.max.x) / 2, y: (w.min.y + w.max.y) / 2 };
      const bands = [-0.3, 0, 0.3];
      const placement = pairs.map(([a, b], i) => {
        const cy = ext.y + bands[i] * (w.max.y - w.min.y) * 0.5;
        const cx = ext.x + (i === 2 ? 0.25 : -0.25) * (w.max.x - w.min.x) * 0.25;
        const gap = Math.max(600, 2.2 * (ramRadius(a) + ramRadius(b)));
        const place = (u, x, h) => {
          u.x = x;
          u.y = cy;
          u.z = 0;
          u.heading = h;
          u.speed = u.maxSpeed;
          u.direct = directState();
          u.direct.throttle = 1;
          u.direct.firing = false;
          u.target = null;
          u.setOrder?.({ kind: 'idle' });
          u.syncObj?.();
        };
        place(a, cx - gap / 2, 0);
        place(b, cx + gap / 2, Math.PI);
        return { gap, cy, cx, rA: ramRadius(a), rB: ramRadius(b) };
      });
      // Stationary overlap control: two fresh hostile hulls on one point.
      const [c, d] = p3;
      for (const u of [c, d]) {
        u.x = ext.x;
        u.y = ext.y + 0.4 * (w.max.y - w.min.y) * 0.5;
        u.z = 0;
        u.speed = 0;
        u.direct = directState();
        u.direct.throttle = 0;
        u.direct.firing = false;
        u.target = null;
        u.syncObj?.();
      }

      w.__ram = { impacts: [], damage: [], start: w.ramImpacts.impacts };
      const end = w.ramImpacts.end.bind(w.ramImpacts);
      w.ramImpacts.end = (units, cb) =>
        end(units, (x, y, amount, at) => {
          w.__ram.impacts.push({ a: x.__ramKey || 'other', b: y.__ramKey || 'other', amount });
          return cb(x, y, amount, at);
        });
      const damage = w.damage.bind(w);
      w.damage = (target, amount, opts) => {
        w.__ram.damage.push({
          key: target.__ramKey || 'other',
          amount,
          from: opts && opts.from && (opts.from.__ramKey || 'other'),
          proj: !!(opts && opts.proj),
          type: opts && opts.damageType,
          t: +w.time.toFixed(3),
        });
        return damage(target, amount, opts);
      };

      const snap = ([a, b]) => ({
        a: { key: a.__ramKey, type: a.type.name, health: a.health, shield: a.shield, maxShield: a.maxShield, maxSpeed: a.maxSpeed },
        b: { key: b.__ramKey, type: b.type.name, health: b.health, shield: b.shield, maxShield: b.maxShield, maxSpeed: b.maxSpeed },
      });
      return { mob: mob.length, placement, pairs: pairs.map(snap) };
    });
    log('space.setup', setup);
    assert.ok(!setup.error, `space fixture could not be prepared: ${setup.error}`);

    async function runPair(keyA, keyB, { ticks = 300 } = {}) {
      return frame.evaluate(async ({ keyA, keyB, ticks }) => {
        const w = game.world;
        const a = w.units.find(u => u.__ramKey === keyA), b = w.units.find(u => u.__ramKey === keyB);
        const impacts0 = w.ramImpacts.impacts, damage0 = w.__ram.damage.length, local0 = w.__ram.impacts.length;
        const before = { a: { health: a.health, shield: a.shield }, b: { health: b.health, shield: b.shield } };
        const trace = [];
        for (let i = 0; i < ticks; i++) {
          for (const u of [a, b]) if (u.direct) u.direct.throttle = 1;
          w.update(1 / 30);
          const involved = w.__ram.impacts.slice(local0).filter(p =>
            (p.a === keyA && p.b === keyB) || (p.a === keyB && p.b === keyA)
          );
          if (involved.length) break;
          if (i % 20 === 0) trace.push({ i, d: +Math.hypot(a.x - b.x, a.y - b.y).toFixed(0), sa: +a.speed.toFixed(1), sb: +b.speed.toFixed(1) });
        }
        const newImpacts = w.__ram.impacts.slice(local0);
        const involved = newImpacts.filter(p => (p.a === keyA && p.b === keyB) || (p.a === keyB && p.b === keyA));
        return {
          trace,
          involved,
          otherImpacts: newImpacts.filter(p => !involved.includes(p)),
          damage: w.__ram.damage.slice(damage0),
          before,
          after: { a: { health: a.health, shield: a.shield }, b: { health: b.health, shield: b.shield } },
        };
      }, { keyA, keyB, ticks });
    }

    function ramDamage(run, keyA, keyB) {
      return run.damage.filter(d => !d.proj && ((d.key === keyA && d.from === keyB) || (d.key === keyB && d.from === keyA)));
    }

    // Scenario 1: full-speed pass, hull spill-over after the shield pool empties.
    const s1 = await runPair('A1', 'B1');
    log('space.forced1', s1);
    assert.equal(s1.involved.length, 1, 'one high-speed space contact must register exactly one ram impact');
    const s1Hits = ramDamage(s1, 'A1', 'B1');
    assert.equal(s1Hits.length, 2, 'both ships must take the same real damage call');
    assert.ok(s1Hits.every(d => d.amount > 0 && d.type === 'Damage_Normal'));
    for (const side of ['a', 'b']) {
      const b = s1.before[side], a = s1.after[side];
      assert.equal(a.shield, 0, `${side} shield must be spent by the hit`);
      assert.ok(a.health < b.health, `${side} hull must take the spill-over after its shield`);
    }
    // Stop the pair and pull the latch apart so they cannot re-latch while the
    // remaining scenarios step.
    await frame.evaluate(() => {
      const w = game.world;
      for (const k of ['A1', 'B1']) {
        const u = w.units.find(x => x.__ramKey === k);
        if (u) {
          u.direct.throttle = 0;
          u.speed = 0;
          u.x += k === 'A1' ? -4000 : 4000;
          u.syncObj?.();
        }
      }
    });

    // Scenario 2: shields raised above the hit, so a high-speed contact must
    // change shields and leave the hull untouched (shield-first through damage()).
    const s2 = await runPair('A2', 'B2');
    log('space.forced2', s2);
    assert.equal(s2.involved.length, 1, 'one high-speed space contact must register exactly one ram impact');
    const s2Hits = ramDamage(s2, 'A2', 'B2');
    assert.equal(s2Hits.length, 2);
    for (const side of ['a', 'b']) {
      const b = s2.before[side], a = s2.after[side];
      assert.ok(a.shield < b.shield, `${side} raised shields must absorb the ram`);
      assert.equal(a.health, b.health, `${side} hull must stay whole while shields absorb`);
    }

    // Control: stationary overlapping hostile hulls must not ram.
    const control = await frame.evaluate(async () => {
      const w = game.world;
      const c = w.units.find(u => u.__ramKey === 'A3'), d = w.units.find(u => u.__ramKey === 'B3');
      const impacts0 = w.ramImpacts.impacts, damage0 = w.__ram.damage.length;
      const before = { c: c.health + c.shield, d: d.health + d.shield };
      for (let i = 0; i < 45; i++) {
        for (const u of [c, d]) {
          u.speed = 0;
          u.direct.throttle = 0;
          u.target = null;
        }
        w.update(1 / 30);
      }
      return {
        distance: +Math.hypot(c.x - d.x, c.y - d.y).toFixed(2),
        newImpacts: w.ramImpacts.impacts - impacts0,
        newDamage: w.__ram.damage.slice(damage0),
        delta: { c: before.c - (c.health + c.shield), d: before.d - (d.health + d.shield) },
      };
    });
    log('space.stationaryOverlap', control);
    assert.equal(control.distance, 0, 'control pair must overlap');
    assert.equal(control.newImpacts, 0, 'stationary overlap must not produce ram damage');
    assert.deepEqual(control.newDamage.filter(x => !x.proj), [], 'stationary overlap must not make a non-projectile damage call');
    assert.ok(control.delta.c <= 0.001 && control.delta.d <= 0.001, 'stationary overlap must not damage either hull or shield');

    assert.deepEqual(errors, [], 'no page errors during the space leg');
    log('space.verdict', {
      pass: true,
      workerOff: true,
      forcedApproach: 'hostile frigates at maxSpeed with real u.direct throttle, real World.update ticks, real World.damage()',
      scenarios: ['shield spent then hull spill-over', 'raised shield absorbs, hull untouched', 'stationary overlap does nothing'],
      otherImpacts: s1.otherImpacts.concat(s2.otherImpacts),
      note: 'Forced motion is used only for reproducibility; AI-initiated rams are reported, not asserted.',
    });
  } finally {
    await browser.close();
  }
}

(async () => {
  const want = process.argv.includes('--land') ? ['land'] : process.argv.includes('--space') ? ['space'] : ['land', 'space'];
  for (const leg of want) {
    console.log(`\n=== ${leg} ===`);
    if (leg === 'land') await land();
    else await space();
  }
  console.log('\nRAM IMPACTS: PASS');
})().catch(e => {
  console.error('\nRAM IMPACTS: FAIL', e && e.message);
  if (e && e.actual !== undefined) console.error('actual:', e.actual, 'expected:', e.expected);
  process.exit(1);
});
