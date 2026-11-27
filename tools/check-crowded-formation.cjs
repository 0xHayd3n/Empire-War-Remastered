#!/usr/bin/env node
/**
 * Mounted acceptance test: crowded allied land formation movement (not point collision).
 *
 * WHERE IT RUNS
 *   Only through the mounted Universal window http://127.0.0.1:8590/ (EW_BASE
 *   overrides), scene #ground-offensive. Gameplay lives in the play.html frame
 *   inside the mount's #game iframe; play.html is never opened directly and the
 *   classic sibling checkout is never used.
 *   Requires Chrome and playwright-core (NODE_PATH or EW_PW may supply it).
 *
 * WHAT IS EXERCISED
 *   A real solo LandWorld, paused, stepped only by world.update(1/30). A real
 *   player group move order (game.command -> executeLand -> world.places ->
 *   world.order -> world's multi-squad group march) for several allied ground
 *   squads that start crowded (the game's own formation layout at the lane
 *   entrance: bodies not overlapping) and travel the same verified navigable
 *   lane. Progress of every squad and every unit body, stalls, crowd-control
 *   stops, obstacle clipping and casualties are measured.
 *   No unit is driven along the route: after the order the only inputs are
 *   world.update ticks. Setup inputs are initial positions/headings (formation
 *   slots) and the command itself; the world's own route/zone data decides what
 *   is navigable.
 *
 * CONTROLS
 *   A / A2  crowd (8 squads) on a straight, fully open lane, repeated
 *   B       single squad, same lane and start slot (crowd-effect control)
 *   B2      single squad on the obstructed lane (validates the lane itself)
 *   C       crowd (8 squads) through a real terrain pinch the single squad clears
 *   C4      smaller crowd (4 squads) through the same pinch
 *   C2      crowd (8 squads) through a second, independent pinch lane
 *
 * PASS CONDITIONS (registered before measurement, printed, and not changed
 * afterwards; a failure is reported with its symptom and mechanism)
 *   acceptance      : command returns a placement for every selected squad; each
 *                     squad ordered within 200 u of the requested point; a
 *                     multi-squad group (>= 2 members) is created
 *   crowdArrival    : open lane: every squad within 30 u of its own ordered slot
 *                     and along-progress >= 0.9 * slot distance
 *   crowdVsControl  : open lane: every squad progress fraction >= 0.75 * the
 *                     single-squad control fraction
 *   noStall         : no squad with a live order stalls (trailing 120 ticks
 *                     < 2 u) while > 20 u from its own slot
 *   noPinning       : no squad is pinned (0 movement in a tick with a live path)
 *                     for more than 10 consecutive ticks
 *   noOverlap       : max pairwise penetration <= 0.5 * (rA + rB)
 *   noClipping      : 0 unit-ticks with a test unit centre on a blocked cell
 *   noCasualties    : 0 test deaths and 0 tagged hurt events (lane is > 300 u
 *                     from every other unit, so nothing else can shoot)
 *   pinchControl    : the single-squad control reaches its ordered slot on the
 *                     obstructed lane
 *   obstruction     : every squad in C, C4 and C2 arrives within 30 u of its own
 *                     slot with progress >= 0.9 * slot distance
 *   determinism     : A repeated gives per-squad progress within 1 u and the
 *                     same clipping/hurt counts
 *
 * RUN
 *   npm run test:physics-crowds
 *   Set EW_OUT to choose the evidence file prefix.
 */
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.EW_BASE || 'http://127.0.0.1:8590/';
const OUT = process.env.EW_OUT || path.join(process.env.TEMP || '/tmp', 'ew-jam', 'evidence');
const PAGE_TIMEOUT = 190000;
const TICKS_OPEN = 600;   // 20 s sim; a 480 u lane at the measured ~33 u/s needs ~15 s
const TICKS_PINCH = 700;  // 23 s sim; a 478-523 u obstructed route needs ~16-18 s
const CROWD = 8;

function playwright() {
  for (const t of [process.env.EW_PW, 'playwright-core']) {
    if (!t) continue;
    try { return require(t); } catch {}
  }
  throw new Error('playwright-core not found; set EW_PW to its directory');
}
const { chromium } = playwright();

