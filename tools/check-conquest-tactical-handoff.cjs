// Repeatable integration check for the Universal Galactic Conquest -> rendered
// tactical handoff with the Rapier destruction layer.
//
// What it does (all through the mounted Universal host, http://127.0.0.1:8590/):
//   1. starts a real stock conquest campaign from the title menu and the atlas
//      board ("Heart of the Maw", Forces of Corruption) in a throwaway profile;
//   2. dismisses the campaign intro, then orders the human fleet onto a hostile
//      world with the game's own move command (fast-forward on, as a player would);
//   3. the real pending-battle shell appears -> the real BEGIN control is clicked;
//   4. the rendered space battle must carry the Rapier debris world (version,
//      bodies), a real damage death must spawn native debris, and stepping that
//      physics must not touch the tactical simulation;
//   5. the battle is resolved through the real victory path, Continue returns to
//      the strategic galaxy, which must come back with the same campaign;
//   6. the now clear orbit is invaded with the human company fleet -> the same
//      checks for the land battle (vehicle wreck / infantry ragdoll), then the
//      same return-to-strategic-state check.
//
// With the mounted Universal launcher running and playwright-core available:
//   npm run test:physics-conquest
//   npm run test:physics-conquest -- --space --json report.json
// Set SCREENSHOT=shot-%m.png to save a frame per battle.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOST = process.env.HOST || 'http://127.0.0.1:8590/';
const WANT = process.argv.includes('--space') ? ['space'] : ['space', 'land'];
const JSON_OUT = (() => {
  const i = process.argv.indexOf('--json');
  return i > 0 ? process.argv[i + 1] : path.join(os.tmpdir(), `conquest-physics-${Date.now()}.json`);
})();
const SCREENSHOT = process.env.SCREENSHOT || '';
const REGRESS = process.argv.includes('--regress');
// The pre-change eligibility gate (campaign / linked-tactical / net battles were
// excluded). Served instead of the real module with --regress, to prove this
// check actually detects the regression without touching the repo.
const OLD_RUNTIME = `export function usesBattleDestruction(setup) {
  return (
    !!setup &&
    (!setup.mode || setup.mode === 'land' || setup.mode === 'space') &&
    !(
      setup.net || setup.shooterNet || setup.replay || setup.campaign ||
      setup.linkedTactical || setup.headless || setup.attract || setup.benchmark
    )
  );
}
let ready;
export function loadWreckPhysics() {
  return (ready ||= import('../../vendor/rapier/rapier.es.js').then(async R => {
    await R.init();
    return R;
  }));
}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --------------------------------------------------------------------- helpers
async function setArg(frame, value) {
  await frame.locator('body').evaluate((el, value) => {
    window.__eawrArg = value;
  }, value);
}

async function poll(frame, script, { timeout = 180000, label = 'condition', arg } = {}) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try {
      if (arg !== undefined) await setArg(frame, arg);
      const value = await frame.locator('body').evaluate(script);
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}${last ? ` (${last.message.slice(0, 160)})` : ''}`);
}

async function dismissDialogs(frame) {
  for (let i = 0; i < 8; i++) {
    const button = frame.locator('[data-id="IDC_SUMMARY_DIALOG_CLOSE_BUTTON"]').first();
    if (!(await button.count().catch(() => 0))) return i;
    if (!(await button.isVisible().catch(() => false))) return i;
    await button.click({ timeout: 15000 }).catch(() => {});
    await sleep(700);
  }
  return 8;
}

async function openCampaign(page) {
  await page.goto(HOST);
  const f = page.frameLocator('#game');
  await f.locator('[data-id="TITLE_PLAY"]').click();
  await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
  await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
  const board = f.locator('.uc-atlas');
  await board.locator('.uc-map-choice[aria-pressed="true"]').waitFor({ timeout: 120000 });
  const family = await board.locator('.uc-map-choice[aria-pressed="true"]').getAttribute('data-family');
  const planets = await board.locator('.uc-map-choice[aria-pressed="true"]').getAttribute('aria-label');
  await board.locator('.uc-start').click();
  const state = await poll(
    f,
    () => {
      const g = window.game;
      if (!(g?.galaxy && g.ui && g.battles && g.pendingBattle) || g.warming) return null;
      return { campaign: g.galaxy.campaign.name, me: g.me, planets: g.galaxy.planets.length, factions: g.galaxy.players.map(p => p.faction) };
    },
    { label: 'strategic galaxy' }
  );
  const closed = await dismissDialogs(f);
  // The campaign opens paused behind its intro story dialog; the galaxy sim
  // starts once the player closes it.
  const running = await poll(f, () => (window.game?.galaxy?.time > 0 ? { time: window.game.galaxy.time, paused: window.game.paused } : null), {
    timeout: 60000,
    label: 'the strategic clock running'
  });
  return { frame: f, family, planets, state, intro: { closed, ...running } };
}

