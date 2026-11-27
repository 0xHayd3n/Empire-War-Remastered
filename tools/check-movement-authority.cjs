#!/usr/bin/env node
/**
 * Mounted acceptance check: default solo tactical movement authority
 * (world.ramImpacts = TacticalMovement) curtails a slow, non-damaging approach
 * and still lets free movement through.
 *
 * WHERE THIS RUNS
 *   Only against the mounted Universal window: http://127.0.0.1:8590/ (EW_BASE
 *   overrides). Every tick is the real LandWorld.update / World.update of a
 *   live solo game reached through that window's #game frame. play.html is
 *   never opened directly and the sibling classic checkout is never used.
 *
 * WHAT IT PROVES (and nothing else)
 *   land  : a genuinely slow foot soldier and a genuinely slow vehicle, both
 *           facing a stationary solid land structure, have their real
 *           displacement curtailed, count >= 1 world.ramImpacts.motionStops,
 *           count 0 world.ramImpacts.impacts, and lose no HP.
 *   space : a controlled low-throttle ship approaching a stationary solid ship
 *           stops at contact without damage, counts motionStops, and a free
 *           lane still lets it make progress.
 *   both  : stationary overlap is not treated as a stop or a ram; a normal
 *           arrival in open ground is not treated as a stop; game status
 *           (mode, time, living units, no page errors) stays normal.
 *
 * INSTRUMENTATION (deliberately minimal)
 *   - Test placements/inputs only: unit positions, heading, path, u.speed
 *     (land) or u.direct.throttle (space), and clearing AI targets. These are
 *     the same inputs the game's own order mover consumes.
 *   - w.hurt (land) / w.damage (space) are wrapped to OBSERVE calls for the
 *     tagged test units; the wrapper always calls through, so the real damage
 *     mechanism still runs. No damage is applied or suppressed by the test.
 *   - The free-lane control is the identical initial situation with the other
 *     hull's scriptHidden set (so it is ignored by the authority/collision
 *     broadphase), then restored. No unit is teleported between ticks.
 *   - The test never calls begin()/end() itself; world.update does that.
 *   - Other units are frozen (speed 0, no orders) so the counters belong to
 *     the placed pair. Weapons are not tested here (covered separately).
 *
 * RUN
 *   node check-movement-authority.cjs            # land + space
 *   node check-movement-authority.cjs --land     # land only
 *   node check-movement-authority.cjs --space    # space only
 *   EW_BASE=http://127.0.0.1:8590/ node check-movement-authority.cjs
 *
 * If world.ramImpacts is not a TacticalMovement yet, the check fails fast with
 * a "BLOCKER:" message naming what is missing; no scenario is faked.
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const BASE = process.env.EW_BASE || 'http://127.0.0.1:8590/';
const REPO = path.resolve(__dirname, '..');
const PAGE_TIMEOUT = 190000;

function playwright() {
  const tries = [process.env.EW_PW, 'playwright-core', path.join(REPO, 'node_modules', 'playwright-core')];
  for (const t of tries) {
    if (!t) continue;
    try {
      return require(t);
    } catch {}
  }
  throw new Error('playwright-core not found; set EW_PW to its directory');
}
const { chromium } = playwright();

async function launch() {
  const opts = { args: ['--enable-unsafe-swiftshader'], protocolTimeout: 600000 };
  let browser;
  try {
    browser = await chromium.launch({ ...opts, channel: 'chrome' });
  } catch {
    browser = await chromium.launch(opts);
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { browser, page, errors };
}

async function frameAt(page, urlPart) {
  const until = Date.now() + PAGE_TIMEOUT;
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

const waitGame = frame => frame.waitForFunction(() => window.game?.world?.units?.length > 0, null, { timeout: PAGE_TIMEOUT });

const setFrameQuery = (page, key) =>
  page.locator('#game').evaluate((f, k) => {
    const u = new URL(f.src);
    u.searchParams.set(k, '');
    f.src = u.href;
  }, key);

const evidence = {};
function record(name, value) {
  evidence[name] = value;
  console.log(`\n[${name}] ${JSON.stringify(value, null, 2)}`);
}

// Rule scope guard: only a live solo session opts into the new authority.
async function scope(frame) {
  return frame.evaluate(async () => {
    const { motionRule, installBattlePhysics } = await import('/js/game/battle-physics.js');
    const { TacticalMovement } = await import('/js/game/tactical-movement.js');
    const { RamImpacts } = await import('/js/game/ram-impacts.js');
    const fake = extra => ({ mode: 'space', ...extra });
    return {
      liveSolo: motionRule(fake({})),
      net: motionRule(fake({ net: {} })),
      replayOld: motionRule(fake({ replay: { version: 1 } })),
      replayNew: motionRule(fake({ replay: { version: 1 }, ramRule: 1, battlePhysicsRule: 1 })),
      restoreOld: motionRule(fake({ restore: { battle: { physicsRule: 0 } } })),
      restoreNew: motionRule(fake({ restore: { battle: { physicsRule: 1 } } })),
      attract: motionRule(fake({ attract: true })),
      headless: motionRule(fake({ headless: true })),
      subclass: new TacticalMovement({}, 'land') instanceof RamImpacts,
      installKind: typeof installBattlePhysics
    };
  });
}

function assertScope(s) {
  assert.equal(s.liveSolo, 1, 'a new live solo battle must install the movement authority');
  assert.equal(s.net, 0, 'network peers must not opt in before a rules handshake');
  assert.equal(s.replayOld, 0, 'old recordings must not gain new movement rules');
  assert.equal(s.replayNew, 1, 'recordings made with the rule must keep it');
  assert.equal(s.restoreOld, 0, 'old saves must not silently change');
  assert.equal(s.restoreNew, 1, 'saves made with the rule must restore it');
  assert.equal(s.attract, 0, 'attract mode must not opt in');
  assert.equal(s.headless, 0, 'headless runs must not opt in');
  assert.equal(s.subclass, true, 'TacticalMovement must be a RamImpacts subclass');
}

// Production gate: the authority must not choose behaviour by unit type name.
async function productionGate(frame) {
  return frame.evaluate(async () => {
    const { TacticalMovement } = await import('/js/game/tactical-movement.js');
    const { RamImpacts } = await import('/js/game/ram-impacts.js');
    const src = {
      'TacticalMovement.eligible': TacticalMovement.prototype.eligible.toString(),
      'TacticalMovement.passThrough': TacticalMovement.prototype.passThrough.toString(),
      'RamImpacts.eligible': RamImpacts.prototype.eligible.toString()
    };
    return Object.fromEntries(
      Object.entries(src).map(([k, s]) => [
        k,
        {
          typeNameRefs: (s.match(/\.type\.name/g) || []).length,
          allowList: /\b(allow|allowed|whitelist|byName|NAMES)\b/i.test(s),
          source: s.replace(/\s+/g, ' ').slice(0, 220)
        }
      ])
    );
  });
}

function assertGate(gate) {
  for (const [name, g] of Object.entries(gate)) {
    assert.equal(g.typeNameRefs, 0, `${name} must not gate on a unit type name: ${g.source}`);
    assert.equal(g.allowList, false, `${name} must not use a unit-name allowlist: ${g.source}`);
  }
}

// ---------------------------------------------------------------------------
// Land: live solo ground-offensive session, paused, stepped by the real update.
// ---------------------------------------------------------------------------
async function land() {
  const { browser, page, errors } = await launch();
  try {
    await page.goto(BASE + '#ground-offensive');
    const frame = await frameAt(page, 'play.html');
    await frame.locator('#loading.hidden').waitFor({ state: 'attached', timeout: PAGE_TIMEOUT });
    await waitGame(frame);

    const boot = await frame.evaluate(async () => {
      const until = performance.now() + 90000;
      while ((!window.game?.world?.ramImpacts || game.warming) && performance.now() < until) await new Promise(r => setTimeout(r, 100));
      const g = game,
        w = g.world,
        R = w.ramImpacts,
        chain = [];
      for (let p = R && Object.getPrototypeOf(R); p && p !== Object.prototype; p = Object.getPrototypeOf(p))
        chain.push(p.constructor?.name);
      return {
        mode: g.setup?.mode,
        type: g.setup?.type,
        paused: !!g.paused,
        net: !!g.setup?.net,
        replay: !!g.setup?.replay,
        ram: !!R,
        constructor: R?.constructor?.name,
        chain,
        motionStops: R?.motionStops,
        impacts: R?.impacts,
        units: w.units.length,
        feet: w.units.filter(u => u.foot && !u.dead).length,
        vehicles: w.units.filter(u => u.kind === 'VEHICLE' && !u.foot && !u.structure && !u.dead).length,
        structures: w.units.filter(u => u.structure && !u.dead && u.footprint?.length).length
      };
    });
    record('land.boot', boot);
    assert.equal(boot.mode, 'land');
    assert.equal(boot.net, false, 'land fixture must be a live solo session');
    assert.equal(boot.replay, false, 'land fixture must be a live session, not a replay');
    assert.ok(boot.ram, 'BLOCKER: mounted land world has no world.ramImpacts; the movement authority is not installed');
    assert.ok(
      boot.chain.includes('TacticalMovement'),
      `BLOCKER: world.ramImpacts is not a TacticalMovement (constructor ${boot.constructor}, chain ${boot.chain.join(' -> ')})`
    );
    assert.ok(
      Number.isFinite(boot.motionStops) && Number.isFinite(boot.impacts),
      'BLOCKER: world.ramImpacts has no numeric .motionStops/.impacts counters'
    );
    assert.ok(boot.structures >= 1, `need a solid land structure, saw ${boot.structures}`);

    const s = await scope(frame);
    record('land.scope', s);
    assertScope(s);
    const gate = await productionGate(frame);
    record('land.productionGate', gate);
    assertGate(gate);

    const run = await frame.evaluate(async () => {
      const g = game,
        w = g.world;
      g.paused = true;
      const { CELL } = await import('/js/game/terrain.js');
      const span = w.terrain.size * CELL;
      const all = w.units.filter(u => !u.dead);
      const initialAlive = all.length;
      const canLead = u => !u.squad || !u.squad.box || !u.slot;
      const vehicles = all.filter(
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
          !u.spot &&
          u.maxHealth > 0 &&
          u.health > 0 &&
          u.speed > 0 &&
          canLead(u)
      );
      const feet = all.filter(
        u =>
          u.foot &&
          !u.structure &&
          !u.flies &&
          !u.inside &&
          !u.cinematicTransport &&
          !u.untargetable &&
          !u.spot &&
          u.maxHealth > 0 &&
          u.health > 0 &&
          u.speed > 0 &&
          canLead(u)
      );
      const structures = all.filter(
        u => u.structure && !u.flies && !u.untargetable && u.maxHealth > 0 && u.footprint?.length && canLead(u)
      );
      // Freeze every other unit so the counters belong to the placed pair.
      for (const u of all) {
        u.target = null;
        u.path = [];
        u.mv = 0;
        u.v = 0;
        u.speed = 0;
        u.blockFails = 0;
        if (u.squad) {
          u.squad.foe = null;
          u.squad.post = null;
          u.squad.march = null;
          u.squad.leash = null;
          u.squad.legs = null;
          u.squad.formSpeed = null;
          u.squad.formMove = null;
        }
      }
      // Three open lanes, each clear along the whole approach segment. Prefer
      // the lanes with the largest clearance so ranged combat stays elsewhere.
      const candidates = [];
      for (let gy = 0.2; gy <= 0.8; gy += 0.04)
        for (let gx = 0.2; gx <= 0.8; gx += 0.04) {
          const x = gx * span,
            y = gy * span;
          let open = true;
          for (let dx = -180; dx <= 180 && open; dx += 8) if (!w.isOpen(x + dx, y, 6)) open = false;
          if (!open) continue;
          if (candidates.some(p => Math.hypot(p.x - x, p.y - y) < 300)) continue;
          const clear = Math.min(...all.filter(u => !u.dead && !u.structure).map(u => Math.hypot(u.x - x, u.y - y)), Infinity);
          if (clear < 180) continue;
          candidates.push({ x, y, clear: +clear.toFixed(1) });
        }
      candidates.sort((p, q) => q.clear - p.clear);
      const spots = candidates.slice(0, 3);
      // Prefer an actual infantry soldier, then a full-health one; same for vehicles.
      const cls = u => (u.type.str('UnitCollisionClass') || '').trim().toUpperCase();
      feet.sort((a, b) => (cls(b) === 'INFANTRY') - (cls(a) === 'INFANTRY') || b.health - a.health);
      vehicles.sort((a, b) => b.health / b.maxHealth - a.health / a.maxHealth);
      if (spots.length < 3 || !vehicles.length || !feet.length || !structures.length)
        return {
          error: 'fixture',
          spots: spots.length,
          vehicles: vehicles.length,
          feet: feet.length,
          structures: structures.length
        };

      const hurtLog = [];
      const hurt = w.hurt.bind(w);
      w.hurt = (u, amount, from, how, shot, contact) => {
        hurtLog.push({
          k: u.__k || 'other',
          amount: +amount.toFixed(2),
          from: from && (from.__k || 'other'),
          shot: !!shot,
          contact: !!contact
        });
        return hurt(u, amount, from, how, shot, contact);
      };

      const SPEED = 3; // genuinely slow: below the land ram floor of 5 units/s
      const TICKS = 600;
      const tag = (u, k) => {
        u.__k = k;
        u.mv = 0;
        u.v = 0;
        u.target = null;
        u.blockFails = 0;
        if (u.squad) {
          u.squad.foe = null;
          u.squad.post = null;
          u.squad.march = null;
          u.squad.leash = null;
          u.squad.legs = null;
          u.squad.formSpeed = null;
          u.squad.formMove = null;
        }
      };
      const place = (u, x, y, h, speed) => {
        u.x = x;
        u.y = y;
        u.heading = h;
        u.lastX = x;
        u.lastY = y;
        u.path = [];
        // Normalise the cruise so the approach is genuinely slow for every hull
        // type (pace < 1 would otherwise silently shrink it).
        u.speed = speed / (w.paceOf(u) || 1);
        tag(u, u.__k);
      };
      const step = (mover, structure, spot, opts) => {
        const rA = mover.hitRadius || mover.body || 8,
          rB = structure.hitRadius || structure.body || 20,
          gap = rA + rB + 0.6;
        const start = { x: spot.x - gap / 2, y: spot.y };
        const orig = { x: structure.x, y: structure.y, z: structure.z, h: structure.heading, hidden: !!structure.scriptHidden };
        const on = !!opts.block;
        structure.x = spot.x + gap / 2;
        structure.y = spot.y;
        structure.z = w.groundZ(structure.x,structure.y) + (structure.lift || 0);
        structure.heading = Math.PI;
        structure.scriptHidden = on ? orig.hidden : true;
        place(mover, start.x, start.y, 0, SPEED);
        mover.z = w.groundZ(mover.x,mover.y) + (mover.lift || 0) + (mover.hoverZ || 0);
        mover.path = [{ x: spot.x + 400, y: spot.y, free: true }];
        mover.mv = 0;
        const s0 = w.ramImpacts.motionStops,
          i0 = w.ramImpacts.impacts,
          h0 = hurtLog.length;
        const hp0 = { m: mover.health + (mover.shield || 0), b: structure.health + (structure.shield || 0) };
        const p0 = { x: mover.x, y: mover.y },
          b0 = { x: structure.x, y: structure.y };
        const samples = [];
        let maxStep = 0,
          prev = { x: mover.x, y: mover.y };
        for (let i = 0; i < opts.ticks; i++) {
          mover.target = null;
          structure.target = null;
          if (!mover.path.length && opts.reissue) mover.path = [{ x: spot.x + 400, y: spot.y, free: true }];
          // Hold the slow cruise speed (the same input the order mover consumes)
          // so the check measures the stop, not each hull's acceleration ramp.
          if (opts.drive) mover.mv = SPEED;
          w.update(1 / 30);
          const d = Math.hypot(mover.x - prev.x, mover.y - prev.y);
          if (d > maxStep) maxStep = d;
          prev = { x: mover.x, y: mover.y };
          if (i < 4 || i % 30 === 0 || i === opts.ticks - 1)
            samples.push({
              i,
              x: +mover.x.toFixed(2),
              y: +mover.y.toFixed(2),
              mv: +(mover.mv || 0).toFixed(2),
              gapToStructure: +Math.hypot(mover.x - structure.x, mover.y - structure.y).toFixed(2),
              hp: +mover.health.toFixed(1)
            });
        }
        const out = {
          ticks: opts.ticks,
          speed: SPEED,
          threshold: Math.max(5, 0.3 * (mover.speed || 1)),
          measuredSpeed: +(maxStep * 30).toFixed(2),
          net: +Math.hypot(mover.x - p0.x, mover.y - p0.y).toFixed(2),
          netX: +(mover.x - p0.x).toFixed(2),
          d0: +Math.hypot(p0.x - b0.x, p0.y - b0.y).toFixed(2),
          d1: +Math.hypot(mover.x - structure.x, mover.y - structure.y).toFixed(2),
          final: { x: +mover.x.toFixed(2), y: +mover.y.toFixed(2), hp: +mover.health.toFixed(1) },
          blockerX: +structure.x.toFixed(2),
          blockerY: +structure.y.toFixed(2),
          structureMoved: +Math.hypot(structure.x - b0.x, structure.y - b0.y).toFixed(2),
          stops: w.ramImpacts.motionStops - s0,
          impacts: w.ramImpacts.impacts - i0,
          hpDrop: {
            m: +(hp0.m - (mover.health + (mover.shield || 0))).toFixed(2),
            b: +(hp0.b - (structure.health + (structure.shield || 0))).toFixed(2)
          },
          taggedHurt: hurtLog.slice(h0).filter(x => x.k === 'M' || x.k === 'B'),
          samples
        };
        structure.x = orig.x;
        structure.y = orig.y;
        structure.z = orig.z;
        structure.heading = orig.h;
        structure.scriptHidden = orig.hidden;
        return out;
      };
      const scenarios = {};
      const healthy = u => u && !u.dead && u.health > 0;
      for (const [label, pool, spot] of [
        ['vehicle', vehicles, spots[1]],
        ['foot', feet, spots[0]]
      ]) {
        // Re-pick now: ranged combat elsewhere can kill a candidate while the
        // previous scenario runs. Only the movement stop is under test.
        const structure = structures.find(healthy);
        // Prefer an allied mover so no weapon fire can confound the HP check.
        const mover = structure && (pool.find(u => healthy(u) && w.ally(u.side, structure.side)) || pool.find(healthy));
        if (!mover || !structure) {
          scenarios[label] = { error: 'no healthy unit left for this scenario' };
          continue;
        }
        tag(mover, 'M');
        tag(structure, 'B');
        const allied = w.ally(mover.side, structure.side);
        const info = {
          mover: { type: mover.type.name, side: mover.side, r: mover.hitRadius, hp: mover.health, speed: mover.speed },
          structure: { type: structure.type.name, side: structure.side, r: structure.hitRadius, hp: structure.health, allied }
        };
        const block = step(mover, structure, spot, { block: true, ticks: TICKS, reissue: true, drive: true });
        const free = step(mover, structure, spot, { block: false, ticks: TICKS, reissue: false, drive: true });
        scenarios[label] = { ...info, spot, gap: +(info.mover.r + info.structure.r + 0.6).toFixed(2), block, free };
      }

      // Arrival: a short open order must be reached and must not count a stop.
      // Run this before the overlap control so no other test hull shares the lane.
      const e = vehicles.find(healthy) || vehicles[0];
      tag(e, 'E');
      const target = { x: spots[2].x + 8, y: spots[2].y };
      place(e, spots[2].x, spots[2].y, 0, SPEED);
      e.path = [{ x: target.x, y: target.y, free: true }];
      const aS = w.ramImpacts.motionStops,
        aI = w.ramImpacts.impacts,
        aH = hurtLog.length,
        aHp = e.health;
      for (let i = 0; i < 240; i++) {
        e.target = null;
        w.update(1 / 30);
      }
      const arrival = {
        type: e.type.name,
        distanceToTarget: +Math.hypot(e.x - target.x, e.y - target.y).toFixed(2),
        moved: +Math.hypot(e.x - spots[2].x, e.y - spots[2].y).toFixed(2),
        stops: w.ramImpacts.motionStops - aS,
        impacts: w.ramImpacts.impacts - aI,
        hpDrop: +(aHp - e.health).toFixed(2),
        taggedHurt: hurtLog.slice(aH).filter(x => x.k === 'E'),
        final: { x: +e.x.toFixed(2), y: +e.y.toFixed(2) }
      };
      // Park the arrival mover well away so the overlap control has a clean point.
      e.x = spots[2].x + 1200;
      e.y = spots[2].y + 1200;
      e.path = [];
      e.mv = 0;
      e.speed = 0;

      // Stationary overlap: two frozen vehicles on one point must not be a stop
      // or a ram, and must not be ejected.
      const ov = vehicles.filter(healthy);
      const c = ov[1] || ov[0],
        d = ov.find(u => u !== c && u.side === c.side) || ov[2] || ov[0];
      tag(c, 'C');
      tag(d, 'D');
      place(c, spots[2].x, spots[2].y, 0, 0);
      place(d, spots[2].x, spots[2].y, 0, 0);
      const oS = w.ramImpacts.motionStops,
        oI = w.ramImpacts.impacts,
        oH = hurtLog.length,
        oHp = { c: c.health, d: d.health };
      for (let i = 0; i < 90; i++) {
        c.path = [];
        d.path = [];
        c.mv = 0;
        d.mv = 0;
        c.target = null;
        d.target = null;
        w.update(1 / 30);
      }
      const overlap = {
        distance: +Math.hypot(c.x - d.x, c.y - d.y).toFixed(2),
        stops: w.ramImpacts.motionStops - oS,
        impacts: w.ramImpacts.impacts - oI,
        hpDrop: { c: +(oHp.c - c.health).toFixed(2), d: +(oHp.d - d.health).toFixed(2) },
        taggedHurt: hurtLog.slice(oH).filter(x => x.k === 'C' || x.k === 'D'),
        final: { c: { x: +c.x.toFixed(2), y: +c.y.toFixed(2) }, d: { x: +d.x.toFixed(2), y: +d.y.toFixed(2) } }
      };

      return {
        initialAlive,
        frozen: all.length,
        spots,
        scenarios,
        overlap,
        arrival,
        counters: { motionStops: w.ramImpacts.motionStops, impacts: w.ramImpacts.impacts },
        status: {
          mode: g.setup?.mode,
          type: g.setup?.type,
          paused: !!g.paused,
          time: +w.time.toFixed(2),
          alive: w.units.filter(u => !u.dead).length,
          winner: !!w.winner
        },
        otherHurt: hurtLog.filter(x => !'MBCDE'.includes(x.k)).length
      };
    });
    record('land.run', run);
    assert.ok(!run.error, `land fixture could not be prepared: ${JSON.stringify(run)}`);

    for (const key of ['foot', 'vehicle']) {
      const sc = run.scenarios[key];
      assert.ok(sc && !sc.error, `land ${key} scenario missing: ${JSON.stringify(sc)}`);
      const b = sc.block,
        f = sc.free;
      assert.ok(
        b.measuredSpeed < b.threshold,
        `${key} approach must be genuinely slow (measured ${b.measuredSpeed}, threshold ${b.threshold})`
      );
      assert.ok(b.stops >= 1, `${key}: the slow approach into a solid structure must count motionStops (saw ${b.stops})`);
      assert.equal(b.impacts, 0, `${key}: a below-threshold approach must not count a damaging ram`);
      assert.deepEqual(b.taggedHurt, [], `${key}: the slow approach must not call hurt() on either hull`);
      assert.ok(b.hpDrop.m <= 0.001 && b.hpDrop.b <= 0.001, `${key}: neither hull may lose HP, saw ${JSON.stringify(b.hpDrop)}`);
      assert.ok(b.structureMoved <= 0.01, `${key}: the structure must stay stationary, moved ${b.structureMoved}`);
      assert.ok(
        b.net <= f.net * 0.75 && b.net <= f.net - 2,
        `${key}: actual displacement must be curtailed (block ${b.net} vs free ${f.net})`
      );
      assert.ok(b.netX < sc.gap, `${key}: mover must not cross the structure (netX ${b.netX}, gap ${sc.gap})`);
      assert.ok(
        b.final.x < b.blockerX && b.d1 > 0,
        `${key}: mover must stay on its own side of the structure (final x ${b.final.x}, blocker x ${b.blockerX})`
      );
      assert.ok(f.net >= 5, `${key}: free lane must allow progress (free net ${f.net})`);
      assert.equal(f.stops, 0, `${key}: a free lane must not count a motion stop (saw ${f.stops})`);
      assert.equal(f.impacts, 0, `${key}: a free lane must not count a ram`);
      assert.deepEqual(f.taggedHurt, [], `${key}: a free lane must not damage either hull`);
      assert.ok(f.hpDrop.m <= 0.001 && f.hpDrop.b <= 0.001, `${key}: free lane HP must be unchanged`);
    }

    const o = run.overlap;
    assert.ok(o.distance <= 2, `stationary overlap must stay overlapped (distance ${o.distance})`);
    assert.equal(o.stops, 0, `stationary overlap must not count a motion stop (saw ${o.stops})`);
    assert.equal(o.impacts, 0, 'stationary overlap must not count a ram');
    assert.deepEqual(o.taggedHurt, [], 'stationary overlap must not damage either hull');
    assert.ok(o.hpDrop.c <= 0.001 && o.hpDrop.d <= 0.001, 'stationary overlap must not lose HP');

    const a = run.arrival;
    assert.ok(a.moved >= 5, `arrival must make progress (moved ${a.moved})`);
    assert.ok(a.distanceToTarget <= 2.5, `arrival must reach its own target (distance ${a.distanceToTarget})`);
    assert.equal(a.stops, 0, `a normal arrival must not count a motion stop (saw ${a.stops})`);
    assert.equal(a.impacts, 0, 'a normal arrival must not count a ram');
    assert.deepEqual(a.taggedHurt, [], 'a normal arrival must not damage the mover');
    assert.ok(a.hpDrop <= 0.001, 'a normal arrival must not lose HP');

    assert.equal(run.status.mode, 'land', 'game mode must stay normal');
    assert.ok(run.status.time > 0, 'world time must advance');
    assert.ok(
      run.status.alive >= Math.max(5, run.initialAlive * 0.25),
      `the world must stay populated (${run.status.alive}/${run.initialAlive})`
    );
    assert.equal(run.status.winner, false, 'the movement test must not end the game');
    assert.deepEqual(errors, [], 'no page errors during the land leg');

    record('land.verdict', {
      pass: true,
      land: 'slow foot + slow vehicle into a stationary structure: curtailed, motionStops counted, 0 impacts, 0 HP loss; free lane progresses; overlap/arrival preserved'
    });
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Space: live solo instant battle, page-authoritative world (no space worker).
// ---------------------------------------------------------------------------
async function space() {
  const { browser, page, errors } = await launch();
  try {
    await page.goto(BASE);
    let frame = await frameAt(page, 'play.html');
    await frame.locator('.title-menu [data-id="TITLE_PLAY"]').waitFor({ timeout: PAGE_TIMEOUT });
    await setFrameQuery(page, 'nospaceworker');
    frame = await frameAt(page, 'nospaceworker');
    await frame.locator('.title-menu [data-id="TITLE_PLAY"]').waitFor({ timeout: PAGE_TIMEOUT });

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
    record('space.fleet', fleet);
    for (const id of ['TITLE_PLAY', 'IDC_INSTANT_BATTLE_BUTTON'])
      await frame.locator(`.title-menu [data-id="${id}"]`).click({ timeout: 60000 });
    const board = frame.locator('.op-setup');
    await board.waitFor({ timeout: 90000 });
    await board.getByRole('searchbox').fill('Abregado Rae Forces of Corruption space');
    await board.locator('[data-world="Abregado_Rae"][data-domain="space"][data-source="stock"]').first().click({ timeout: 90000 });
    await board.locator('.op-go').click();
    await frame.locator('#loading.hidden').waitFor({ state: 'attached', timeout: PAGE_TIMEOUT });
    await waitGame(frame);

    const boot = await frame.evaluate(async () => {
      const g = game,
        w = g.world;
      const until = performance.now() + 60000;
      while (!w.ramImpacts && performance.now() < until) await new Promise(r => setTimeout(r, 100));
      const R = w.ramImpacts,
        chain = [];
      for (let p = R && Object.getPrototypeOf(R); p && p !== Object.prototype; p = Object.getPrototypeOf(p))
        chain.push(p.constructor?.name);
      return {
        mode: g.setup?.mode,
        worker: !!g.workerMode,
        ramRule: g.setup?.ramRule,
        physicsRule: g.setup?.battlePhysicsRule,
        net: !!g.setup?.net,
        replay: !!g.setup?.replay,
        ram: !!R,
        constructor: R?.constructor?.name,
        chain,
        motionStops: R?.motionStops,
        impacts: R?.impacts,
        units: w.units.length,
        stations: w.units.filter(u => u.isStation && !u.dead).length
      };
    });
    record('space.boot', boot);
    assert.equal(boot.mode, 'space');
    assert.equal(boot.worker, false, 'this leg needs the page-authoritative World (worker off)');
    assert.equal(boot.net, false, 'space fixture must be a live solo session');
    assert.equal(boot.replay, false, 'space fixture must be a live session, not a replay');
    assert.equal(boot.physicsRule, 1, 'a new solo space battle must record battlePhysicsRule = 1');
    assert.ok(boot.ram, 'BLOCKER: mounted space world has no world.ramImpacts; the movement authority is not installed');
    assert.ok(
      boot.chain.includes('TacticalMovement'),
      `BLOCKER: space world.ramImpacts is not a TacticalMovement (constructor ${boot.constructor}, chain ${boot.chain.join(' -> ')})`
    );
    assert.ok(
      Number.isFinite(boot.motionStops) && Number.isFinite(boot.impacts),
      'BLOCKER: space world.ramImpacts has no numeric .motionStops/.impacts counters'
    );

    const s = await scope(frame);
    record('space.scope', s);
    assertScope(s);

    const run = await frame.evaluate(async () => {
      const g = game,
        w = g.world;
      g.paused = true;
      for (let i = 0; i < 300 && w.units.filter(u => !u.hyper && !u.dead).length < 6; i++) w.update(1 / 30);
      const { directState } = await import('/js/game/sim.js');
      const mob = w.units.filter(
        u => u.isMobile && !u.isPad && !u.isStation && !u.isFighter && !u.dead && !u.hyper && u.maxHealth > 0 && u.player
      );
      const viewer = w.viewer;
      const mine = mob.filter(u => u.player.team === viewer.team);
      for (const u of mob) {
        u.target = null;
        u.speed = 0;
        u.direct = directState();
        u.direct.firing = false;
        u.setOrder?.({ kind: 'idle' });
        u.syncObj?.();
      }
      const dmgLog = [];
      const damage = w.damage.bind(w);
      w.damage = (t, amount, opts) => {
        dmgLog.push({
          k: t.__k || 'other',
          amount: +amount.toFixed(2),
          from: opts && opts.from && (opts.from.__k || 'other'),
          proj: !!(opts && opts.proj)
        });
        return damage(t, amount, opts);
      };
      const ramRadius = u => {
        const r0 = Math.min(u.hitRadius, ...(u.hitB > 0 && u.hitC > 0 ? [u.hitB, u.hitC] : []));
        const radius = Number.isFinite(r0) && r0 > 0 ? r0 : 10;
        const span = Number.isFinite(u.hitA) ? Math.max(0, Math.min(1600, u.hitA - radius)) : 0;
        return span + radius;
      };
      const movers = mine.filter(u => ramRadius(u) > 0 && u.maxSpeed > 0);
      if (movers.length < 4) return { error: 'need 4 allied mobile ships', mine: mine.length, mob: mob.length };
      const a = movers[0],
        b = movers[1],
        c = movers[2],
        d = movers[3] || movers[2];
      for (const [u, k] of [
        [a, 'A'],
        [b, 'B'],
        [c, 'C'],
        [d, 'D']
      ])
        u.__k = k;
      const ext = { x: (w.min.x + w.max.x) / 2, y: (w.min.y + w.max.y) / 2 };
      const eligibility = {
        land: w.ramImpacts.land,
        a: w.ramImpacts.eligible(a),
        b: w.ramImpacts.eligible(b),
        aMobile: a.isMobile,
        bMobile: b.isMobile,
        aHidden: !!a.scriptHidden,
        bHidden: !!b.scriptHidden,
        aHyper: !!a.hyper,
        bHyper: !!b.hyper,
        aRetreat: !!a.retreatFlight,
        bRetreat: !!b.retreatFlight,
        aTargetable: a.targetableUnit,
        bTargetable: b.targetableUnit,
        aStation: !!a.isStation,
        bStation: !!b.isStation,
        aPad: !!a.isPad,
        bPad: !!b.isPad,
        aHp: a.maxHealth,
        bHp: b.maxHealth,
        aCarrier: a.carrier === b,
        bCarrier: b.carrier === a
      };
      const place = (u, x, y, h, throttle) => {
        u.x = x;
        u.y = y;
        u.z = 0;
        u.heading = h;
        u.speed = 0;
        u.direct = directState();
        u.direct.throttle = throttle;
        u.direct.firing = false;
        u.target = null;
        u.setOrder?.({ kind: 'idle' });
        u.syncObj?.();
      };
      const THROTTLE = 0.12; // well below the 0.3 * maxSpeed ram threshold
      const TICKS = 900;
      const rA = ramRadius(a),
        rB = ramRadius(b),
        gap = rA + rB + 40;
      const origB = { x: b.x, y: b.y, z: b.z, h: b.heading, hidden: !!b.scriptHidden };
      const step = opts => {
        place(a, ext.x - gap / 2, ext.y, 0, THROTTLE);
        b.x = ext.x + gap / 2;
        b.y = ext.y;
        // Compare the actual 3D hulls, not icons crossing on the tactical map.
        // Stock ships can spawn on different layers and have different local hull offsets.
        b.z = a.z + (a.hitZ || 0) - (b.hitZ || 0) + (opts.overhead ? rA + rB + 40 : 0);
        b.heading = Math.PI;
        b.speed = 0;
        b.direct = directState();
        b.direct.throttle = 0;
        b.direct.firing = false;
        b.target = null;
        b.scriptHidden = !!opts.block ? false : true;
        a.scriptHidden = false;
        b.syncObj?.();
        const s0 = w.ramImpacts.motionStops,
          i0 = w.ramImpacts.impacts,
          d0 = dmgLog.length;
        const hp0 = { a: a.health + a.shield, b: b.health + b.shield };
        const p0 = { x: a.x, y: a.y };
        const samples = [];
        let maxStep = 0,
          prev = { x: a.x, y: a.y };
        for (let i = 0; i < opts.ticks; i++) {
          a.direct.throttle = THROTTLE;
          b.direct.throttle = 0;
          a.target = null;
          b.target = null;
          w.update(1 / 30);
          const d = Math.hypot(a.x - prev.x, a.y - prev.y);
          if (d > maxStep) maxStep = d;
          prev = { x: a.x, y: a.y };
          if (i < 4 || i % 60 === 0 || i === opts.ticks - 1)
            samples.push({
              i,
              x: +a.x.toFixed(1),
              y: +a.y.toFixed(1),
              speed: +a.speed.toFixed(2),
              gapToBlocker: +Math.hypot(a.x - b.x, a.y - b.y).toFixed(1),
              hp: +a.health.toFixed(1)
            });
        }
        const out = {
          ticks: opts.ticks,
          verticalGap: Math.abs(w.ramImpacts.rows.get(a).c.z - (b.z + (b.hitZ || 0))),
          threshold: Math.max(8, 0.3 * a.maxSpeed),
          measuredSpeed: +(maxStep * 30).toFixed(2),
          net: +Math.hypot(a.x - p0.x, a.y - p0.y).toFixed(2),
          netX: +(a.x - p0.x).toFixed(2),
          d0: +Math.hypot(p0.x - b.x, p0.y - b.y).toFixed(2),
          d1: +Math.hypot(a.x - b.x, a.y - b.y).toFixed(2),
          final: { x: +a.x.toFixed(1), y: +a.y.toFixed(1), hp: +a.health.toFixed(1), shield: +a.shield.toFixed(1) },
          stops: w.ramImpacts.motionStops - s0,
          impacts: w.ramImpacts.impacts - i0,
          hpDrop: { a: +(hp0.a - (a.health + a.shield)).toFixed(2), b: +(hp0.b - (b.health + b.shield)).toFixed(2) },
          tagged: dmgLog.slice(d0).filter(x => x.k === 'A' || x.k === 'B'),
          samples
        };
        b.x = origB.x;
        b.y = origB.y;
        b.z = origB.z;
        b.heading = origB.h;
        b.scriptHidden = origB.hidden;
        b.syncObj?.();
        return out;
      };
      const block = step({ block: true, ticks: TICKS });
      const free = step({ block: false, ticks: TICKS });
      const overpass = step({ block: true, overhead: true, ticks: TICKS });

      // Park the approach pair far from the overlap point (the free run leaves
      // the mover at cruise), so only the two stationary hulls are involved.
      a.speed = 0;
      a.direct.throttle = 0;
      a.x = w.min.x + 1;
      a.y = w.min.y + 1;
      a.syncObj?.();
      b.x = w.max.x - 1;
      b.y = w.max.y - 1;
      b.speed = 0;
      b.direct.throttle = 0;
      b.syncObj?.();

      // Stationary overlap control (allied hulls, both stopped).
      place(c, ext.x, ext.y, 0, 0);
      place(d, ext.x, ext.y, 0, 0);
      const oS = w.ramImpacts.motionStops,
        oI = w.ramImpacts.impacts,
        oD = dmgLog.length,
        oHp = { c: c.health + c.shield, d: d.health + d.shield };
      for (let i = 0; i < 60; i++) {
        c.direct.throttle = 0;
        d.direct.throttle = 0;
        c.target = null;
        d.target = null;
        w.update(1 / 30);
      }
      const overlap = {
        distance: +Math.hypot(c.x - d.x, c.y - d.y).toFixed(2),
        stops: w.ramImpacts.motionStops - oS,
        impacts: w.ramImpacts.impacts - oI,
        hpDrop: { c: +(oHp.c - (c.health + c.shield)).toFixed(2), d: +(oHp.d - (d.health + d.shield)).toFixed(2) },
        tagged: dmgLog.slice(oD).filter(x => x.k === 'C' || x.k === 'D')
      };

      return {
        throttle: THROTTLE,
        ships: {
          mover: { type: a.type.name, r: rA, maxSpeed: a.maxSpeed },
          blocker: { type: b.type.name, r: rB, maxSpeed: b.maxSpeed },
          allied: a.player.team === b.player.team
        },
        gap: +gap.toFixed(2),
        eligibility,
        block,
        free,
        overlap,
        overpass,
        stations: w.units.filter(u => u.isStation && !u.dead).length,
        counters: { motionStops: w.ramImpacts.motionStops, impacts: w.ramImpacts.impacts },
        status: {
          mode: g.setup?.mode,
          type: g.setup?.type,
          paused: !!g.paused,
          time: +w.time.toFixed(2),
          alive: w.units.filter(u => !u.dead).length,
          winner: !!w.winner
        },
        otherDamage: dmgLog.filter(x => !'ABCD'.includes(x.k)).length
      };
    });
    record('space.run', run);
    assert.ok(!run.error, `space fixture could not be prepared: ${JSON.stringify(run)}`);
    assert.equal(run.ships.allied, true, 'the space pair must be allied so weapons cannot confound HP');

    const b = run.block,
      f = run.free;
    assert.ok(
      b.measuredSpeed < b.threshold,
      `space approach must be genuinely slow (measured ${b.measuredSpeed}, threshold ${b.threshold})`
    );
    assert.ok(b.verticalGap < 0.1, `expected aligned hull centers; gap ${b.verticalGap}`);
    assert.ok(run.overpass.verticalGap > run.ships.mover.r + run.ships.blocker.r);
    assert.equal(run.overpass.stops, 0);
    assert.equal(run.overpass.impacts, 0);
    assert.deepEqual(run.overpass.tagged, []);
    assert.ok(Math.abs(run.overpass.net - f.net) < 0.1, 'an overflight should travel as far as an empty lane');
    assert.ok(b.stops >= 1, `space: the low-throttle approach must count motionStops (saw ${b.stops})`);
    assert.equal(b.impacts, 0, 'space: a below-threshold approach must not count a damaging ram');
    assert.deepEqual(b.tagged, [], 'space: the low-throttle approach must not call damage() on either hull');
    assert.ok(b.hpDrop.a <= 0.001 && b.hpDrop.b <= 0.001, `space: neither hull may lose HP, saw ${JSON.stringify(b.hpDrop)}`);
    assert.ok(
      b.net <= f.net * 0.75 && b.net <= f.net - 20,
      `space: actual displacement must be curtailed (block ${b.net} vs free ${f.net})`
    );
    assert.ok(b.netX < b.d0, `space: mover must not cross the blocker (netX ${b.netX}, initial separation ${b.d0})`);
    assert.ok(f.net >= 40, `space: free lane must allow progress (free net ${f.net})`);
    assert.equal(f.stops, 0, `space: a free lane must not count a motion stop (saw ${f.stops})`);
    assert.equal(f.impacts, 0, 'space: a free lane must not count a ram');
    assert.deepEqual(f.tagged, [], 'space: a free lane must not damage either hull');
    assert.ok(f.hpDrop.a <= 0.001 && f.hpDrop.b <= 0.001, 'space: free lane HP must be unchanged');

    const o = run.overlap;
    assert.ok(o.distance <= 1, `space stationary overlap must stay overlapped (distance ${o.distance})`);
    assert.equal(o.stops, 0, `space stationary overlap must not count a motion stop (saw ${o.stops})`);
    assert.equal(o.impacts, 0, 'space stationary overlap must not count a ram');
    assert.deepEqual(o.tagged, [], 'space stationary overlap must not damage either hull');
    assert.ok(o.hpDrop.c <= 0.001 && o.hpDrop.d <= 0.001, 'space stationary overlap must not lose HP');

    assert.equal(run.status.mode, 'space', 'game mode must stay normal');
    assert.ok(run.status.time > 0, 'world time must advance');
    assert.ok(run.status.alive >= 4, `most units must stay alive (${run.status.alive})`);
    assert.equal(run.status.winner, false, 'the movement test must not end the game');
    assert.deepEqual(errors, [], 'no page errors during the space leg');

    record('space.verdict', {
      pass: true,
      space:
        'low-throttle ship into a stationary solid ship: curtailed, motionStops counted, 0 impacts, 0 HP loss; free lane progresses; overlap preserved',
      stationsInFixture: run.stations
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
  console.log('\nMOVEMENT AUTHORITY: PASS');
  console.log(JSON.stringify({ verdict: 'pass', legs: want, base: BASE }, null, 2));
})().catch(e => {
  console.error('\nMOVEMENT AUTHORITY: FAIL');
  console.error(e && e.message);
  if (e && e.actual !== undefined) console.error('actual:', JSON.stringify(e.actual), 'expected:', JSON.stringify(e.expected));
  console.error(`Rerun: npm run test:physics-movement (mounted Universal at ${BASE})`);
  process.exit(1);
});