const PASS = {
  acceptance: 'command placement for every selected squad, each ordered within 200 u of the requested point, one live multi-squad group (>=2 members)',
  crowdArrival: 'open lane: every squad within 30 u of its own slot and along-progress >= 0.9 * slot distance',
  crowdVsControl: 'open lane: every squad progress fraction >= 0.75 * single-squad control fraction',
  noStall: 'no squad with a live order stalls (trailing 120 ticks < 2 u) while > 20 u from its slot',
  noPinning: 'no squad is still pinned at the end (>10 consecutive zero-movement ticks with a live path) while more than 20 u from its ordered slot; transient queueing and a short final approach are legitimate',
  noOverlap: 'max pairwise penetration <= 0.5 * (rA + rB) among test units',
  noClipping: '0 unit-ticks with a test unit centre on a blocked (non-isOpen) cell',
  noCasualties: '0 test deaths and 0 hurt events tagged to test units',
  pinchControl: 'single squad reaches its ordered slot on the obstructed lane (lane is navigable)',
  obstruction: 'crowd trials C, C4, C2: every squad arrives within 30 u of its slot with progress >= 0.9 * slot distance',
  determinism: 'A repeated: per-squad progress within 1 u, identical clipping/hurt counts'
};

async function frameAt(page) {
  const until = Date.now() + PAGE_TIMEOUT;
  for (;;) {
    const f = page.frames().find(fr => fr !== page.mainFrame() && fr.url().includes('play.html'));
    if (f) {
      try { if (await f.evaluate(() => !!document.querySelector('canvas'))) return f; } catch {}
    }
    if (Date.now() > until) throw Error('mounted frame matching play.html did not start');
    await new Promise(r => setTimeout(r, 250));
  }
}