async function readyAfterReturn(frame) {
  await poll(
    frame,
    () => {
      const g = window.game;
      return !!(g?.galaxy && g.ui && g.battles && g.pendingBattle && !g.warming && !g.battle);
    },
    { timeout: 240000, label: 'strategic galaxy after the battle' }
  );
  await dismissDialogs(frame);
}

// The real strategic orders. Space: move a fleet onto a world whose hostile
// fleet is in orbit (checkConflict engages on arrival). Land: move a company
// fleet onto a world with a clear orbit, then `game.land` - the method the
// planet panel's invasion control calls.
async function orderSpace(frame) {
  return frame.locator('body').evaluate(async () => {
    const g = window.game,
      gal = g.galaxy,
      { db } = await import('/js/gamedata.js'),
      key = s => String(s || '').toUpperCase(),
      hostile = (a, b) => key(a) !== key(b) && !(db.faction(a)?.list('Allies') || []).some(n => key(n) === key(b));
    const fleets = gal.fleets.filter(f => f.owner === g.me && !f.leg && f.units.some(u => !u.dead));
    const distance = (fleet, p) => {
      const from = gal.planets[fleet.planet]?.pos || [0, 0],
        to = p.pos || [0, 0];
      return Math.hypot(to[0] - from[0], to[1] - from[1]);
    };
    const rows = [];
    for (const fleet of fleets)
      for (const p of gal.planets)
        if (p.owner && !p.background && !p.destroyed && p.index !== fleet.planet && hostile(fleet.owner, p.owner) && p.type.str('Space_Tactical_Map').trim())
          if (gal.fleets.some(f => f !== fleet && f.planet === p.index && !f.leg && hostile(f.owner, fleet.owner) && f.units.some(u => !u.dead)))
            rows.push({
              fleet,
              planet: p,
              d: distance(fleet, p),
              strength: fleet.units.filter(u => !u.dead).length,
              // Prefer the world the ground battle can follow on: a garrison and a land map.
              ground: p.garrison.filter(u => !u.dead).length && p.type.str('Land_Tactical_Map').trim() ? 1 : 0,
              overrun: g.battles.overrun({ p: p.index, attacker: fleet.owner, defender: p.owner, mode: 'space' })
            });
    rows.sort((a, b) => Number(a.overrun) - Number(b.overrun) || b.ground - a.ground || b.strength - a.strength || a.d - b.d);
    for (const row of rows) {
      const from = gal.planets[row.fleet.planet]?.name;
      if (!g.moveFleet(row.fleet, row.planet.index)) continue;
      g.setFastForward(true);
      return {
        ok: true,
        from,
        target: row.planet.name,
        targetIndex: row.planet.index,
        defender: row.planet.owner,
        fleet: row.fleet.units.filter(u => !u.dead).map(u => u.type.name),
        distance: Math.round(row.d),
        candidates: rows.length,
        autoResolveWouldOverrun: row.overrun
      };
    }
    return { ok: false, candidates: rows.length, fleets: fleets.length };
  });
}

async function orderLand(frame, preferred) {
  await setArg(frame, preferred);
  return frame.locator('body').evaluate(async () => {
    const preferred = window.__eawrArg;
    const g = window.game,
      gal = g.galaxy,
      invasion = await import('/js/game/invasion.js'),
      { db } = await import('/js/gamedata.js'),
      key = s => String(s || '').toUpperCase(),
      hostile = (a, b) => key(a) !== key(b) && !(db.faction(a)?.list('Allies') || []).some(n => key(n) === key(b));
    // Company transports of the human faction.
    const carriers = gal.fleets.filter(
      f => f.owner === g.me && !f.leg && f.units.some(u => !u.dead && invasion.carriedCompany(u))
    );
    const rows = [],
      rejections = [];
    for (const fleet of carriers)
      for (const p of gal.planets) {
        if (!p.owner || p.background || p.destroyed || p.index === fleet.planet || !hostile(fleet.owner, p.owner)) continue;
        const why = [];
        if (!p.type.str('Land_Tactical_Map').trim()) why.push('no land map');
        if (!p.garrison.some(u => !u.dead)) why.push('no garrison');
        if (gal.fleets.some(f => f !== fleet && f.planet === p.index && !f.leg && f.units.some(u => !u.dead) && hostile(f.owner, fleet.owner)))
          why.push('hostile fleet in orbit');
        if (p.station && hostile(fleet.owner, p.stationOwner || p.owner)) why.push('hostile station');
        // The company travels with the fleet, so test it against the destination.
        const companies = fleet.units.filter(u => !u.dead).map(u => invasion.carriedCompany(u)).filter(Boolean);
        const allowed = companies.filter(t => invasion.planetAllowsCompany(p, t));
        if (!allowed.length) why.push('no company that this world accepts');
        if (!why.length && g.battles.overrun({ p: p.index, attacker: fleet.owner, defender: p.owner, mode: 'land', options: { records: fleet.units } }))
          why.push('auto-resolve would overrun it');
        if (why.length) {
          if (rejections.length < 12) rejections.push({ planet: p.name, owner: p.owner, why });
          continue;
        }
        rows.push({ fleet, planet: p, preferred: p.index === preferred ? 1 : 0, garrison: p.garrison.filter(u => !u.dead).length });
      }
    rows.sort((a, b) => b.preferred - a.preferred || b.garrison - a.garrison);
    for (const row of rows) {
      const fleet = row.fleet,
        target = row.planet,
        from = gal.planets[fleet.planet]?.name,
        needsTravel = fleet.planet !== target.index;
      const move = needsTravel ? g.moveFleet(fleet, target.index) : true;
      if (!move) continue;
      return {
        ok: true,
        move,
        needsTravel,
        from,
        target: target.name,
        targetIndex: target.index,
        defender: target.owner,
        garrison: row.garrison,
        fleet: fleet.units.filter(u => !u.dead).map(u => u.type.name),
        candidates: rows.length
      };
    }
    return {
      ok: false,
      carriers: carriers.length,
      carrierFleets: carriers.map(f => ({ planet: gal.planets[f.planet]?.name, units: f.units.filter(u => !u.dead).map(u => u.type.name) })),
      candidates: rows.length,
      rejections,
      hostileWorlds: gal.planets
        .filter(p => p.owner && hostile(g.me, p.owner))
        .map(p => ({ name: p.name, owner: p.owner, garrison: p.garrison.filter(u => !u.dead).length, station: p.station?.name || null, land: !!p.type.str('Land_Tactical_Map').trim(), fleets: gal.fleets.filter(f => f.planet === p.index && !f.leg).map(f => f.owner) })),
      reason: carriers.length ? 'no world with a clear orbit, a garrison and a land map' : 'no company-carrying fleet'
    };
  });
}

