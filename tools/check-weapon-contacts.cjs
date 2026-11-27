// Mounted acceptance for the solo weapon-cast authority (world.weaponCasts):
// a real shot, advanced by the real land/space shot update, decided by the real
// narrow phase, damages an armed real target - and a shot offset by half a unit
// past the hull edge misses with no damage at all.
//
//   npm run test:physics-weapons           # both domains and the changed outcome
//   npm run test:physics-weapons -- --land # or --space to isolate a domain
//
// Needs the mounted Universal window at http://127.0.0.1:8590/ (EW_BASE overrides).
// The outer Universal page is opened by hash; this script never navigates to
// play.html itself.
//
// Rules of engagement:
//   * The test never applies damage. It arranges positions, fires through the
//     world's own fire/launch path, and wraps hurt()/damage() to observe.
//   * Centre and edge shots are placed on measured parallel lines. In space
//     the test disables torpedo homing so a miss can't steer back into a hit.
//   * The optional box-vs-triangles comparison puts stock bomber collision
//     geometry on the same target pose and restores the model and authority.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const BASE = process.env.EW_BASE || 'http://127.0.0.1:8590/';
const PAGE = { timeout: 200000 };
const STEPS = 240;

// Cycle-safe dump: the mounted world is full of back-references.
function dump(value) {
  const seen = new WeakSet();
  return JSON.stringify(
    value,
    (k, v) => {
      if (typeof v === 'function') return `[fn ${v.name || ''}]`;
      if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      return v;
    },
    2
  );
}
const log = (name, value) => console.log(`\n[${name}]`, dump(value));

async function launch() {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { browser, page, errors };
}

// The battle lives in the mounted #game frame. Wait for the frame that owns a
// canvas - never open play.html directly.
async function gameFrame(page, match) {
  const until = Date.now() + PAGE.timeout;
  for (;;) {
    const f = page.frames().find(f => f !== page.mainFrame() && f.url().includes('play.html') && (!match || f.url().includes(match)));
    if (f) {
      try {
        if (await f.evaluate(() => !!document.querySelector('canvas'))) return f;
      } catch {}
    }
    if (Date.now() > until) throw Error('mounted Universal frame did not start');
    await new Promise(r => setTimeout(r, 250));
  }
}

async function boot(frame) {
  await frame.locator('#loading.hidden').waitFor({ state: 'attached', timeout: PAGE.timeout });
  await frame.waitForFunction(() => window.game?.world?.units?.length > 0, null, { timeout: PAGE.timeout });
  return frame.evaluate(async () => {
    const t0 = performance.now();
    while ((!window.game?.world?.weaponCasts || game.warming) && performance.now() - t0 < 70000) await new Promise(r => setTimeout(r, 100));
    const g = game,
      w = g.world;
    return {
      mode: g.setup?.mode,
      type: g.setup?.type,
      net: !!g.setup?.net,
      replay: !!g.setup?.replay,
      worker: !!g.workerMode,
      physicsRule: w.battlePhysicsRule,
      authority: w.weaponCasts === undefined ? 'absent' : { enabled: w.weaponCasts.enabled, stats: w.weaponCasts.stats?.() },
      units: w.units.length
    };
  });
}

function assertAuthority(b, where) {
  assert.ok(
    b.authority !== 'absent' && b.authority.enabled,
    `BLOCKER: the mounted ${where} world does not install an enabled world.weaponCasts; the weapon-cast authority is not live in this checkout`
  );
}