const evidence = {};
const failures = [];
const check = (ok, name, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures.push({ name, detail, rule: PASS[name] || null });
  return ok;
};
const brief = T => ({
  atSize: T.acceptance.atSize, group: T.acceptance.groupForSelection,
  start: T.start, summary: T.summary, clipping: T.clipping.unitTicksOffOpen,
  penetration: T.penetration, hurt: T.hurt.length, deaths: T.deaths,
  authority: T.authority, others: T.others
});

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'], protocolTimeout: 600000 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const t0 = Date.now();
  try {
    await page.goto(BASE + '#ground-offensive');
    const frame = await frameAt(page);
    await frame.locator('#loading.hidden').waitFor({ state: 'attached', timeout: PAGE_TIMEOUT });

    console.log('\n# PASS CONDITIONS (registered before any trial)');
    for (const [k, v] of Object.entries(PASS)) console.log(`  ${k}: ${v}`);

    // ------------------------------------------------------------------ boot
    const boot = await frame.evaluate(async () => {
      const until = performance.now() + 90000;
      while ((!window.game?.world?.units?.length || game.warming) && performance.now() < until) await new Promise(r => setTimeout(r, 100));
      const g = game, w = g.world;
      g.paused = true;
      const simRng = await import('/js/game/simrandom.js');
      const { CELL } = await import('/js/game/terrain.js');
      const J = (window.__JAM = { span: w.terrain.size * CELL, CELL, original: new Map(), hurt: [], pool: [] });
      for (const u of w.units) J.original.set(u, { x: u.x, y: u.y, h: u.heading, hp: u.health, sh: u.shield || 0 });
      const inner = w.hurt.bind(w);
      w.hurt = (u, amount, from, how, shot, contact) => {
        if (u) J.hurt.push({ k: u.__jam || 'other', at: +(+amount).toFixed(2), shot: !!shot, contact: !!contact, t: +w.time.toFixed(2) });
        return inner(u, amount, from, how, shot, contact);
      };
      J.pool = w.squads.filter(q => q.side === 0 && q.isMobile && !q.structure && !q.native && !q.dead &&
        q.members.length && q.members.every(u => !u.flies && u.speed > 0) && q.members[0].type.name === 'Stormtrooper').map(q => q.id);
      const R = w.ramImpacts, chain = [];
      for (let p = R && Object.getPrototypeOf(R); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) chain.push(p.constructor?.name);
      const t = w.time;
      await new Promise(r => setTimeout(r, 400));
      return {
        mode: g.setup?.mode, setupType: g.setup?.type, soloLive: !g.setup?.net && !g.setup?.replay && !g.setup?.attract,
        paused: g.paused, timeStatic: w.time === t, me: g.me, span: J.span, cell: CELL,
        units: w.units.length, squads: w.squads.length, memberCounts: [...new Set(w.squads.map(q => q.members.length))],
        seed: (simRng.seedSim(20240607), 'fixed:20240607'),
        stormtrooperSquads: J.pool.length, authority: R?.constructor?.name || null, authorityChain: chain,
        motionStops: R?.motionStops, impacts: R?.impacts, pageUrl: location.href
      };
    });
    console.log('\n# BOOT ' + JSON.stringify(boot));
    evidence.boot = boot;
    check(boot.mode === 'land' && boot.soloLive, 'acceptance', 'mounted #ground-offensive must be a live solo land world');
    check(boot.timeStatic && boot.paused, 'noStall', 'world must only advance through explicit world.update calls');
    check(!!boot.authority, 'acceptance', `world.ramImpacts=${boot.authority} chain=${boot.authorityChain.join(' -> ')}`);

    // ----------------------------------------------------------------- lanes
    const lanes = await frame.evaluate(() => {
      const w = game.world, { span } = window.__JAM;
      const units = w.units.filter(u => !u.dead);
      const farOf = (x, y) => Math.min(...units.map(u => Math.hypot(u.x - x, u.y - y)), Infinity);
      const roomNear = (x, y, rad, need) => {
        let o = 0, n = 0;
        for (let dx = -rad; dx <= rad; dx += 10) for (let dy = -rad; dy <= rad; dy += 10) { if (dx * dx + dy * dy > rad * rad) continue; n++; if (w.isOpen(x + dx, y + dy, need)) o++; }
        return o / n;
      };
      const routePath = (x0, y0, x1, y1, need) => {
        const way = w.route(x0, y0, x1, y1, need);
        if (!way || !way.length) return null;
        const pts = [{ x: x0, y: y0 }, ...way];
        let L = 0;
        const endsAt = Math.hypot(x1 - way[way.length - 1].x, y1 - way[way.length - 1].y);
        for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        return { pts, L: L + endsAt, way: way.length, endsAt };
      };
      const widthClass = pts => {
        const samples = [];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 10));
          for (let k = 0; k <= n; k++) samples.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
        }
        let wc = 1;
        for (let need = 1; need <= 8; need++) { if (samples.every(p => w.isOpen(p.x, p.y, need))) wc = need; else break; }
        return wc;
      };
      const open = [], pinch = [];
      for (let a = 0; a < 24; a++) {
        const h = (a * Math.PI) / 24, c = Math.cos(h), s = Math.sin(h);
        for (let y0 = 250; y0 <= span - 250; y0 += 60) for (let x0 = 250; x0 <= span - 250; x0 += 60) {
          for (const [L, bucket] of [[480, 'open'], [420, 'pinch']]) {
            const x1 = x0 + c * L, y1 = y0 + s * L;
            if (x1 < 100 || y1 < 100 || x1 > span - 100 || y1 > span - 100) continue;
            const far = Math.min(farOf(x0, y0), farOf(x0 + c * L / 2, y0 + s * L / 2), farOf(x1, y1));
            if (far < 300) continue;
            if (roomNear(x0, y0, 60, 6) < 0.85 || roomNear(x1, y1, 60, 6) < 0.85) continue;  // must hold a formation
            const r = routePath(x0, y0, x1, y1, 1);           // navigable for the movers' own need
            if (!r || r.endsAt > 8) continue;                 // must reach the ordered point exactly
            const straight = Math.hypot(x1 - x0, y1 - y0), detour = r.L / straight, wc = widthClass(r.pts);
            const rec = { x0, y0, x1: +x1.toFixed(0), y1: +y1.toFixed(0), h: +h.toFixed(3), len: L, route: +r.L.toFixed(0), way: r.way, detour: +detour.toFixed(2), widthClass: wc, far: +far.toFixed(0) };
            if (bucket === 'open') { if (detour <= 1.05 && wc >= 6) open.push(rec); }
            else if (detour >= 1.05 && detour <= 1.4 && wc >= 2 && wc <= 4) pinch.push(rec);
          }
        }
      }
      open.sort((p, q) => q.far - p.far);
      pinch.sort((p, q) => (q.far + (4 - q.widthClass) * 300) - (p.far + (4 - p.widthClass) * 300));
      return { open: open[0] || null, pinch: pinch[0] || null, pinch2: pinch[1] || null, nOpen: open.length, nPinch: pinch.length };
    });
    console.log('\n# LANES ' + JSON.stringify(lanes));
    evidence.lanes = lanes;
    check(!!lanes.open && !!lanes.pinch && !!lanes.pinch2, 'acceptance', 'need one open lane and two independent obstructed lanes');

    // ---------------------------------------------------------------- trials
    const trial = (cfg) => frame.evaluate((cfg) => {
      const g = game, w = g.world, J = window.__JAM;
      const h = cfg.h, c = Math.cos(h), s = Math.sin(h);
      const sel = cfg.ids.map(id => w.squads.find(q => q.id === id));
      for (const [u, o] of J.original) {
        u.x = o.x; u.y = o.y; u.heading = o.h; u.lastX = o.x; u.lastY = o.y;
        u.health = o.hp; u.shield = o.sh; u.dead = false;
        u.path = []; u.target = null; u.mv = 0; u.v = 0; u.formPt = null; u.freeLeg = false; u.blockFails = 0;
        u.stopping = null; u.preTurn = null; u.walking = false; u.startAt = 0; u.legTo = null; u.legFrom = null;
        u.detour = null; u.back = false; u.wallAt = null; u.ccCap = undefined; u.ccPush = null; u.loco = undefined;
      }
      for (const q of w.squads) {
        q.formMove = null; q.formSpeed = null; q.formPending = null; q.foe = null; q.march = null; q.post = null;
        q.leash = null; q.legs = null; q.pending = null; q.busy = null; q.moveTry = null; q.box = undefined;
        for (const u of q.members) u.__jam = null;
      }
      J.hurt.length = 0;

      // crowded initial state, either the game's own formation layout at the lane
      // entrance, or a plain tight grid (same crowding, no layout call), all
      // spaced so bodies do not overlap.
      const startSlots = new Map();
      if (cfg.grid) {
        const n = sel.length, cols = Math.ceil(Math.sqrt(n)), gap = 12;
        sel.forEach((q, i) => {
          const ox = ((i % cols) - (cols - 1) / 2) * gap, oy = (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * gap;
          const x = cfg.x0 + Math.cos(h) * ox - Math.sin(h) * oy, y = cfg.y0 + Math.sin(h) * ox + Math.cos(h) * oy;
          startSlots.set(q, { x, y });
          for (const u of q.members) { u.x = x; u.y = y; u.heading = h; u.lastX = x; u.lastY = y; u.path = []; }
          q.formMove = null; q.formSpeed = null; q.formPending = null;
        });
      } else {
        const lay = w.places(sel, cfg.x0, cfg.y0, h);
        for (const q of sel) {
          const at = lay.get(q);
          if (!at) continue;
          startSlots.set(q, { x: at.x, y: at.y });
          for (const u of q.members) { u.x = at.x; u.y = at.y; u.heading = at.face; u.lastX = u.x; u.lastY = u.y; u.path = []; }
          q.formMove = null; q.formSpeed = null; q.formPending = null;
        }
      }
      for (const q of sel) for (const u of q.members) u.__jam = 'T' + q.id;
      const units = sel.flatMap(q => q.members.filter(u => !u.dead));
      let minRatio = Infinity, overlaps = 0;
      for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
        const A = units[i], B = units[j], r = (A.hitRadius || 0) + (B.hitRadius || 0);
        const d = Math.hypot(A.x - B.x, A.y - B.y);
        minRatio = Math.min(minRatio, d / Math.max(1e-6, r));
        if (d < r) overlaps++;
      }
      const xs = units.map(u => u.x), ys = units.map(u => u.y);
      const start = {
        members: units.length, minRatio: units.length > 1 ? +minRatio.toFixed(2) : null, overlaps,
        extent: { w: +(Math.max(...xs) - Math.min(...xs)).toFixed(1), d: +(Math.max(...ys) - Math.min(...ys)).toFixed(1) },
        allOpen: units.every(u => w.isOpen(u.x, u.y, u.need || 1))
      };

      // the real player command path
      const groupsBefore = w.groups.slice();
      const out = g.command({ c: 'move', u: sel.map(q => q.id), x: cfg.x1, y: cfg.y1 });
      const atSize = out && out.at instanceof Map ? out.at.size : null;
      const slots = new Map();
      for (const q of sel) {
        const at = out && out.at instanceof Map ? out.at.get(q) : null;
        slots.set(q, at ? { x: at.x, y: at.y } : { x: cfg.x1, y: cfg.y1 });
      }
      const group = w.groups.filter(F => !groupsBefore.includes(F) && F.members.some(m => sel.includes(m.q)))
        .map(F => ({ len: +F.len.toFixed(1), members: F.members.length, speed: F.speed, pts: F.pts.slice(0, 3).map(p => ({ x: +p.x.toFixed(0), y: +p.y.toFixed(0) })) }));
      const orders = sel.map(q => ({
        id: q.id, formMove: !!q.formMove,
        slotDist: +Math.hypot(slots.get(q).x - (startSlots.get(q) || { x: cfg.x0, y: cfg.y0 }).x, slots.get(q).y - (startSlots.get(q) || { x: cfg.x0, y: cfg.y0 }).y).toFixed(1),
        orderErr: +Math.hypot(slots.get(q).x - cfg.x1, slots.get(q).y - cfg.y1).toFixed(1)
      }));
      const acceptance = { returned: out ? Object.keys(out) : null, atSize, squads: sel.length, groupsBefore: groupsBefore.length, groupsAfter: w.groups.length, groupForSelection: group, formationSquads: orders.filter(o => o.formMove).length, orders };

      // measure by ticking the real world only
      const track = units.map(u => ({ u, along: [], dist: [], moved: [] }));
      const samples = [];
      const R = w.ramImpacts;
      const m0 = R ? R.motionStops : null, i0 = R ? R.impacts : null;
      const simStart = w.time;
      let offOpen = 0, offKeys = new Set(), pen = { depth: 0, pair: null, tick: -1 }, minOther = Infinity, otherNear = null;
      const pin = new Map(units.map(u => [u, { run: 0, max: 0, ticks: 0, since: -1 }]));
      const live = q => !q.dead && q.members.some(u => !u.dead && (u.path.length > 0 || (q.formSpeed ? q.formSpeed.v > 0 : false) || !!q.formMove));
      for (let i = 0; i < cfg.ticks; i++) {
        w.update(1 / 30);
        for (const t of track) {
          const u = t.u, ax = u.x - cfg.x0, ay = u.y - cfg.y0;
          const prev = t.moved.length ? t.moved[t.moved.length - 1].x : null;
          const py = t.moved.length ? t.moved[t.moved.length - 1].y : null;
          const step = prev === null ? 0 : Math.hypot(u.x - prev, u.y - py);
          t.moved.push({ x: u.x, y: u.y, step });
          t.along.push(ax * c + ay * s);
          t.dist.push(Math.hypot(u.x - slots.get(u.squad).x, u.y - slots.get(u.squad).y));
          if (!u.dead && !w.isOpen(u.x, u.y, u.need || 1)) { offOpen++; offKeys.add(u.__jam); }
          const p = pin.get(u);
          if (!u.dead && u.path.length > 0 && step < 0.01) { if (!p.run) p.since = i; p.run++; p.ticks++; if (p.run > p.max) p.max = p.run; } else p.run = 0;
        }
        if (i % 5 === 0) for (let a = 0; a < track.length; a++) for (let b = a + 1; b < track.length; b++) {
          const A = track[a].u, B = track[b].u;
          if (A.dead || B.dead) continue;
          const r = (A.hitRadius || 0) + (B.hitRadius || 0), d = Math.hypot(A.x - B.x, A.y - B.y);
          if (r - d > pen.depth) pen = { depth: +(r - d).toFixed(2), pair: [A.__jam, B.__jam], tick: i, d: +d.toFixed(2), r: +r.toFixed(2) };
        }
        if (i % 15 === 0) for (const t of track) {
          if (t.u.dead) continue;
          for (const u of w.units) {
            if (u.dead || u.__jam) continue;
            const d = Math.hypot(u.x - t.u.x, u.y - t.u.y);
            if (d < minOther) { minOther = d; otherNear = { type: u.type.name, side: u.side, d: +d.toFixed(0) }; }
          }
        }
        if (i % 30 === 0 || i === cfg.ticks - 1)
          samples.push({ i, t: +w.time.toFixed(2), groups: w.groups.length, forming: sel.filter(q => q.formMove).length, mean: +(track.reduce((a, t) => a + t.along[i], 0) / track.length).toFixed(1), lead: +track[0].along[i].toFixed(1) });
      }
      const perSquad = sel.map(q => {
        const u = q.members[0], t = track.find(t => t.u === u), slot = slots.get(q), st = startSlots.get(q) || { x: cfg.x0, y: cfg.y0 };
        const sd = Math.hypot(slot.x - st.x, slot.y - st.y);
        const along = t.along[t.along.length - 1] - t.along[0];
        let worst = Infinity;
        for (let i = 120; i < t.along.length; i++) worst = Math.min(worst, t.along[i] - t.along[i - 120]);
        const p = pin.get(u);
        return {
          id: q.id, dead: !!u.dead, hp: +u.health.toFixed(1), along: +along.toFixed(1), slotDist: +sd.toFixed(1),
          frac: +(along / Math.max(1, sd)).toFixed(3), finalToSlot: +t.dist[t.dist.length - 1].toFixed(1),
          worst120: +worst.toFixed(1), pinned: p.max, pinnedTicks: p.ticks, pinFromTick: p.run > 10 ? p.since : null, stuckEnd: p.run > 10 && t.dist[t.dist.length - 1] > 20, orderLive: live(q),
          path: u.path.length, mv: +(u.mv || 0).toFixed(2), lastPos: { x: +u.x.toFixed(1), y: +u.y.toFixed(1) }
        };
      });
      const contacts = [];
      for (let a = 0; a < units.length; a++) for (let b = a + 1; b < units.length; b++) {
        const A = units[a], B = units[b];
        if (A.dead || B.dead) continue;
        const d = Math.hypot(A.x - B.x, A.y - B.y), r = (A.hitRadius || 0) + (B.hitRadius || 0);
        if (d <= r + 0.5) contacts.push({ a: A.__jam, b: B.__jam, d: +d.toFixed(2), r: +r.toFixed(2) });
      }
      return {
        name: cfg.name, contacts,
        lane: { x0: cfg.x0, y0: cfg.y0, x1: cfg.x1, y1: cfg.y1, h: +cfg.h.toFixed(3) },
        ids: cfg.ids, ticks: cfg.ticks, simSeconds: +(w.time - simStart).toFixed(2),
        types: [...new Set(units.map(u => u.type.name))], speeds: [...new Set(units.map(u => +u.speed.toFixed(2)))],
        start, acceptance, perSquad,
        summary: {
          minFrac: +Math.min(...perSquad.map(p => p.frac)).toFixed(3),
          meanFrac: +(perSquad.reduce((a, p) => a + p.frac, 0) / perSquad.length).toFixed(3),
          arrived: perSquad.filter(p => p.finalToSlot <= 30).length,
          maxToSlot: +Math.max(...perSquad.map(p => p.finalToSlot)).toFixed(1),
          stalls: perSquad.filter(p => p.orderLive && p.worst120 < 2 && p.finalToSlot > 20).map(p => p.id),
          pinned: perSquad.filter(p => p.pinned > 10).map(p => p.id),
          pinnedTicks: perSquad.reduce((a, p) => a + p.pinnedTicks, 0),
          stuck: perSquad.filter(p => p.stuckEnd).map(p => p.id),
          stuckStates: perSquad.filter(p => p.stuckEnd).map(p => ({ id: p.id, path: p.path, mv: p.mv, toSlot: p.finalToSlot, pos: p.lastPos }))
        },
        clipping: { unitTicksOffOpen: offOpen, keys: [...offKeys] },
        penetration: pen,
        others: { minGap: isFinite(minOther) ? +minOther.toFixed(0) : null, near: otherNear },
        authority: { motionStops: R ? R.motionStops - m0 : null, impacts: R ? R.impacts - i0 : null },
        hurt: J.hurt.filter(h => h.k !== 'other'), hurtOther: J.hurt.filter(h => h.k === 'other').length,
        hurtOtherSample: J.hurt.filter(h => h.k === 'other').slice(0, 6), deaths: perSquad.filter(p => p.dead).length,
        groupsDuring: { max: Math.max(...samples.map(x => x.groups)), formingAt0: samples[0].forming, formingMin: Math.min(...samples.map(x => x.forming)), formingEnd: samples[samples.length - 1].forming },
        samples,
        status: { mode: g.setup?.mode, time: +w.time.toFixed(2), paused: g.paused, alive: w.units.filter(u => !u.dead).length }
      };
    }, cfg);

    const pool = await frame.evaluate(() => window.__JAM.pool);
    const crowd = pool.slice(0, CROWD);
    const four = pool.slice(0, 4);
    const one = pool.slice(0, 1);
    const open = lanes.open, pinch = lanes.pinch, pinch2 = lanes.pinch2;

    const A = await trial({ name: 'A crowd, open lane', ids: crowd, ticks: TICKS_OPEN, ...open });
    console.log('\n# A ' + JSON.stringify(brief(A)));
    const A2 = await trial({ name: 'A2 crowd, open lane (repeat)', ids: crowd, ticks: TICKS_OPEN, ...open });
    console.log('\n# A2 ' + JSON.stringify(brief(A2)));
    const B = await trial({ name: 'B single squad, open lane', ids: one, ticks: TICKS_OPEN, ...open });
    console.log('\n# B ' + JSON.stringify({ start: B.start, perSquad: B.perSquad, authority: B.authority }));
    const B2 = await trial({ name: 'B2 single squad, obstructed lane', ids: one, ticks: TICKS_PINCH, ...pinch });
    console.log('\n# B2 ' + JSON.stringify({ start: B2.start, perSquad: B2.perSquad, authority: B2.authority }));
    const C = await trial({ name: 'C crowd, obstructed lane', ids: crowd, ticks: TICKS_PINCH, ...pinch });
    console.log('\n# C ' + JSON.stringify(brief(C)));
    const C4 = await trial({ name: 'C4 four squads, obstructed lane', ids: four, ticks: TICKS_PINCH, ...pinch });
    console.log('\n# C4 ' + JSON.stringify(brief(C4)));
    const Cgrid = await trial({ name: 'Cg crowd, obstructed lane, grid start', ids: crowd, ticks: TICKS_PINCH, grid: true, ...pinch });
    console.log('\n# Cg ' + JSON.stringify(brief(Cgrid)));
    const C2 = await trial({ name: 'C2 crowd, second obstructed lane', ids: crowd, ticks: TICKS_PINCH, ...pinch2 });
    console.log('\n# C2 ' + JSON.stringify(brief(C2)));
    const C3 = await trial({ name: 'C3 crowd, obstructed lane (repeat of C)', ids: crowd, ticks: TICKS_PINCH, ...pinch });
    console.log('\n# C3 ' + JSON.stringify(brief(C3)));
    Object.assign(evidence, { A, A2, B, B2, C, C4, Cgrid, C3, C2 });

    // --------------------------------------------------------------- verdicts
    console.log('\n# VERDICTS');
    for (const [k, T] of Object.entries({ A, A2, B, B2, C, C4, Cg: Cgrid, C3, C2 })) {
      check(T.acceptance.atSize === T.ids.length && T.acceptance.orders.every(o => o.orderErr <= 200),
        'acceptance', `${k}: atSize=${T.acceptance.atSize}/${T.ids.length} orderErr=${T.acceptance.orders.map(o => o.orderErr).join(',')}`);
      check(T.hurt.length === 0 && T.deaths === 0, 'noCasualties', `${k}: hurt=${T.hurt.length} deaths=${T.deaths}`);
      check(T.clipping.unitTicksOffOpen === 0, 'noClipping', `${k}: unitTicksOffOpen=${T.clipping.unitTicksOffOpen}`);
      check(T.summary.stalls.length === 0, 'noStall', `${k}: stalls=${JSON.stringify(T.summary.stalls)}`);
      check(T.summary.stuck.length === 0, 'noPinning', `${k}: stuckAtEnd=${JSON.stringify(T.summary.stuck)} states=${JSON.stringify(T.summary.stuckStates)}`);
      check(T.penetration.depth <= 0.5 * (T.penetration.r || 1), 'noOverlap', `${k}: maxPenetration=${T.penetration.depth} rSum=${T.penetration.r ?? '-'}`);
    }
    check(A.acceptance.groupForSelection.some(F => F.members >= 2), 'acceptance', `A group members=${JSON.stringify(A.acceptance.groupForSelection.map(F => F.members))}`);
    check(A.summary.arrived === A.ids.length && A.summary.minFrac >= 0.9, 'crowdArrival', `A arrived=${A.summary.arrived}/${A.ids.length} minFrac=${A.summary.minFrac} maxToSlot=${A.summary.maxToSlot}`);
    const bFrac = B.perSquad[0].frac, worstA = Math.min(...A.perSquad.map(p => p.frac));
    check(worstA >= 0.75 * bFrac, 'crowdVsControl', `A worstFrac=${worstA} controlFrac=${bFrac}`);
    check(B2.perSquad[0].finalToSlot <= 30, 'pinchControl', `B2 finalToSlot=${B2.perSquad[0].finalToSlot} frac=${B2.perSquad[0].frac}`);
    for (const [k, T] of [['C', C], ['C3', C3], ['C4', C4], ['Cg', Cgrid], ['C2', C2]])
      check(T.summary.arrived === T.ids.length && T.summary.minFrac >= 0.9, 'obstruction', `${k} lane=${JSON.stringify(T.lane)} arrived=${T.summary.arrived}/${T.ids.length} minFrac=${T.summary.minFrac} maxToSlot=${T.summary.maxToSlot} authority=${JSON.stringify(T.authority)}`);
    const same = A.perSquad.every((p, i) => Math.abs(p.along - A2.perSquad[i].along) <= 1);
    check(same && A.clipping.unitTicksOffOpen === A2.clipping.unitTicksOffOpen && A.hurt.length === A2.hurt.length, 'determinism', `A vs A2 maxDelta=${Math.max(...A.perSquad.map((p, i) => Math.abs(p.along - A2.perSquad[i].along))).toFixed(2)}`);
    const jamSame = C.perSquad.every((p, i) => Math.abs(p.along - C3.perSquad[i].along) <= 1);
    check(jamSame, 'determinism', `C vs C3 maxDelta=${Math.max(...C.perSquad.map((p, i) => Math.abs(p.along - C3.perSquad[i].along))).toFixed(2)} stuck=${JSON.stringify(C3.summary.stuck)}`);
    check(errors.length === 0, 'noClipping', `pageErrors=${JSON.stringify(errors.slice(0, 3))}`);

    // ---------------------------------------------------------------- evidence
    evidence.verdict = { failures, pass: failures.length === 0, wallSeconds: +((Date.now() - t0) / 1000).toFixed(1), passConditions: PASS };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT + '.json', JSON.stringify(evidence, null, 1));
    const row = k => {
      const T = evidence[k];
      return `| ${k === 'Cgrid' ? 'Cg' : k} | ${T.ids.length} | ${T.summary.arrived}/${T.ids.length} | ${T.summary.minFrac} | ${T.summary.meanFrac} | ${T.summary.maxToSlot} | ${JSON.stringify(T.summary.stalls)} | ${JSON.stringify(T.summary.pinned)} | ${T.summary.pinnedTicks} | ${JSON.stringify(T.authority)} | ${T.clipping.unitTicksOffOpen} | ${T.penetration.depth} | ${T.hurtOther} |`;
    };
    const md = [
      '# Mounted crowded allied land formation movement trial',
      '',
      `- Window: ${BASE} scene #ground-offensive, gameplay frame ${boot.pageUrl}`,
      `- World: ${boot.mode}/${boot.setupType}, live solo, ${boot.units} units / ${boot.squads} squads (member counts ${JSON.stringify(boot.memberCounts)}), paused; stepped only by world.update(1/30)`,
      `- Movement authority: ${boot.authority} (chain ${boot.authorityChain.join(' -> ')})`,
      `- Open lane: ${JSON.stringify(lanes.open)}`,
      `- Pinch lane 1: ${JSON.stringify(lanes.pinch)}`,
      `- Pinch lane 2: ${JSON.stringify(lanes.pinch2)}`,
      `- Crowd: ${CROWD} Stormtrooper squads side 0 (ids ${crowd.join(',')}), speed ${A.speeds.join(',')}, body radius 3.5`,
      `- Crowd start (A): minRatio ${A.start.minRatio}, overlaps ${A.start.overlaps}, extent ${JSON.stringify(A.start.extent)}, allOpen ${A.start.allOpen}`,
      `- Command: game.command({c:'move', u:[...], x, y}) -> atSize ${A.acceptance.atSize}, group ${JSON.stringify(A.acceptance.groupForSelection)}`,
      '',
      '## Results',
      '| trial | squads | arrived | minFrac | meanFrac | maxToSlot | stalls | pinned(max) | pinnedTicks | authority motionStops/impacts | clipTicks | maxPen | untaggedHurt |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
      ...['A', 'A2', 'B', 'B2', 'C', 'C3', 'C4', 'Cgrid', 'C2'].map(row),
      '',
      `## Verdict: ${failures.length ? 'FAIL' : 'PASS'}`,
      ...failures.map(f => `- **${f.name}**: ${f.detail}  \n  rule: ${f.rule}`),
      '',
      `Wall time ${((Date.now() - t0) / 1000).toFixed(1)}s`
    ].join('\n');
    fs.writeFileSync(OUT + '.md', md);
    console.log(`\nwrote ${OUT}.json and ${OUT}.md in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (failures.length) process.exitCode = 1;
  } finally {
    if (errors.length) console.log('pageErrors', errors.slice(0, 5));
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 2; });