// After the company fleet lands in orbit, issue the real invasion order.
async function invade(frame, targetIndex) {
  await setArg(frame, targetIndex);
  return frame.locator('body').evaluate(async () => {
    const targetIndex = window.__eawrArg,
      g = window.game,
      gal = g.galaxy,
      invasion = await import('/js/game/invasion.js');
    const fleet = gal.fleets.find(
      f => f.owner === g.me && f.planet === targetIndex && !f.leg && f.units.some(u => !u.dead && invasion.carriedCompany(u))
    );
    if (!fleet) return { ok: false, reason: 'no company fleet in orbit' };
    const p = gal.planets[targetIndex],
      land = g.land(fleet, targetIndex);
    return {
      ok: !!land,
      land,
      canLand: invasion.canLand(gal, fleet, targetIndex),
      garrison: p.garrison.filter(u => !u.dead).length,
      troops: invasion.invasionForces(gal, targetIndex, g.me).length,
      owner: p.owner
    };
  });
}

// Wait for the real pending-battle shell and press its real BEGIN control.
async function pressBegin(page, frame, expectMode) {
  const request = await poll(
    frame,
    () => {
      const g = window.game;
      const r = g?.pendingBattle?.request;
      return r ? { p: r.p, mode: r.mode, attacker: r.attacker, defender: r.defender, shell: g.pendingBattle.name } : null;
    },
    { timeout: 200000, label: 'pending battle shell (real battle setup)' }
  );
  assert.equal(request.mode, expectMode, 'the shell presents the requested battle');
  const controls = request.shell === 'PENDING_BATTLE_SHELL' ? ['choice_button_left'] : ['attack_button_single', 'choice_button_left'];
  const result = { shell: request.shell, control: null, via: null };
  for (const name of controls) {
    const hits = page.frameLocator('#game').locator(`[data-control="${name}" i] .script-button-hit`);
    for (let i = 0, n = await hits.count(); i < n; i++) {
      const hit = hits.nth(i);
      if (!(await hit.isVisible().catch(() => false))) continue;
      try {
        await hit.click({ timeout: 15000 });
        result.control = name;
        result.via = 'dom click';
        break;
      } catch {}
    }
    if (result.control) break;
  }
  if (!result.control) {
    await setArg(frame, controls);
    const clicked = await frame.locator('body').evaluate(() => {
      const ui = window.game?.scriptUI,
        controls = window.__eawrArg || [];
      if (!ui) return null;
      for (const name of controls) if (ui.click(name, true)) return name;
      return null;
    });
    if (!clicked) throw new Error('the pending-battle BEGIN control did not answer');
    result.control = clicked;
    result.via = 'scriptUI click';
  }
  return { request, ...result };
}