// ---------------------------------------------------------------------------
// Land: stock ground-offensive opening battle, mounted.
// ---------------------------------------------------------------------------
async function land() {
  const { browser, page, errors } = await launch();
  try {
    await page.goto(BASE + '#ground-offensive');
    const frame = await gameFrame(page);
    const b = await boot(frame);
    log('land.boot', b);
    assert.equal(b.mode, 'land');
    assert.equal(b.net, false, 'the land leg must be a live solo session');
    assert.equal(b.replay, false, 'the land leg must not be a replay');
    assertAuthority(b, 'land');
    assert.equal(b.physicsRule, 1, 'a live solo land battle must record the battle-physics rule');

    const setup = await frame.evaluate(async () => {
      const g = game,
        w = g.world,
        { CELL } = await import('/js/game/terrain.js');
      const { categoryOf, CAT } = await import('/js/game/projflight.js');
      g.paused = true;
      w.aiSuspended = true; // real muzzle AI off: the only damage here is ours
      const span = w.terrain.size * CELL;
      // A straight-line projectile only: the shot is placed on a measured line, so
      // it must not home or lob.
      const straight = u => u.weapon && [CAT.DEFAULT, CAT.LASER].includes(categoryOf(u.weapon.proj)) && u.weapon.speed > 0;
      const live = w.units.filter(
        u =>
          !u.dead &&
          !u.structure &&
          !u.inside &&
          !u.foot &&
          u.health > 0 &&
          u.side >= 0 &&
          u.kind !== 'INFANTRY' &&
          (u.guns?.length || u.weapon) &&
          (u.type.collidable ??= u.type.bool('Collidable_By_Projectile_Living', false))
      );
      for (const u of w.units) {
        if (u.dead) continue;
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
      w.shots.length = 0;
      const target = live.find(u => u.side === 1 && (u.shield || 0) === 0) || live.find(u => u.side === 1) || live[0];
      const shooter = live.find(u => u !== target && !w.ally(u.side, target.side) && straight(u));
      if (!target || !shooter) return { error: 'no armed hostile pair', live: live.length };
      let spot = null;
      for (let gy = 0.15; gy <= 0.86 && !spot; gy += 0.05)
        for (let gx = 0.15; gx <= 0.86 && !spot; gx += 0.05) {
          const x = gx * span,
            y = gy * span;
          if (!w.isOpen(x, y, 6)) continue;
          if (w.units.some(u => u !== target && !u.dead && Math.hypot(u.x - x, u.y - y) < 220)) continue;
          spot = { x, y };
        }
      if (!spot) return { error: 'no open ground for the target' };

      const pin = () => {
        target.x = spot.x;
        target.y = spot.y;
        target.z = w.groundZ(spot.x, spot.y) + (target.lift || 0) + (target.hoverZ || 0);
        target.heading = 0;
        target.mv = 0;
        target.path = [];
        target.target = null;
        if (target.squad) {
          target.squad.foe = null;
          target.squad.post = null;
          target.squad.march = null;
        }
        target.holder.position.set(target.x, target.y, target.z);
        target.holder.rotation.z = target.heading + Math.PI / 2;
        target.holder.updateMatrixWorld(true);
        if (!w.meshOf(target)) throw Error('target reaches no land collision mesh');
      };

      // Observation only: record every hurt() call. Land's signature is
      // hurt(unit, amount, from, how, projectile, source), and our tagged shot
      // arrives as `source`.
      const hurt = w.hurt.bind(w);
      const rec = { hurt: [] };
      w.hurt = (u, amount, from, how, shot, src) => {
        rec.hurt.push({
          key: u === target ? 'TARGET' : `u${u?.side}:${u?.type?.name}`,
          amount,
          tag: (src && src.__tag) || (shot && shot.__tag) || null,
          projectile: shot?.name || null,
          from: from && (from === shooter ? 'SHOOTER' : `u${from.side}:${from.type?.name}`),
          t: +w.time.toFixed(3)
        });
        return hurt(u, amount, from, how, shot, src);
      };

      // The same world-space segment answered by both real land narrow phases:
      // authority on -> authored-triangle Rapier cast, authority off -> the
      // legacy box-first meshHit(). The flag is always restored.
      const decide = (u, x0, y0, z0, x1, y1, z1) => {
        const was = w.weaponCasts.enabled;
        const out = {};
        try {
          w.weaponCasts.enabled = true;
          out.native = w.meshStrike(u, x0, y0, z0, x1, y1, z1);
          w.weaponCasts.enabled = false;
          out.legacy = w.meshStrike(u, x0, y0, z0, x1, y1, z1);
        } finally {
          w.weaponCasts.enabled = was;
        }
        return out;
      };

      // Measure the target's own hull: find a line along +x that strikes the
      // authored hull, then the nearest half-unit nudge that misses it. All of it
      // through world.meshStrike, at the pose the unit is in right now.
      const lines = u => {
        const h = u.holder.position,
          lo = u.collLo ?? 0,
          hi = u.collHi ?? 10,
          R = Math.max(u.collR || 0, u.hitRadius || 0, 5),
          reach = Math.max(120, R * 4),
          at = (off, z) => decide(u, h.x - reach, h.y + off, z, h.x + reach, h.y + off, z);
        let hit = null,
          probes = 0;
        for (let zi = 0; zi <= 8 && !hit; zi++) {
          const z = h.z + lo + (hi - lo) * (0.12 + (0.76 * zi) / 8);
          for (let k = 0; k <= 16 && !hit; k++)
            for (const sgn of k === 0 ? [1] : [1, -1]) {
              const off = ((sgn * k) / 16) * R,
                p = at(off, z);
              probes++;
              if (p.native >= 0) {
                hit = { off: +off.toFixed(3), z, ...p };
                break;
              }
            }
        }
        if (!hit) return null;
        let miss = null;
        for (let k = 1; k <= 80 && !miss; k++)
          for (const sgn of [1, -1]) {
            const off = hit.off + (sgn * k) / 2,
              p = at(off, hit.z);
            if (p.native < 0) {
              miss = { off: +off.toFixed(3), z: hit.z, ...p };
              break;
            }
          }
        if (!miss) return null;
        const step = Math.sign(miss.off - hit.off) / 2,
          back = at(miss.off - step, hit.z);
        const seg = l => ({ x0: h.x - reach, y0: h.y + l.off, z0: l.z, x1: h.x + reach, y1: h.y + l.off, z1: l.z });
        return {
          hull: {
            collR: +u.collR.toFixed(2),
            collLo: +lo.toFixed(2),
            collHi: +hi.toFixed(2),
            triangles: w.hullOf(u)?.T?.length / 9 || 0,
            reach
          },
          probes,
          hit: { ...hit, seg: seg(hit) },
          miss: { ...miss, seg: seg(miss) },
          edge: { step, backNative: back.native, backLegacy: back.legacy }
        };
      };

      pin();
      w.update(1 / 30);
      pin();
      const measured = lines(target);
      Object.assign(w, { __wc: { rec, decide, lines, pin, target, shooter } });
      return {
        target: {
          type: target.type.name,
          side: target.side,
          kind: target.kind,
          health: target.health,
          maxHealth: target.maxHealth,
          shield: target.shield,
          weapons: target.weapons?.length ?? 0,
          guns: target.guns?.length ?? 0,
          weapon: target.weapon?.proj?.name || null,
          armed: !!(target.guns?.length || target.weapon)
        },
        shooter: { type: shooter.type.name, side: shooter.side, weapon: shooter.weapon?.proj?.name || null },
        spot,
        casts: w.weaponCasts.stats(),
        measured: measured && {
          hull: measured.hull,
          probes: measured.probes,
          hit: { off: measured.hit.off, z: +measured.hit.z.toFixed(2), native: measured.hit.native, legacy: measured.hit.legacy },
          miss: { off: measured.miss.off, native: measured.miss.native, legacy: measured.miss.legacy },
          edge: measured.edge
        }
      };
    });
    log('land.setup', setup);
    assert.ok(!setup.error, `land fixture could not be prepared: ${setup.error}`);
    assert.ok(setup.target.armed, 'the land target must be a real armed unit');
    assert.ok(
      setup.target.weapons >= 1 || setup.target.guns >= 1,
      `the land target must be able to fire back (weapons ${setup.target.weapons}, guns ${setup.target.guns})`
    );
    assert.ok(setup.measured, 'the land fixture must find a hull line and an offset miss');
    assert.ok(setup.measured.hull.triangles > 0, 'the land target must reach the native hull query');
    assert.ok(setup.measured.hit.native >= 0, 'the chosen line must strike the authored hull');
    assert.equal(setup.measured.miss.native, -1, 'the offset line must cleanly miss the authored hull');
    assert.ok(setup.measured.edge.backNative >= 0, 'half a unit back along the same line must strike again');

    // Fire and step: World.fire() builds the projectile, World.update advances it.
    async function runShot(tag) {
      return frame.evaluate(
        async ({ tag, steps }) => {
          const w = game.world,
            st = w.__wc,
            T = st.target;
          if (!T || T.dead) throw Error('target vanished');
          const A = w.units.find(u => u.type.name === st.shooter.type.name && u !== T);
          if (!A) throw Error('attacker vanished');
          // Settle the arranged pose, then measure the hull where it stands now.
          for (let i = 0; i < 2; i++) {
            st.pin();
            w.update(1 / 30);
          }
          st.pin();
          const L = st.lines(T);
          if (!L) throw Error('no hull line for the target');
          const line = tag === 'HIT' ? L.hit : L.miss,
            seg = line.seg;
          const baseZ = T.holder.position.z,
            baseY = T.holder.position.y,
            baseX = T.holder.position.x;
          const before = {
            health: T.health,
            shield: T.shield || 0,
            misses: w.misses || 0,
            hurt: st.rec.hurt.length,
            casts: w.weaponCasts.stats()
          };
          const n = w.shots.length;
          A.x = baseX + 900;
          A.y = baseY + 900;
          w.fire(A, T, A.weapon);
          const s = w.shots[n];
          if (!s) throw Error('world.fire produced no shot');
          const dx = seg.x1 - seg.x0,
            dy = seg.y1 - seg.y0,
            dz = seg.z1 - seg.z0,
            len = Math.hypot(dx, dy, dz) || 1;
          s.x = s.sx = seg.x0;
          s.y = s.sy = seg.y0;
          s.z = s.sz = seg.z0;
          s.vx = (dx / len) * s.speed;
          s.vy = (dy / len) * s.speed;
          s.vz = (dz / len) * s.speed;
          s.aimX = seg.x1;
          s.aimY = seg.y1;
          s.aimZ = seg.z1;
          s.total = s.left = s.reach = len * 1.6;
          s.age = 0;
          s.flown = 0;
          s.path = null;
          s.ox = s.oy = s.oz = 0;
          s.dud = false;
          s.__tag = tag;
          const trace = [];
          let closest = Infinity;
          for (let i = 0; i < steps && !s.done; i++) {
            st.pin();
            w.update(1 / 30);
            const d = Math.hypot(s.x - T.holder.position.x, s.y - T.holder.position.y, s.z - T.holder.position.z);
            if (d < closest) closest = d;
            if (i % 10 === 0 || s.done) trace.push({ i, x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1), d: +d.toFixed(1) });
          }
          return {
            tag,
            line: {
              from: { x: +seg.x0.toFixed(2), y: +seg.y0.toFixed(2), z: +seg.z0.toFixed(2) },
              to: { x: +seg.x1.toFixed(2), y: +seg.y1.toFixed(2), z: +seg.z1.toFixed(2) },
              offset: line.off,
              native: line.native,
              legacy: line.legacy,
              hull: L.hull,
              edge: L.edge
            },
            shot: {
              done: !!s.done,
              expired: !!s.expired,
              struck: s.struck === T ? 'TARGET' : s.struck ? `u${s.struck.side}:${s.struck.type?.name}` : null,
              damage: s.damage,
              projectile: s.w.proj.name,
              cat: s.cat,
              speed: s.speed,
              flown: +s.flown.toFixed(1)
            },
            closest: +closest.toFixed(2),
            trace,
            after: {
              health: +T.health.toFixed(3),
              shield: +(T.shield || 0).toFixed(3),
              misses: (w.misses || 0) - before.misses,
              queries: w.weaponCasts.stats().queries - before.casts.queries,
              hulls: w.weaponCasts.stats().hulls - before.casts.hulls
            },
            before: { health: +before.health.toFixed(3), shield: +(before.shield || 0).toFixed(3) },
            hurt: st.rec.hurt.slice(before.hurt)
          };
        },
        { tag, steps: STEPS }
      );
    }

    const hit = await runShot('HIT');
    log('land.hit', hit);
    assert.ok(hit.line.native >= 0, 'the hit line must strike the authored hull');
    assert.equal(hit.shot.struck, 'TARGET', 'a real shot on the hull line must strike the target');
    assert.ok(hit.shot.done && !hit.shot.expired, 'a strike must end the shot, not expiry');
    assert.ok(hit.closest <= hit.line.hull.collR + 1, 'the shot must actually reach the target hull');
    assert.ok(hit.after.queries > 0, 'the native weapon cast must answer the strike');
    const hitDamage = hit.hurt.filter(h => h.key === 'TARGET' && h.tag === 'HIT');
    assert.equal(hitDamage.length, 1, `exactly one real damage call for the target, saw ${JSON.stringify(hit.hurt)}`);
    assert.ok(hitDamage[0].amount > 0, 'real damage must be positive');
    const hitDrop = hit.before.health + hit.before.shield - (hit.after.health + hit.after.shield);
    assert.ok(hitDrop > 0, `the target must lose health through the real damage path, delta ${hitDrop}`);
    assert.ok(
      Math.abs(hitDrop - hitDamage[0].amount) < Math.max(1e-6, hitDamage[0].amount * 1e-6),
      `the recorded damage ${hitDamage[0].amount} must be the health actually removed (${hitDrop})`
    );

    const miss = await runShot('MISS');
    log('land.miss', miss);
    assert.equal(miss.line.native, -1, 'the offset line must miss the authored hull');
    assert.ok(miss.line.edge.backNative >= 0, 'half a unit back on the same line must still strike the hull');
    assert.equal(miss.shot.struck, null, 'the offset shot must not strike the target');
    assert.deepEqual(
      miss.hurt.filter(h => h.key === 'TARGET'),
      [],
      'the offset shot must cause no damage at all'
    );
    assert.equal(miss.after.health, miss.before.health, 'target health must be untouched by the miss');
    assert.equal(miss.after.shield, miss.before.shield, 'target shield must be untouched by the miss');
    assert.ok(miss.closest <= miss.line.hull.collR + 1, `the miss must pass the target's broadphase, closest ${miss.closest}`);
    assert.ok(miss.after.queries > 0, 'the native weapon cast must be asked during the miss too');
    assert.ok(
      Math.abs(miss.line.offset - hit.line.offset) <= miss.line.hull.collR,
      `the miss must be a slight offset within one hull radius, saw ${miss.line.offset} vs ${hit.line.offset}`
    );
    assert.deepEqual(errors, [], 'no page errors during the land leg');

    // ---------------------------------------------------------------------
    // Changed outcome: for every stock land unit in this battle, does the
    // authored hull the authority uses differ from the box land's legacy
    // meshOf() picks first?
    // ---------------------------------------------------------------------
    const stock = await frame.evaluate(async () => {
      const w = game.world,
        { collisionBoxOf } = await import('/js/game/collmesh.js');
      const rows = [];
      for (const u of w.units) {
        if (u.dead || !u.inst?.model || rows.some(r => r.type === u.type.name)) continue;
        const legacy = w.meshOf(u);
        if (!legacy) continue;
        const box = collisionBoxOf(u.inst.model),
          hull = w.hullOf(u);
        rows.push({
          type: u.type.name,
          authoredBox: !!box,
          legacyTriangles: legacy.T.length / 9,
          authorityTriangles: hull ? hull.T.length / 9 : 0,
          sameGeometry:
            legacy === hull ||
            (!!legacy && !!hull && legacy.T.length === hull.T.length && legacy.T.every((v, i) => Math.abs(v - hull.T[i]) < 1e-4))
        });
      }
      return rows.sort((a, b) => a.type.localeCompare(b.type));
    });
    log('land.stockHulls', stock);
    assert.ok(stock.length >= 5, 'the fixture must contain stock units with collision geometry');
    // Inventory only: an updated roster is allowed to include units for which
    // the new rules legitimately choose a more precise hull.

    // Stock examples of authored boxes with and without an additional precise hull.
    const diverge = await frame.evaluate(async () => {
      const w = game.world,
        { loadModel } = await import('/js/model.js'),
        { projectileHullOf, collisionBoxOf, meshHit } = await import('/js/game/collmesh.js');
      const out = [];
      for (const name of ['EV_TIEBOMBER.ALO', 'RV_Z-95.ALO', 'EV_TIEADVANCED.ALO', 'NI_HUTT.ALO']) {
        const built = await loadModel(name);
        if (!built || !built.model) {
          out.push({ model: name, error: 'model did not load' });
          continue;
        }
        const native = projectileHullOf(built.model),
          box = collisionBoxOf(built.model),
          legacy = box || native;
        if (!native || !legacy) {
          out.push({ model: name, boxOnly: !!box && !native });
          continue;
        }
        const b = legacy.box.slice(0, 6),
          h = native.box.slice(0, 6),
          lo = [Math.min(b[0], h[0]), Math.min(b[1], h[1]), Math.min(b[2], h[2])],
          hi = [Math.max(b[3], h[3]), Math.max(b[4], h[4]), Math.max(b[5], h[5])];
        let found = null;
        for (let zi = 0; zi <= 20 && !found; zi++)
          for (let ki = 0; ki <= 20 && !found; ki++) {
            const y = lo[1] + ((hi[1] - lo[1]) * (ki + 0.5)) / 21,
              z = lo[2] + ((hi[2] - lo[2]) * (zi + 0.5)) / 21,
              x0 = lo[0] - 8,
              x1 = hi[0] + 8;
            const lt = meshHit(legacy, x0, y, z, x1 - x0, 0, 0),
              nt = w.weaponCasts.segment(native, x0, y, z, x1, y, z);
            if (lt >= 0 !== nt >= 0)
              found = {
                y: +y.toFixed(2),
                z: +z.toFixed(2),
                legacy: +lt.toFixed(4),
                native: nt,
                legacyMisses: lt < 0,
                authorityMisses: nt < 0
              };
          }
        out.push({
          model: name,
          authorityHullTriangles: native.T.length / 9,
          legacyHullTriangles: legacy.T.length / 9,
          legacyIsAuthoredBox: !!box,
          legacyBox: box ? Array.from(b).map(v => +v.toFixed(2)) : null,
          authorityBox: Array.from(h).map(v => +v.toFixed(2)),
          changedOutcome: found
        });
      }
      return out;
    });
    log('land.divergence', diverge);
    const bomber = diverge.find(d => d.model === 'EV_TIEBOMBER.ALO');
    assert.ok(
      bomber && bomber.changedOutcome,
      'the stock TIE bomber model must show an authored box that disagrees with its authored hull'
    );
    const hutt = diverge.find(d => d.model === 'NI_HUTT.ALO');
    assert.ok(hutt?.boxOnly, 'a model whose only collision mesh is the COLLISIONBOX must author no separate hull');

    // Live flip: put a stock land model that authors both a COLLISIONBOX and
    // authored triangles on the real target's pose, then fire the same shot twice
    // through the real World.update - once with the authority's hull deciding, once
    // with land's legacy box deciding. Real damage in both runs; only the geometry
    // differs.
    let flip = null;
    if (process.argv.includes('--divergence')) {
      // TIE_BOMBER_BOMBING_RUN uses this stock land model.
      flip = await frame.evaluate(async model => {
        const w = game.world,
          st = w.__wc,
          T = st.target,
          { loadModel } = await import('/js/model.js'),
          { projectileHullOf, collisionBoxOf } = await import('/js/game/collmesh.js');
        const built = await loadModel(model);
        const original = T.inst.model,
          wasEnabled = w.weaponCasts.enabled;
        const out = { runs: [] };
        try {
          T.inst.model = built.model;
          T.collModel = T.collT = T.hullModel = T.hull = undefined;
          st.pin();
          w.meshOf(T);
          w.weaponCasts.enabled = true;
          const hull = projectileHullOf(T.inst.model),
            box = collisionBoxOf(T.inst.model),
            legacyMesh = box || hull;
          out.model = {
            authorityHullTriangles: hull ? hull.T.length / 9 : 0,
            legacyHullTriangles: legacyMesh ? legacyMesh.T.length / 9 : 0,
            legacyIsAuthoredBox: !!box,
            worldTookTheSwap: w.hullOf(T) === hull && T.coll === legacyMesh,
            bounds: {
              collR: +T.collR.toFixed(2),
              shotR: +(T.shotR === undefined ? -1 : T.shotR).toFixed(2),
              collLo: +T.collLo.toFixed(2),
              collHi: +T.collHi.toFixed(2),
              shotLo: +(T.shotLo === undefined ? -1 : T.shotLo).toFixed(2),
              shotHi: +(T.shotHi === undefined ? -1 : T.shotHi).toFixed(2)
            }
          };
          if (w.hullOf(T) !== hull) return { ...out, error: 'the world did not adopt the swapped model' };
          // A line that strikes the legacy COLLISIONBOX and misses the authority
          // hull. The stock bomber authors its LOD geometry as collision, and that
          // hull sits well inside the coarse authored box, so a shot clipping the
          // box corner is a hit under the old land bounding box and a miss under
          // the authored triangles.
          const h = T.holder.position,
            R = Math.max(T.collR || 0, T.shotR || 0, 30) * 1.6,
            lo = Math.min(T.collLo === undefined ? 0 : T.collLo, T.shotLo === undefined ? 0 : T.shotLo) - 10,
            hi = Math.max(T.collHi === undefined ? 20 : T.collHi, T.shotHi === undefined ? 20 : T.shotHi) + 10;
          let pick = null;
          const stats = { probes: 0, legacyHit: 0, nativeHit: 0 };
          for (let dir = 0; dir <= 1 && !pick; dir++)
            for (let zi = 0; zi <= 14 && !pick; zi++)
              for (let k = 0; k <= 48 && !pick; k++)
                for (const sgn of k === 0 ? [1] : [1, -1]) {
                  const off = (sgn * k * R) / 48,
                    z = h.z + lo + ((hi - lo) * (zi + 0.5)) / 15,
                    seg =
                      dir === 0
                        ? { x0: h.x - R, y0: h.y + off, z0: z, x1: h.x + R, y1: h.y + off, z1: z }
                        : { x0: h.x + off, y0: h.y - R, z0: z, x1: h.x + off, y1: h.y + R, z1: z },
                    d = st.decide(T, seg.x0, seg.y0, seg.z0, seg.x1, seg.y1, seg.z1);
                  stats.probes++;
                  if (d.legacy >= 0) stats.legacyHit++;
                  if (d.native >= 0) stats.nativeHit++;
                  if (d.native < 0 && d.legacy >= 0) pick = { dir, off, seg, ...d };
                }
          if (!pick) return { ...out, stats, error: 'no divergent line on the target pose' };
          out.line = {
            direction: pick.dir === 0 ? 'world +x' : 'world +y',
            from: { x: +pick.seg.x0.toFixed(2), y: +pick.seg.y0.toFixed(2), z: +pick.seg.z0.toFixed(2) },
            to: { x: +pick.seg.x1.toFixed(2), y: +pick.seg.y1.toFixed(2), z: +pick.seg.z1.toFixed(2) },
            authority: pick.native,
            legacy: pick.legacy,
            stats
          };
          for (const authority of [true, false]) {
            for (let i = 0; i < 2; i++) {
              st.pin();
              w.update(1 / 30);
            }
            st.pin();
            const A = w.units.find(u => u.type.name === st.shooter.type.name && u !== T);
            const before = {
              health: T.health,
              shield: T.shield || 0,
              hurt: st.rec.hurt.length,
              queries: w.weaponCasts.stats().queries
            };
            w.weaponCasts.enabled = authority;
            const n = w.shots.length;
            A.x = T.x + 900;
            A.y = T.y + 900;
            w.fire(A, T, A.weapon);
            const s = w.shots[n];
            if (!s) throw Error('world.fire produced no shot');
            const seg = pick.seg,
              dx = seg.x1 - seg.x0,
              dy = seg.y1 - seg.y0,
              len = Math.hypot(dx, dy, seg.z1 - seg.z0) || 1;
            s.x = s.sx = seg.x0;
            s.y = s.sy = seg.y0;
            s.z = s.sz = seg.z0;
            s.vx = (dx / len) * s.speed;
            s.vy = (dy / len) * s.speed;
            s.vz = ((seg.z1 - seg.z0) / len) * s.speed;
            s.aimX = seg.x1;
            s.aimY = seg.y1;
            s.aimZ = seg.z1;
            s.total = s.left = s.reach = len * 1.6;
            s.age = s.flown = 0;
            s.path = null;
            s.ox = s.oy = s.oz = 0;
            s.__tag = authority ? 'NATIVE' : 'LEGACY';
            for (let i = 0; i < 240 && !s.done; i++) {
              st.pin();
              w.update(1 / 30);
            }
            w.weaponCasts.enabled = wasEnabled;
            out.runs.push({
              authority,
              decidingHull: authority ? 'authority hull (authored triangles)' : 'legacy box (COLLISIONBOX)',
              struck: s.struck === T ? 'TARGET' : s.struck ? `u${s.struck.side}:${s.struck.type && s.struck.type.name}` : null,
              hurt: st.rec.hurt.slice(before.hurt),
              health: +T.health.toFixed(3),
              delta: +(before.health + before.shield - (T.health + (T.shield || 0))).toFixed(3),
              queries: w.weaponCasts.stats().queries - before.queries
            });
          }
        } finally {
          T.inst.model = original;
          T.collModel = T.collT = T.hullModel = T.hull = undefined;
          st.pin();
          w.meshOf(T);
          w.hullOf(T);
          w.weaponCasts.enabled = wasEnabled;
        }
        return out;
      }, 'EV_TIEBOMBER.ALO');
      log('land.divergenceFlip', flip);
      assert.ok(!flip.error, `changed-outcome flip could not run: ${flip.error}`);
      assert.equal(flip.model.worldTookTheSwap, true, 'the world must adopt the stock model under test');
      assert.ok(flip.line.legacy >= 0, 'the legacy land bounding box must call this line a hit');
      assert.equal(flip.line.authority, -1, 'the authored triangles must call the same line a miss');
      const nativeRun = flip.runs.find(r => r.authority),
        legacyRun = flip.runs.find(r => !r.authority);
      assert.equal(nativeRun.struck, null, 'the authority run must not strike the target');
      assert.equal(nativeRun.delta, 0, 'the authority run must do no damage');
      assert.equal(legacyRun.struck, 'TARGET', 'the legacy box run must strike the target');
      assert.ok(legacyRun.delta > 0, 'the legacy box run must do real damage');
    }

    log('land.verdict', {
      pass: true,
      chain: 'World.update -> flyShot -> meshStrike -> shotEnds -> hurt',
      hit: { struck: hit.shot.struck, damage: hit.hurt.filter(h => h.key === 'TARGET'), queries: hit.after.queries },
      miss: { struck: miss.shot.struck, damage: miss.hurt.filter(h => h.key === 'TARGET'), closest: miss.closest }
    });
    return { setup, hit, miss, stock, diverge, flip };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Space (bonus): mounted Universal instant battle, page-authoritative World.
// ---------------------------------------------------------------------------
async function space() {
  const { browser, page, errors } = await launch();
  try {
    await page.goto(BASE);
    let frame = await gameFrame(page);
    await frame.locator('.title-menu [data-id="TITLE_PLAY"]').waitFor({ timeout: PAGE.timeout });
    await page.locator('#game').evaluate(f => {
      const u = new URL(f.src);
      u.searchParams.set('nospaceworker', '');
      f.src = u.href;
    });
    frame = await gameFrame(page, 'nospaceworker');
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
    const b = await boot(frame);
    log('space.boot', b);
    assert.equal(b.mode, 'space');
    assert.equal(b.worker, false, 'the space leg needs the page-authoritative World');
    assert.equal(b.net, false);
    assert.equal(b.replay, false);
    assertAuthority(b, 'space');

    const setup = await frame.evaluate(async () => {
      const g = game,
        w = g.world,
        { directState } = await import('/js/game/sim.js');
      g.paused = true;
      for (let i = 0; i < 300 && w.units.filter(u => !u.hyper && !u.dead).length < 6; i++) w.update(1 / 30);
      const mob = w.units.filter(
        u => u.isMobile && !u.isPad && !u.isStation && !u.isFighter && !u.dead && !u.hyper && u.maxHealth > 0 && u.player
      );
      for (const u of mob) {
        u.target = null;
        u.speed = 0;
        u.direct = directState();
        u.direct.firing = false;
        u.direct.throttle = 0;
        u.setOrder?.({ kind: 'idle' });
        u.syncObj?.();
      }
      w.projectiles.length = 0;
      const viewer = w.viewer;
      const mine = mob.filter(u => u.player.team === viewer.team),
        foes = mob.filter(u => u.player.team !== viewer.team && u.player.id >= 0);
      const target = foes[0],
        shooter = mine[0];
      if (!target || !shooter) return { error: 'need one hostile hull per side', mine: mine.length, foes: foes.length };
      const spot = { x: (w.min.x + w.max.x) / 2, y: (w.min.y + w.max.y) / 2, z: 0 };
      const pin = () => {
        target.x = spot.x;
        target.y = spot.y;
        target.z = spot.z;
        target.heading = 0;
        target.speed = 0;
        target.direct = directState();
        target.direct.throttle = 0;
        target.direct.firing = false;
        target.target = null;
        target.setOrder?.({ kind: 'idle' });
        target.syncObj?.();
      };
      const decide = (x0, y0, z0, x1, y1, z1) => {
        const was = w.weaponCasts.enabled,
          out = {};
        try {
          w.weaponCasts.enabled = true;
          out.native = w.meshStep(target, x0, y0, z0, x1, y1, z1);
          w.weaponCasts.enabled = false;
          out.legacy = w.meshStep(target, x0, y0, z0, x1, y1, z1);
        } finally {
          w.weaponCasts.enabled = was;
        }
        return out;
      };
      const lines = () => {
        const R = Math.max(target.collR || 0, target.hitRadius || 0, target.hitA || 0, 10),
          reach = Math.max(3 * R, 300),
          h = { x: target.x, y: target.y, z: target.z },
          at = (off, z) => decide(h.x + reach, h.y + off, z, h.x - reach, h.y + off, z);
        let hit = null;
        for (let zi = 0; zi <= 6 && !hit; zi++) {
          const z = h.z + ((zi - 3) / 3) * Math.min(R, (target.hitB || R) * 0.4);
          for (let k = 0; k <= 20 && !hit; k++)
            for (const sgn of k === 0 ? [1] : [1, -1]) {
              const off = ((sgn * k) / 20) * R * 0.9,
                p = at(off, z);
              if (p.native >= 0) {
                hit = { off: +off.toFixed(2), z, ...p };
                break;
              }
            }
        }
        if (!hit) return null;
        let miss = null;
        for (let k = 1; k <= 90 && !miss; k++)
          for (const sgn of [1, -1]) {
            const off = hit.off + (sgn * k) / 2,
              p = at(off, hit.z);
            if (p.native < 0) {
              miss = { off: +off.toFixed(2), z: hit.z, ...p };
              break;
            }
          }
        if (!miss) return null;
        const seg = l => ({ x0: h.x + reach, y0: h.y + l.off, z0: l.z, x1: h.x - reach, y1: h.y + l.off, z1: l.z });
        return {
          hull: { collR: +R.toFixed(2), hitA: target.hitA, hitB: target.hitB, hitC: target.hitC, reach },
          hit: { ...hit, seg: seg(hit) },
          miss: { ...miss, seg: seg(miss) }
        };
      };
      pin();
      w.update(1 / 30);
      pin();
      // A straight-flying projectile: a homing torpedo would chase the target and
      // turn our carefully measured miss back into a hit.
      const { categoryOf, CAT } = await import('/js/game/projflight.js');
      const aims = p => p.hp && p.proj && [CAT.DEFAULT, CAT.LASER].includes(categoryOf(p.proj)) && p.proj.num('Max_Speed', 0) > 0;
      const straight = (target.hardpoints || []).find(aims);
      const hp = straight || (target.hardpoints || []).find(p => p.hp && p.proj) || (target.hardpoints || [])[0];
      if (!hp) return { error: 'the space target has no projectile hardpoint' };
      const rec = { damage: [] };
      const apply = w.damage.bind(w);
      const snap = t => ({
        health: t.health,
        shield: t.shield,
        dead: !!t.dead,
        hyper: !!t.hyper,
        invulnerable: !!t.invulnerable,
        limbo: !!t.limbo,
        damageTaken: t.mods && t.mods.damageTaken,
        defense: t.bonus && t.bonus.defense
      });
      const hpSnap = hp => (hp ? { name: hp.kind || hp.name || 'hardpoint', health: hp.health, shield: hp.shield, alive: hp.alive } : null);
      w.damage = (t, amount, opts = {}) => {
        const before = snap(t),
          hpBefore = hpSnap(opts.hp);
        const out = apply(t, amount, opts);
        rec.damage.push({
          key: t === target ? 'TARGET' : `u${t?.player?.id}:${t?.type?.name}`,
          amount,
          projectile: opts.proj ? opts.proj.name : null,
          type: opts.damageType,
          shields: opts.shields,
          hull: opts.hull,
          hp: { before: hpBefore, after: hpSnap(opts.hp) },
          before,
          after: snap(t)
        });
        return out;
      };
      const measured = lines();
      Object.assign(w, {
        __wc: {
          rec,
          lines,
          pin,
          target,
          shooter,
          hp,
          straight: !!straight,
          damageType: hp.proj.str('Projectile_Damage_Type') || 'Damage_Normal'
        }
      });
      // Plain values only: the mounted world is full of back-references.
      const num = v => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(4) : null),
        str = v => (typeof v === 'string' ? v : null);
      return {
        straightProjectile: straight === hp,
        target: {
          type: str(target.type && target.type.name),
          team: num(target.player && target.player.team),
          health: num(target.health),
          shield: num(target.shield),
          maxShield: num(target.maxShield)
        },
        shooter: { type: str(shooter.type && shooter.type.name) },
        hardpoint: str(hp.kind) || str(hp.name),
        projectile: str(hp.proj && hp.proj.name),
        measured: measured && {
          hull: {
            collR: num(measured.hull.collR),
            hitA: num(measured.hull.hitA),
            hitB: num(measured.hull.hitB),
            hitC: num(measured.hull.hitC),
            reach: num(measured.hull.reach)
          },
          hit: { off: num(measured.hit.off), z: num(measured.hit.z), native: num(measured.hit.native), legacy: num(measured.hit.legacy) },
          miss: { off: num(measured.miss.off), native: num(measured.miss.native), legacy: num(measured.miss.legacy) }
        }
      };
    });
    log('space.setup', setup);
    assert.ok(!setup.error, `space fixture could not be prepared: ${setup.error}`);
    assert.ok(setup.measured, 'the space fixture must find a hull line and an offset miss');
    assert.ok(setup.measured.hit.native >= 0, 'the chosen space line must strike the hull');
    assert.equal(setup.measured.miss.native, -1, 'the offset space line must miss the hull');

    async function runSpace(tag) {
      return frame.evaluate(
        async ({ tag, steps }) => {
          const w = game.world,
            st = w.__wc,
            T = st.target,
            S = st.shooter;
          for (let i = 0; i < 2; i++) {
            st.pin();
            w.update(1 / 30);
          }
          st.pin();
          const L = st.lines();
          if (!L) throw Error('no hull line for the space target');
          const line = tag === 'HIT' ? L.hit : L.miss,
            seg = line.seg;
          const before = {
            health: T.health,
            shield: T.shield,
            dmg: st.rec.damage.length,
            casts: w.weaponCasts.stats(),
            projectiles: w.projectiles.length
          };
          w.launch(st.hp.proj, S, T, null, seg.x0, seg.y0, seg.z0, st.damageType, 0, {
            forward: Math.PI,
            range: Math.abs(seg.x1 - seg.x0) * 1.5
          });
          const p = w.projectiles[w.projectiles.length - 1];
          if (!p) throw Error('world.launch produced no projectile');
          if (!st.straight) {
            // Fallback: this hull only carries homing torpedoes, so hold the seeded
            // projectile on the measured line instead of letting it turn.
            p.homing = false;
            p.target = null;
            p.scan = 0;
          }
          p.__tag = tag;
          const trace = [];
          let closest = Infinity;
          for (let i = 0; i < steps && w.projectiles.includes(p); i++) {
            st.pin();
            const d = Math.hypot(p.x - T.x, p.y - T.y, p.z - T.z);
            if (d < closest) closest = d;
            if (i % 10 === 0) trace.push({ i, x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), d: +d.toFixed(1) });
            w.update(1 / 30);
          }
          return {
            tag,
            line: {
              from: { x: +seg.x0.toFixed(2), y: +seg.y0.toFixed(2), z: +seg.z0.toFixed(2) },
              to: { x: +seg.x1.toFixed(2), y: +seg.y1.toFixed(2), z: +seg.z1.toFixed(2) },
              offset: line.off,
              native: line.native,
              legacy: line.legacy,
              hull: L.hull
            },
            closest: +closest.toFixed(2),
            spent: !w.projectiles.includes(p),
            trace,
            before: { health: +before.health.toFixed(3), shield: +before.shield.toFixed(3) },
            after: {
              health: +T.health.toFixed(3),
              shield: +T.shield.toFixed(3),
              queries: w.weaponCasts.stats().queries - before.casts.queries
            },
            damage: st.rec.damage.slice(before.dmg)
          };
        },
        // The slow torpedo can cross the target before 240 ticks but needs
        // more ticks to reach its authored expiry distance.
        { tag, steps: STEPS * 4 }
      );
    }

    const hit = await runSpace('HIT');
    log('space.hit', hit);
    const hitDamage = hit.damage.filter(d => d.key === 'TARGET');
    assert.equal(hitDamage.length, 1, `exactly one real damage call for the space target, saw ${dump(hit.damage)}`);
    assert.ok(hitDamage[0].amount > 0, 'the space hit damage must be positive');
    const d0 = hitDamage[0],
      unitDrop = d0.before.health + (d0.before.shield || 0) - (d0.after.health + (d0.after.shield || 0)),
      hpDrop =
        d0.hp.before && d0.hp.after
          ? d0.hp.before.health + (d0.hp.before.shield || 0) - (d0.hp.after.health + (d0.hp.after.shield || 0))
          : 0;
    assert.ok(
      unitDrop > 0 || hpDrop > 0,
      `the space target must lose shield, hull or hardpoint health through the real damage path (unit ${unitDrop}, hardpoint ${hpDrop})`
    );
    assert.ok(hit.after.queries > 0, 'the native weapon cast must answer the space strike');

    const miss = await runSpace('MISS');
    log('space.miss', miss);
    assert.ok(miss.spent && miss.after.queries > 0, 'the offset shot must run to completion through the native query');
    assert.deepEqual(
      miss.damage.filter(d => d.key === 'TARGET'),
      [],
      'the offset space shot must cause no damage'
    );
    assert.equal(miss.after.health, miss.before.health, 'the space miss must not touch health');
    assert.equal(miss.after.shield, miss.before.shield, 'the space miss must not touch shields');
    assert.ok(miss.closest <= miss.line.hull.collR + (miss.line.hull.hitA || 0), 'the space miss must pass the target');
    assert.deepEqual(errors, [], 'no page errors during the space leg');
    log('space.verdict', { pass: true, hit: hitDamage, miss: miss.damage });
    return { setup, hit, miss };
  } finally {
    await browser.close();
  }
}

(async () => {
  const legs = process.argv.includes('--land') ? ['land'] : process.argv.includes('--space') ? ['space'] : ['land', 'space'];
  for (const leg of legs) {
    console.log(`\n=== ${leg} ===`);
    await (leg === 'land' ? land() : space());
  }
  console.log('\nWEAPON CONTACTS: PASS');
})().catch(e => {
  console.error('\nWEAPON CONTACTS: FAIL', e && e.message);
  if (e && e.actual !== undefined) console.error('actual:', e.actual, 'expected:', e.expected);
  process.exit(1);
});