async function tacticalReady(frame, mode) {
  const state = await poll(
    frame,
    () => {
      const mode = window.__eawrArg,
        g = window.game;
      if (!g || g.setup?.mode !== mode || !g.setup?.campaign || !g.world || !g.ui) return null;
      return {
        mode,
        campaign: g.setup.campaign.campaignName,
        planet: g.setup.campaign.planet,
        mapFile: g.setup.mapFile,
        linkedTactical: !!g.setup.linkedTactical,
        campaignGalaxy: g.setup.campaign.galaxy
          ? {
              campaign: g.setup.campaign.galaxy.campaign,
              planets: g.setup.campaign.galaxy.planets.length,
              time: g.setup.campaign.galaxy.time
            }
          : null,
        credit: g.credits,
        human: g.human?.factionName || null
      };
    },
    { timeout: 300000, label: `${mode} tactical battle`, arg: mode }
  ).catch(async error => {
    const diag = await frame
      .locator('body')
      .evaluate(() => ({
        url: location.href,
        title: document.title,
        game: !!window.game,
        mode: window.game?.setup?.mode,
        setupKeys: window.game?.setup ? Object.keys(window.game.setup).slice(0, 12) : null,
        campaign: !!window.game?.setup?.campaign,
        world: !!window.game?.world,
        worldTime: window.game?.world?.time,
        ui: !!window.game?.ui,
        arg: window.__eawrArg,
        warming: window.game?.warming,
        loading: document.getElementById('loading')?.className,
        body: document.body.innerText.slice(0, 200).replace(/\s+/g, ' ')
      }))
      .catch(e => ({ evalError: e.message }));
    throw new Error(`${error.message} :: ${JSON.stringify(diag)}`);
  });
  return state;
}

// ------------------------------------------------------------- battle evidence
async function inspectLand(frame) {
  return frame.locator('body').evaluate(async () => {
    const g = window.game,
      w = g.world,
      layer = g.vehicleWrecks;
    const runtime = await import('/js/game/rapier-runtime.js');
    const R = layer?.R || null,
      world = layer?.world || null;
    const out = {
      setup: {
        mode: g.setup.mode,
        map: g.setup.mapFile,
        campaign: g.setup.campaign?.campaignName,
        planet: g.setup.campaign?.planet,
        sides: g.setup.campaign?.sides,
        raid: !!g.setup.campaign?.attacker?.raid,
        linkedTactical: !!g.setup.linkedTactical,
        instant: !!g.setup.instant,
        simulation: g.setup.net ? 'net' : 'local'
      },
      eligible: runtime.usesBattleDestruction(g.setup),
      layer: !!layer,
      rapier: R ? { version: R.version(), World: typeof R.World, init: typeof R.init } : null,
      world: world ? { step: typeof world.step, bodies: world.bodies.len(), colliders: world.colliders.len(), joints: world.impulseJoints.len() } : null,
      samples: []
    };
    if (!layer || !world) return out;
    // Give the opening a moment, then make hostile units visible to the layer.
    {
      const until = performance.now() + 90000;
      while (w.time < 2 && performance.now() < until) await new Promise(r => setTimeout(r, 100));
      g.reveal = true;
      w.reveal = true;
      for (const u of w.units) u.seen = true;
      await new Promise(r => setTimeout(r, 600));
    }
    g.paused = true;
    const snapshot = () =>
      JSON.stringify({
        time: w.time,
        winner: w.winner,
        units: w.units.map(u => [u.x, u.y, u.z, u.health, u.dead ? 1 : 0, u.heading])
      });
    const mySide = g.human?.side ?? g.me,
      mine = u => u.side >= 0 && u.side === mySide;
    const enemies = w.units.filter(u => !u.dead && !mine(u) && u.side >= 0 && u.holder?.visible && !u.structure && !u.inside);
    const pick = [
      ...enemies.filter(u => !u.foot && u.kind === 'VEHICLE').slice(0, 2),
      ...enemies.filter(u => u.foot).slice(0, 2),
      ...enemies.slice(0, 2)
    ];
    for (const u of pick) {
      if (u.dead) continue;
      const bodies = world.bodies.len();
      const wasVisible = u.holder.visible;
      w.hurt(u, 1e9, null);
      const wreck = layer.live.find(r => r.u === u),
        sample = {
          kind: u.foot ? 'infantry' : 'vehicle',
          unit: u.type.name,
          visibleBefore: wasVisible,
          died: !!u.dead,
          replaced: layer.replaced.has(u),
          hidden: !u.holder.visible,
          bodiesAdded: world.bodies.len() - bodies,
          pieces: wreck?.pieces.length || 0,
          dollNodes: wreck?.doll?.nodes.length || 0,
          joints: world.impulseJoints.len()
        };
      if (wreck) {
        const at = () => (wreck.doll ? wreck.doll.nodes[0].body.translation().z : wreck.pieces[0].body.translation().z);
        sample.startZ = +at().toFixed(3);
        for (let i = 0; i < 240; i++) layer.step(1 / 60);
        sample.endZ = +at().toFixed(3);
        sample.moved = +Math.abs(sample.startZ - sample.endZ).toFixed(3);
        sample.fell = +(sample.startZ - sample.endZ).toFixed(3);
        sample.rootParented = !!(wreck.doll?.root || wreck.pieces[0]?.root)?.parent;
      }
      out.samples.push(sample);
      if (out.samples.length >= 2) break;
    }
    out.live = layer.live.length;
    out.bodies = world.bodies.len();
    // The deaths are gameplay; the debris stepping must be presentation only.
    const afterDeaths = snapshot();
    for (let i = 0; i < 60; i++) layer.step(1 / 60);
    out.simUnchanged = snapshot() === afterDeaths;
    out.stepped = 60;
    out.paused = g.paused;
    return out;
  });
}

async function inspectSpace(frame) {
  return frame.locator('body').evaluate(async () => {
    const g = window.game,
      w = g.world,
      r = g.renderer;
    const runtime = await import('/js/game/rapier-runtime.js');
    const debris = r?.spaceWrecks || null,
      R = debris?.R || null,
      world = debris?.world || null;
    const out = {
      setup: {
        mode: g.setup.mode,
        map: g.setup.mapFile,
        campaign: g.setup.campaign?.campaignName,
        planet: g.setup.campaign?.planet,
        linkedTactical: !!g.setup.linkedTactical
      },
      eligible: runtime.usesBattleDestruction(g.setup),
      layer: !!debris,
      rapier: R ? { version: R.version(), World: typeof R.World } : null,
      world: world ? { step: typeof world.step, bodies: world.bodies.len(), colliders: world.colliders.len() } : null,
      samples: []
    };
    if (!debris || !world) return out;
    // Let the battle settle so the enemy hulls are drawn, then make sure they are
    // visible to the debris layer (the viewer vision gate is what it uses).
    const settle = async (seconds, reveal) => {
      const until = performance.now() + 90000;
      while (w.time < seconds && performance.now() < until) await new Promise(r => setTimeout(r, 100));
      if (reveal) {
        // Spectator-style full vision (the game's own reveal flag), so the hulls
        // the debris layer inspects are actually drawn.
        g.reveal = true;
        w.reveal = true;
        for (const u of w.units) u.seenBy = -1;
      }
      await new Promise(r => setTimeout(r, 600));
    };
    await settle(4, false);
    let enemies = () =>
      w.units
        .filter(u => !u.dead && u.player?.team !== g.human?.team && u.obj?.visible && !u.isPad && !u.isStructure && !u.isSquad)
        .sort((a, b) => (b.visualRadius || 0) - (a.visualRadius || 0));
    if (!enemies().length) await settle(4, true);
    out.revealed = !!(g.reveal && w.reveal);
    g.paused = true;
    const snapshot = () => JSON.stringify({ time: w.time, units: w.units.map(u => [u.x, u.y, u.z, u.health, u.dead ? 1 : 0]) });
    out.diagnostic = {
      human: g.human ? { team: String(g.human.team?.id ?? g.human.team?.name ?? g.human.team), faction: g.human.factionName } : null,
      time: +w.time.toFixed(1),
      units: w.units.length,
      squads: w.squads.length,
      enemyCandidates: enemies().length,
      rows: w.units.slice(0, 12).map(u => ({
        name: u.type?.name,
        team: String(u.player?.team?.id ?? u.player?.team?.name ?? u.player?.team),
        dead: !!u.dead,
        objVisible: !!u.obj?.visible,
        structure: !!u.isStructure,
        pad: !!u.isPad,
        radius: Math.round(u.visualRadius || 0)
      }))
    };
    for (const target of enemies().slice(0, 2)) {
      if (target.dead) continue;
      const name = target.type.name,
        before_bodies = world.bodies.len();
      const had = debris.pieces.length;
      w.kill(target, null);
      const sample = { unit: name, died: !!target.dead, hidden: !target.obj.visible, bodiesAdded: 0, pieces: 0, drift: 0, steps: 0, authored: r.clones.length };
      const until = performance.now() + 8000;
      while (debris.pieces.length <= had && performance.now() < until) r.updateClones(1 / 30);
      const pieces = debris.pieces.slice(had);
      sample.pieces = pieces.length;
      sample.bodiesAdded = world.bodies.len() - before_bodies;
      sample.bodies = world.bodies.len();
      const from = pieces.map(p => p.obj.position.clone());
      for (let i = 0; i < 45 && pieces.length; i++) {
        debris.step(1 / 60);
        sample.steps++;
      }
      sample.drift = +pieces.reduce((n, p, i) => Math.max(n, p.obj.position.distanceTo(from[i])), 0).toFixed(3);
      out.samples.push(sample);
      if (out.samples.find(s => s.pieces)) break;
    }
    out.pieces = debris.pieces.length;
    out.bodies = world.bodies.len();
    const afterDeaths = snapshot();
    for (let i = 0; i < 60; i++) debris.step(1 / 60);
    out.simUnchanged = snapshot() === afterDeaths;
    out.stepped = 60;
    return out;
  });
}

// Resolve through the real victory path: destroy the hostile team (units,
// squads and their base), then press the real CONTINUE control of the summary.
async function resolveBattle(frame, mode) {
  await setArg(frame, mode);
  const deadline = Date.now() + 150000;
  let outcome = null;
  while (Date.now() < deadline) {
    const state = await frame
      .locator('body')
      .evaluate(() => {
        const mode = window.__eawrArg,
          g = window.game,
          w = g?.world;
        if (!w) return { game: false };
        if (g.campaignOutcome)
          return { outcome: { winner: g.campaignOutcome.winner, planet: g.campaignOutcome.planet, mode: g.campaignOutcome.mode } };
        g.paused = false;
        if (mode === 'space') {
          const myTeam = g.human?.team;
          for (const e of [...w.units, ...w.squads]) if (!e.dead && e.player?.team !== myTeam) w.kill(e, null);
        } else {
          const mySide = g.human?.side ?? g.me;
          for (const q of w.squads || []) if (q.side !== mySide) for (const m of q.members || []) if (!m.dead) w.hurt(m, 1e9, null);
          for (const u of w.units) if (!u.dead && u.side >= 0 && u.side !== mySide) w.hurt(u, 1e9, null);
        }
        return { killed: true, time: +w.time.toFixed(1) };
      })
      .catch(e => ({ evalError: e.message }));
    if (state?.outcome) {
      outcome = state.outcome;
      break;
    }
    await sleep(600);
  }
  if (!outcome) {
    const diag = await frame
      .locator('body')
      .evaluate(() => {
        const g = window.game,
          w = g?.world;
        return {
          over: !!g?.over,
          paused: g?.paused,
          time: +(w?.time || 0).toFixed(1),
          mySide: g?.human?.side ?? g?.me,
          winner: w?.winner,
          tacticalWinner: g?.tacticalWinner,
          invasionVictory: g?.invasionVictory ? { left: g.invasionVictory.left } : null,
          bookPending: !!g?.invasionBook?.pending,
          garrisonBusy: w?.garrisonBusy,
          summary: !!g?.summary,
          alive: (w?.units || []).filter(u => !u.dead).map(u => [u.type?.name, u.side, !!u.structure]),
          squadAlive: (w?.squads || []).filter(q => (q.members || []).some(m => !m.dead)).map(q => [q.side, (q.members || []).filter(m => !m.dead).map(m => m.type?.name)])
        };
      })
      .catch(e => ({ evalError: e.message }));
    throw new Error(`no campaign outcome from the real victory path :: ${JSON.stringify(diag)}`);
  }
  const cont = frame.locator('[data-id="IDC_CONTINUE_BUTTON"]').first();
  try {
    await cont.click({ timeout: 45000 });
  } catch {
    const clicked = await frame.locator('body').evaluate(() => {
      const g = window.game;
      if (!g?.campaignOutcome) return false;
      g.returnToGalaxy();
      return true;
    });
    if (!clicked) throw new Error('the battle summary Continue control did not answer');
  }
  return outcome;
}

async function strategicState(frame) {
  return poll(
    frame,
    () => {
      const g = window.game;
      if (!(g?.galaxy && g.ui && g.battles && !g.warming)) return null;
      return {
        campaign: g.galaxy.campaign.name,
        me: g.me,
        time: g.galaxy.time,
        factions: g.galaxy.players.map(p => p.faction),
        planets: g.galaxy.planets.map(p => [p.name, p.owner]),
        credits: g.galaxy.players.map(p => [p.faction, p.credits]),
        planetsHere: g.galaxy.planets.length,
        lastResult: g.lastResult ? { mode: g.lastResult.mode, planet: g.lastResult.planet, winner: g.lastResult.winner } : null,
        linkedMission: !!g.linkedMission,
        battle: !!g.battle
      };
    },
    { timeout: 240000, label: 'restored strategic galaxy' }
  );
}

function compareStrategic(before, after, battleIndex) {
  const changed = [];
  for (let i = 0; i < after.planets.length; i++) {
    const [name, owner] = after.planets[i],
      was = before.owners[i];
    if (was !== undefined && was !== owner) changed.push({ index: i, name, owner, was });
  }
  return {
    campaign: after.campaign === before.campaign,
    planets: after.planets.length === before.owners.length,
    factions: JSON.stringify(after.factions) === JSON.stringify(before.factions),
    timeBackwards: after.time < before.time,
    ownersChanged: changed,
    otherWorldsIntact: changed.every(c => c.index === battleIndex)
  };
}

// ------------------------------------------------------------------ one domain
async function battle(page, frame, mode, order, evidence) {
  evidence[mode] = { order };
  evidence[mode].begin = await pressBegin(page, frame, mode);
  const tactical = await tacticalReady(frame, mode);
  evidence[mode].tactical = tactical;
  assert.equal(tactical.campaign, evidence.family, `${mode}: the tactical battle keeps the campaign identity`);
  assert.equal(tactical.linkedTactical, false, `${mode}: plain campaign battle (not a linked-tactical child)`);
  if (mode === 'land') assert.equal(tactical.planet, order.targetIndex, 'land battle is fought on the invaded world');
  evidence[mode].inspect = mode === 'land' ? await inspectLand(frame) : await inspectSpace(frame);
  if (SCREENSHOT) await page.screenshot({ path: SCREENSHOT.replace('%m', mode) });
  const handedOff = await frame.locator('body').evaluate(() => {
    const snap = window.game.setup.campaign.galaxy;
    return {
      campaign: snap.campaign,
      owners: snap.planets.map(p => p.owner || null),
      factions: (snap.players || []).map(p => p.faction),
      time: snap.time
    };
  });
  evidence[mode].handedOff = { campaign: handedOff.campaign, planets: handedOff.owners.length, time: handedOff.time };
  evidence[mode].outcome = await resolveBattle(frame, mode);
  await readyAfterReturn(frame);
  const after = await strategicState(frame);
  evidence[mode].restored = after;
  evidence[mode].comparison = compareStrategic(handedOff, after, order.targetIndex);
  return evidence[mode];
}

function verify(evidence) {
  assert.deepEqual(evidence.errors, [], 'no uncaught page errors during the handoff');
  for (const mode of WANT) {
    const entry = evidence[mode];
    assert(entry, `${mode}: missing phase`);
    const i = entry.inspect;
    assert(i, `${mode}: no inspection report (the battle never rendered)`);
    assert.equal(i.setup.mode, mode);
    assert.equal(i.setup.campaign, evidence.family, `${mode}: tactical setup carries the campaign`);
    assert.equal(i.setup.linkedTactical, false);
    assert.equal(i.eligible, true, `${mode}: the campaign battle is eligible for Rapier destruction (usesBattleDestruction(setup))`);
    assert(i.layer, `${mode}: the battle built its Rapier debris layer (vehicleWrecks / spaceWrecks)`);
    assert(i.rapier?.version, `${mode}: Rapier reports a version`);
    assert.match(String(i.rapier.version), /^\d+\.\d+/, `${mode}: that version looks like a rapier build (${i.rapier.version})`);
    assert.equal(i.world?.step, 'function', `${mode}: a live Rapier World is in use`);
    const native =
      mode === 'land'
        ? i.samples.filter(s => s.replaced && (s.pieces > 0 || s.dollNodes > 0))
        : i.samples.filter(s => s.pieces > 0);
    assert(native.length, `${mode}: a real damage death produced native ragdoll/debris bodies (${JSON.stringify(i.samples)})`);
    assert(native.some(s => s.bodiesAdded > 0), `${mode}: rigid bodies were added to the Rapier world`);
    if (mode === 'space') {
      assert(native.some(s => s.pieces >= 2), `${mode}: the hull broke into several debris bodies (${JSON.stringify(native)})`);
      assert(native.some(s => s.drift > 0.1), `${mode}: the debris drifted under the Rapier solver (${JSON.stringify(native)})`);
    }
    if (mode === 'land') assert(native.some(s => s.moved > 0.1), `${mode}: the wreck moved under the Rapier solver (${JSON.stringify(native)})`);
    assert(i.bodies > 0, `${mode}: the Rapier world holds bodies after the deaths`);
    assert.equal(i.simUnchanged, true, `${mode}: stepping the debris physics left the tactical simulation untouched`);
    assert(entry.tactical?.campaignGalaxy?.campaign === evidence.family, `${mode}: the tactical setup carries the campaign galaxy snapshot`);
    assert(entry.outcome, `${mode}: the battle produced a campaign outcome through the real victory path`);
    const c = entry.comparison;
    assert(c.campaign, `${mode}: the restored galaxy is the same campaign`);
    assert(c.planets, `${mode}: every world came back`);
    assert(c.factions, `${mode}: every faction came back`);
    assert(!c.timeBackwards, `${mode}: the strategic clock did not go backwards`);
    assert(c.otherWorldsIntact, `${mode}: no world other than the battle's own changed hands (${JSON.stringify(c.ownersChanged)})`);
    assert.equal(entry.restored.battle, false, `${mode}: the strategic galaxy is not left in a battle`);
    assert.equal(entry.restored.linkedMission, false);
  }
}

(async () => {
  const profileDir = path.join(os.tmpdir(), `eawr-handoff-${Date.now()}`);
  const browser = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    args: ['--enable-unsafe-swiftshader'],
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce'
  });
  const evidence = { mode: WANT.join('+'), sessions: [] };
  try {
    const page = browser.pages()[0] || (await browser.newPage());
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (/Using stock unit death|space deaths|authored|rapier|Rapier/.test(m.text())) (evidence.console ||= []).push(m.text().slice(0, 220));
    });

    if (REGRESS) await browser.route('**/js/game/rapier-runtime.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: OLD_RUNTIME }));
    const campaign = await openCampaign(page);
    evidence.family = campaign.family;
    evidence.campaign = { family: campaign.family, roster: campaign.planets, galaxy: campaign.state, intro: campaign.intro };

    // 1) space battle on a hostile world with a defending fleet
    const spaceOrder = await orderSpace(campaign.frame);
    evidence.space = { order: spaceOrder };
    assert(spaceOrder.ok, `no legal space battle order: ${JSON.stringify(spaceOrder)}`);
    const spaceTarget = spaceOrder.targetIndex;
    if (REGRESS) {
      // Same battle, but with the pre-change eligibility gate the tactical game
      // must refuse the debris layer. This is the red state the check exists for.
      evidence.regress = { served: 'pre-change rapier-runtime.js' };
      evidence.space.begin = await pressBegin(page, campaign.frame, 'space');
      evidence.space.tactical = await tacticalReady(campaign.frame, 'space');
      evidence.space.inspect = await inspectSpace(campaign.frame);
      const i = evidence.space.inspect;
      evidence.regress.eligible = i.eligible;
      evidence.regress.layer = i.layer;
      evidence.regress.rejected = i.eligible === false && i.layer === false;
      evidence.ok = evidence.regress.rejected;
      if (SCREENSHOT) await page.screenshot({ path: SCREENSHOT.replace('%m', 'regress') });
      console.log(
        evidence.ok
          ? `REGRESSION DETECTED (expected): campaign ${spaceOrder.target} battle � usesBattleDestruction=${i.eligible} � debris layer=${i.layer}`
          : `REGRESSION MISSED: the check still passed with the pre-change gate (eligible=${i.eligible}, layer=${i.layer})`
      );
      fs.writeFileSync(JSON_OUT, JSON.stringify(evidence, null, 2));
      console.log(`report: ${JSON_OUT}`);
      if (!evidence.ok) process.exitCode = 1;
      return;
    }
    await battle(page, campaign.frame, 'space', spaceOrder, evidence);

    if (WANT.includes('land')) {
      // 2) land battle: same conquest, now with the orbit cleared by that battle
      const landOrder = await orderLand(campaign.frame, spaceTarget);
      evidence.land = { order: landOrder };
      assert(landOrder.ok, `no legal land invasion was available: ${JSON.stringify(landOrder)}`);
      assert.equal(landOrder.targetIndex, spaceTarget, 'the land battle follows the space battle on the same world');
      if (landOrder.needsTravel) {
        await poll(
          campaign.frame,
          () => {
            const target = window.__eawrArg,
              g = window.game,
              fleet = g?.galaxy?.fleets.find(
                f =>
                  f.owner === g.me &&
                  f.planet === target &&
                  !f.leg &&
                  !g.battle &&
                  !g.pendingBattle?.request &&
                  f.units.some(u => !u.dead && u.carries)
              );
            return fleet ? { units: fleet.units.length, companies: fleet.units.filter(u => u.carries).map(u => u.carries.name) } : null;
          },
          { timeout: 240000, label: 'the company fleet reaching orbit', arg: landOrder.targetIndex }
        );
      }
      await campaign.frame.locator('body').evaluate(() => window.game.setFastForward(false));
      const invasion = await invade(campaign.frame, landOrder.targetIndex);
      evidence.land.invasion = invasion;
      assert(invasion.ok, `the real land invasion order was rejected: ${JSON.stringify(invasion)}`);
      await battle(page, campaign.frame, 'land', landOrder, evidence);
    }

    evidence.errors = errors;
    verify(evidence);
    evidence.ok = true;
  } catch (error) {
    evidence.ok = false;
    evidence.failure = error.message;
    console.error(`FAIL: ${error.message}`);
    if (error.stack) console.error(error.stack.split('\n').slice(1, 5).join('\n'));
  } finally {
    await browser.close();
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }
  fs.writeFileSync(JSON_OUT, JSON.stringify(evidence, null, 2));
  for (const mode of WANT) {
    const entry = evidence[mode];
    if (!entry?.inspect) continue;
    const i = entry.inspect;
    const line = `${evidence.ok ? 'PASS' : 'FAIL'} ${mode}: ${entry.order.from} -> ${entry.order.target} · ` +
      `rapier ${i.rapier?.version} · bodies ${i.bodies} · ` +
      i.samples.map(s => `${s.unit}${s.pieces ? ` ${s.pieces}p` : ''}${s.dollNodes ? ` ${s.dollNodes}n` : ''}${s.drift ? ` drift ${s.drift}` : ''}`).join(', ');
    console.log(line);
    if (entry.restored) console.log(`     strategic: ${JSON.stringify(entry.comparison)}`);
  }
  console.log(`report: ${JSON_OUT}`);
  console.log(JSON.stringify({ ok: evidence.ok, failure: evidence.failure }));
  if (!evidence.ok) process.exitCode = 1;
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
