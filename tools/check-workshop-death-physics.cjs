'use strict';
// Mounted Universal integration test for mod-independent death debris.
//
// Scope: this is a test asset only. It never edits the checkout, the Workshop
// library, or a player save. It launches a throwaway Chrome profile and drives
// the already-mounted Universal window at http://127.0.0.1:8590/.
//
// Run:
//   npm run test:physics-workshop   (requires Chrome, playwright-core and mounted Thrawn's Revenge)
//
// The land leg uses the stock ground-offensive encounter (the same mounted path
// as tools/bench-debris/mounted.cjs). A real visible vehicle's opaque draw
// surfaces are muted on the test casualty before death so the fallback is
// guaranteed to be exercised regardless of rig. The space leg follows the real
// Thrawn's Revenge profile (1125571106) through the Universal Instant Battle
// setup, so its deaths are real Workshop units.

const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8590/';
const TR = '1125571106';
const OUT = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'eawr-workshop-deaths-'));
const EVIDENCE = path.join(OUT, 'evidence');
fs.mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const report = {
  baseUrl: BASE,
  generatedAt: new Date().toISOString(),
  checks,
  land: null,
  space: null,
  spaceDraft: null,
  errors: []
};

function assert(ok, msg) {
  if (!ok) throw new Error(msg);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, ok: true, detail: detail ?? null });
    return detail;
  } catch (e) {
    checks.push({ name, ok: false, error: e.message });
    return undefined;
  }
}

function writeReport() {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}

async function newPage(context) {
  // The context uses a throwaway profile directory inside this test folder, so
  // the installed game's saves and the user's normal Chrome profile are not
  // touched.
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    const t = m.text();
    if (/GPUValidationError|THREE.WebGLProgram: Shader Error/.test(t)) errors.push(t.slice(0, 220));
  });
  return { page, errors };
}

async function waitForGame(frame, land) {
  await frame.locator('#loading.hidden').waitFor({ state: 'attached', timeout: 180000 });
  const body = frame.locator('body');
  return body.evaluate(async (_, land) => {
    const t = performance.now();
    while (
      !(land
        ? window.game?.vehicleWrecks && game.ui && !game.warming
        : window.game?.renderer?.spaceWrecks && game.world?.time >= 6)
    ) {
      if (performance.now() - t > 180000) throw new Error('Battle not ready: ' + document.body.innerText.slice(-240));
      await new Promise(r => setTimeout(r, 50));
    }
    return true;
  }, land);
}

// ---------------------------------------------------------------------------
// Land leg: stock ground offensive, real vehicle death, forced unsupported
// fallback by muting the casualty's opaque draw surfaces immediately before
// the real death callback. No product hook or debug flag is used.
// ---------------------------------------------------------------------------
async function runLand(browser) {
  const { page, errors } = await newPage(browser);
  const f = page.frameLocator('#game');
  const body = f.locator('body');
  try {
    await page.goto(BASE + '#ground-offensive');
    await waitForGame(f, true);
    const result = await body.evaluate(async () => {
      const g = window.game,
        w = g.world,
        vw = g.vehicleWrecks,
        residue = vw.residue;
      const raf = () => new Promise(requestAnimationFrame);
      g.paused = false;
      while (w.time < 1.3) await raf();
      g.paused = true;

      const opaqueCount = u => {
        let n = 0;
        u.inst?.root?.traverseVisible(m => {
          if (
            m.isMesh &&
            !m.isInstancedMesh &&
            m.geometry?.attributes.position &&
            !m.material?.transparent &&
            m.material?.visible
          )
            n++;
        });
        return n;
      };
      const candidates = w.units.filter(
        u =>
          u.kind === 'VEHICLE' &&
          !u.dead &&
          !u.foot &&
          !u.structure &&
          !u.flies &&
          u.side >= 0 &&
          u.health > 0 &&
          u.seen !== false &&
          u.holder?.visible &&
          u !== g.openingWreck &&
          opaqueCount(u) > 0
      );
      const used = new Set(),
        usedTypes = new Set();
      const pick = (pred = () => true) => {
        const pool = candidates.filter(v => !used.has(v) && !v.dead && pred(v));
        // Prefer a fresh unit type so the fallback is shown across more than
        // one real vehicle geometry, not only the first walker in the list.
        const u = pool.find(v => !usedTypes.has(v.type?.name)) || pool[0];
        if (u) {
          used.add(u);
          usedTypes.add(u.type?.name);
        }
        return u;
      };

      const lazy = {
        objectBeforeDefined: !!residue,
        emittedBefore: residue?.emitted ?? 0,
        piecesBefore: residue?.pieces?.length ?? 0,
        geoBeforeDefined: !!residue?.geo
      };

      // --- Unsupported visible death: mute every opaque draw surface first.
      const unsupportedUnit = pick();
      if (!unsupportedUnit) throw new Error('No visible stock vehicle for the unsupported land death');
      const muted = [];
      unsupportedUnit.inst.root.traverse(m => {
        if (
          m.isMesh &&
          !m.isInstancedMesh &&
          m.geometry?.attributes.position &&
          !m.material?.transparent &&
          m.material?.visible
        ) {
          m.visible = false;
          muted.push(m);
        }
      });
      const beforeUnsupported = {
        emitted: residue.emitted,
        pieces: residue.pieces.length,
        live: vw.live.length
      };
      w.hurt(unsupportedUnit, 1e8, null);
      // Restore the draw surfaces so the authored death visual can still be
      // observed; the wreck snapshot already ran during the death callback.
      for (const m of muted) m.visible = true;
      const afterUnsupported = {
        emitted: residue.emitted,
        pieces: residue.pieces.length,
        live: vw.live.length
      };
      const piece = residue.pieces.find(p => p.obj?.name === 'Death debris') || residue.pieces.at(-1);
      const colliderGroups = (() => {
        try {
          return piece?.body?.numColliders?.() ? piece.body.collider(0).collisionGroups() : null;
        } catch {
          return null;
        }
      })();
      const unsupported = {
        unit: unsupportedUnit.type?.name || 'unknown',
        kind: unsupportedUnit.kind,
        mutedMeshes: muted.length,
        emittedBefore: beforeUnsupported.emitted,
        emittedAfter: afterUnsupported.emitted,
        piecesBefore: beforeUnsupported.pieces,
        piecesAfter: afterUnsupported.pieces,
        liveBefore: beforeUnsupported.live,
        liveAfter: afterUnsupported.live,
        holderVisible: unsupportedUnit.holder?.visible !== false,
        replaced: vw.replaced.has(unsupportedUnit),
        deathCloneSet: unsupportedUnit.deathClone !== undefined,
        dead: unsupportedUnit.dead === true,
        sample: piece
          ? {
              hasBody: !!piece.body,
              hasObj: !!piece.obj,
              objName: piece.obj?.name || '',
              scale: piece.obj?.scale?.x ?? null,
              bodyIsDynamic: piece.body?.isDynamic?.() ?? null,
              colliderGroups
            }
          : null,
        geoAfterDefined: !!residue.geo
      };

      // --- Supported visible death: intact stock vehicle must use the full
      // authored physics wreck, not the residue fallback.
      const supportedUnit = pick(u => u.type?.name !== unsupportedUnit.type?.name) || pick();
      let supported = null;
      if (supportedUnit) {
        const before = { emitted: residue.emitted, live: vw.live.length };
        w.hurt(supportedUnit, 1e8, null);
        supported = {
          unit: supportedUnit.type?.name || 'unknown',
          emittedBefore: before.emitted,
          emittedAfter: residue.emitted,
          liveBefore: before.live,
          liveAfter: vw.live.length,
          replaced: vw.replaced.has(supportedUnit),
          holderVisible: supportedUnit.holder?.visible !== false
        };
      }

      // --- Visibility negatives: cloaked and seen=false deaths must not
      // disclose residue.
      const negatives = [];
      for (const gate of ['cloaked', 'seen=false']) {
        const u = pick();
        if (!u) break;
        const before = residue.emitted;
        if (gate === 'cloaked') u.cloaked = true;
        else u.seen = false;
        w.hurt(u, 1e8, null);
        negatives.push({
          unit: u.type?.name || 'unknown',
          gate,
          emittedBefore: before,
          emittedAfter: residue.emitted,
          holderVisible: u.holder?.visible !== false
        });
      }

      // --- Gameplay must not be moved by residue physics. Step only the wreck
      // layer while the battle simulation stays paused.
      const tracked = w.units.filter(u => !u.dead).map(u => [u, u.x, u.y, u.z]);
      const timeBefore = w.time;
      for (let i = 0; i < 60; i++) vw.step(1 / 60);
      const moved = tracked.filter(
        ([u, x, y, z]) =>
          Math.abs(u.x - x) > 1e-9 || Math.abs(u.y - y) > 1e-9 || Math.abs(u.z - z) > 1e-9
      ).length;
      const physics = {
        unitsTracked: tracked.length,
        moved,
        steps: 60,
        timeBefore,
        timeAfter: w.time
      };

      return {
        map: g.setup.mapFile,
        units: w.units.length,
        time: w.time,
        lazy,
        unsupported,
        supported,
        negatives,
        physics,
        residueAfter: { emitted: residue.emitted, pieces: residue.pieces.length }
      };
    });
    report.land = result;
    report.land.errors = errors;
  } finally {
    await page.screenshot({ path: path.join(EVIDENCE, 'land.png') }).catch(() => {});
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Space leg: real Thrawn's Revenge Instant Battle through the Universal host.
// Follows tools/bench-debris/mounted.cjs's profile selection, roster packing
// and field-draft remount, then exercises real Workshop combat deaths.
// ---------------------------------------------------------------------------
async function runSpace(browser) {
  const { page, errors } = await newPage(browser);
  const f = page.frameLocator('#game');
  const body = f.locator('body');
  try {
    await page.goto(BASE);
    const title = f.locator('.title-menu [data-id="TITLE_PLAY"]:visible');
    await title.waitFor({ timeout: 120000 });
    await title.click();
    await f.locator('.title-menu [data-id="IDC_INSTANT_BATTLE_BUTTON"]:visible').click();
    const setup = f.locator('.op-setup');
    await setup.getByRole('searchbox').fill('Abregado Rae');
    await setup
      .locator(`[data-world="Abregado_Rae"][data-domain="space"][data-source="${TR}"]`)
      .first()
      .click();
    await f.locator(`.op-setup[data-profile="${TR}"] .op-go:enabled`).waitFor({ timeout: 120000 });

    const count = 24;
    report.spaceDraft = await body.evaluate(async (_, count) => {
      const { instantRoster, INSTANT_BUDGET_MAX: budget } = await import('/js/game/instantbattle.js');
      const players = ['Empire', 'Rebel'].map((faction, team) => {
        const rows = instantRoster(faction).filter(r => !r.hero);
        const capital = rows.filter(r => r.cls >= 5).sort((a, b) => a.cost - b.cost),
          esc = rows.filter(r => r.cls >= 2 && r.cls <= 4).sort((a, b) => a.cost - b.cost),
          fighters = rows.filter(r => r.cls <= 1);
        if (!capital.length || !esc.length) throw Error('No capital/escort roster for ' + faction);
        const leads =
          capital.find(r =>
            /IMPERIAL_I_STAR_DESTROYER|^(?:GENERIC_)?STAR_DESTROYER$|MC80_HOME_ONE_TYPE/i.test(r.name)
          ) || capital[0];
        const army = Array.from({ length: count }, (_, i) =>
          i < 4
            ? leads.name
            : i % 4 === 0 && fighters.length
              ? fighters[0].name
              : esc[i % Math.min(esc.length, 4)].name
        );
        return { faction, team, budget, kind: team ? 'medium' : 'you', army };
      });
      localStorage.setItem('swr-instant-setup', JSON.stringify({ turn: 0, budget, players }));
      return players.map(p => [p.faction, p.army[0], p.army.length]);
    }, count);

    const next = page.waitForEvent('framenavigated', {
      predicate: fr => fr.parentFrame() === page.mainFrame() && fr.url().includes('field-draft='),
      timeout: 30000
    });
    await body.evaluate(async (_, id) => {
      const draft = JSON.parse(localStorage.getItem('swr-instant-setup')),
        { packArmy } = await import('/js/game/instantforces.js');
      draft.kind = 'instant';
      for (const p of draft.players) {
        p.counts = packArmy(p.army.sort());
        delete p.army;
      }
      parent.postMessage(
        {
          kind: 'universal-field',
          id,
          mode: 'instant',
          world: 'Abregado_Rae',
          domain: 'space',
          query: 'Abregado Rae',
          draft
        },
        '*'
      );
    }, TR);
    await next;

    const board = f.locator(`.op-setup[data-profile="${TR}"]`);
    await board.getByRole('searchbox').fill('Abregado Rae');
    await board
      .locator(`[data-world="Abregado_Rae"][data-domain="space"][data-source="${TR}"]`)
      .first()
      .click();
    await board.locator('.op-go:enabled').click();
    await waitForGame(f, false);

    const result = await body.evaluate(async () => {
      const g = window.game,
        w = g.world,
        r = g.renderer,
        sw = r.spaceWrecks,
        residue = sw.residue;
      g.paused = true;
      const profile =
        document.querySelector('meta[name="swr-pack-revision"]')?.content.split(':')[0] || 'unknown';
      const lazy = {
        objectBeforeDefined: !!residue,
        emittedBefore: residue.emitted,
        piecesBefore: residue.pieces.length,
        geoBeforeDefined: !!residue.geo
      };
      const visible = w.units.filter(
        u =>
          !u.dead &&
          u.isMobile &&
          u.obj?.visible &&
          u.model &&
          u.world?.viewerSees(u) &&
          !u.hyper &&
          !u.scriptHidden &&
          !u.cloaked
      );
      const used = new Set(),
        usedTypes = new Set();
      const pickOne = pred => {
        const pool = visible.filter(v => !used.has(v) && !v.dead && pred(v));
        // Prefer a fresh type so the capital, escort and fighter deaths are not
        // all the same hull class.
        const u = pool.find(v => !usedTypes.has(v.type?.name)) || pool[0];
        if (u) {
          used.add(u);
          usedTypes.add(u.type?.name);
        }
        return u;
      };
      const deaths = [];
      const kill = (label, u) => {
        const before = {
          emitted: residue.emitted,
          pieces: residue.pieces.length,
          clones: r.clones.length,
          sw: sw.pieces.length
        };
        w.kill(u, null);
        const after = {
          emitted: residue.emitted,
          pieces: residue.pieces.length,
          clones: r.clones.length,
          sw: sw.pieces.length
        };
        const newClones = r.clones.slice(before.clones);
        const piece = residue.pieces.at(-1);
        const colliderGroups = (() => {
          try {
            return piece?.body?.numColliders?.() ? piece.body.collider(0).collisionGroups() : null;
          } catch {
            return null;
          }
        })();
        const nc = newClones[0];
        deaths.push({
          label,
          unit: u.type?.name || 'unknown',
          isFighter: !!u.isFighter,
          visualRadius: u.visualRadius,
          emittedBefore: before.emitted,
          emittedAfter: after.emitted,
          piecesBefore: before.pieces,
          piecesAfter: after.pieces,
          clonesBefore: before.clones,
          clonesAfter: after.clones,
          swPiecesBefore: before.sw,
          swPiecesAfter: after.sw,
          branch:
            after.clones > before.clones
              ? 'authored-clone'
              : after.sw > before.sw
                ? 'full-breakup'
                : 'no-authored-visual',
          sample: piece
            ? {
                hasBody: !!piece.body,
                hasObj: !!piece.obj,
                objName: piece.obj?.name || '',
                scale: piece.obj?.scale?.x ?? null,
                colliderGroups
              }
            : null,
          newClone: nc
            ? {
                flight: !!nc.flight,
                limit: nc.limit,
                releaseAt: nc.releaseAt,
                hasPath: !!nc.path,
                hasState: !!nc.state,
                holderVisible: nc.holder?.visible !== false
              }
            : null
        });
        return { u, before, after, newClones };
      };

      const capital = pickOne(u => !u.isFighter && u.visualRadius > 20);
      if (!capital) throw new Error('No visible capital ship for the space death');
      const cap = kill('capital', capital);
      const escort = pickOne(u => !u.isFighter);
      if (escort) kill('escort', escort);
      const fighter = pickOne(u => u.isFighter);
      if (fighter) kill('fighter', fighter);

      // --- Burst: every additional visible combat death must also emit, even
      // if the authored clone/breakup budgets are already busy.
      const burst = { attempted: 0, emittedBefore: residue.emitted, emittedAfter: 0, units: [] };
      for (let i = 0; i < 8; i++) {
        const u = pickOne(() => true);
        if (!u) break;
        burst.attempted++;
        w.kill(u, null);
        burst.units.push(u.type?.name || 'unknown');
      }
      burst.emittedAfter = residue.emitted;

      // --- Full authored breakup must still release its own sections.
      let fullBreakup = null;
      const clone = cap.newClones.find(
        c => c.flight && Number.isFinite(c.limit) && Number.isFinite(c.releaseAt)
      );
      if (clone) {
        const before = sw.pieces.length;
        clone.age = clone.releaseAt + 0.02;
        r.updateClones(1 / 60);
        fullBreakup = {
          path: 'clone-releaseAt',
          piecesBefore: before,
          piecesAfter: sw.pieces.length,
          released: sw.pieces.length > before,
          clone: { limit: clone.limit, releaseAt: clone.releaseAt, age: clone.age }
        };
      } else {
        const nc = cap.newClones[0];
        const before = sw.pieces.length;
        const spawned = nc?.holder
          ? sw.spawn(nc.holder, { x: 0, y: 0, z: 0 }, cap.u.visualRadius, nc.inst)
          : 0;
        fullBreakup = {
          path: 'direct-spawn',
          piecesBefore: before,
          piecesAfter: sw.pieces.length,
          spawned,
          released: sw.pieces.length > before
        };
      }

      // --- Visibility negatives: cloaked, hyper, scriptHidden and hidden
      // object deaths must not emit residue.
      const negatives = [];
      for (const gate of ['cloaked', 'hyper', 'scriptHidden', 'objHidden']) {
        const u = pickOne(() => true);
        if (!u) break;
        const before = residue.emitted;
        if (gate === 'cloaked') u.cloaked = true;
        else if (gate === 'hyper') u.hyper = true;
        else if (gate === 'scriptHidden') u.scriptHidden = true;
        else if (gate === 'objHidden') u.obj.visible = false;
        w.kill(u, null);
        negatives.push({
          unit: u.type?.name || 'unknown',
          gate,
          emittedBefore: before,
          emittedAfter: residue.emitted
        });
      }

      // --- Residue and full-breakup physics must not move gameplay ships.
      const tracked = w.units.filter(u => !u.dead).map(u => [u, u.x, u.y, u.z]);
      const timeBefore = w.time;
      for (let i = 0; i < 30; i++) sw.step(1 / 60, w);
      const moved = tracked.filter(
        ([u, x, y, z]) =>
          Math.abs(u.x - x) > 1e-9 || Math.abs(u.y - y) > 1e-9 || Math.abs(u.z - z) > 1e-9
      ).length;
      const physics = {
        shipsTracked: tracked.length,
        moved,
        steps: 30,
        timeBefore,
        timeAfter: w.time
      };

      return {
        profile,
        map: g.setup.mapFile,
        units: w.units.length,
        backend: r.gpu ? 'webgpu' : 'webgl',
        lazy,
        deaths,
        burst,
        fullBreakup,
        negatives,
        physics,
        residueAfter: { emitted: residue.emitted, pieces: residue.pieces.length }
      };
    });
    report.space = result;
    report.space.errors = errors;
  } finally {
    await page.screenshot({ path: path.join(EVIDENCE, 'space.png') }).catch(() => {});
    await page.close();
  }
}

// ---------------------------------------------------------------------------
async function main() {
  const profileDir = path.join(OUT, '.chrome-profile');
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    viewport: { width: 1280, height: 720 },
    reducedMotion: 'reduce',
    args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling']
  });
  try {
    for (const p of context.pages()) await p.close().catch(() => {});
    report.chrome = context.browser()?.version() || 'unknown';
    report.cpu = require('node:os').cpus()[0]?.model || 'unknown';

    try {
      await runLand(context);
    } catch (e) {
      report.land = { fatal: e.message };
    }
    try {
      await runSpace(context);
    } catch (e) {
      report.space = { fatal: e.message };
    }

    // ----------------------------- land checks -----------------------------
    await check('land: residue contract exists before the first forced fallback', () => {
      const l = report.land;
      assert(l && !l.fatal, `land leg failed: ${l?.fatal || 'no result'}`);
      assert(l.lazy.objectBeforeDefined, 'game.vehicleWrecks.residue is missing');
      assert(l.lazy.piecesBefore === 0, `expected 0 residue pieces before first death, got ${l.lazy.piecesBefore}`);
      assert(!l.lazy.geoBeforeDefined, 'residue geometry/material was allocated before any emission (not lazy)');
    });
    await check('land: unsupported visible death emits additive residue pieces', () => {
      const u = report.land?.unsupported;
      assert(u, 'no unsupported land result');
      assert(u.mutedMeshes > 0, 'no opaque draw surfaces were muted on the test casualty');
      assert(u.dead, 'test casualty did not die');
      assert(u.emittedAfter > u.emittedBefore, `residue.emitted did not grow (${u.emittedBefore} -> ${u.emittedAfter})`);
      assert(u.piecesAfter > u.piecesBefore, `residue.pieces did not grow (${u.piecesBefore} -> ${u.piecesAfter})`);
      assert(u.sample?.hasBody && u.sample?.hasObj, 'residue piece is missing {body,obj}');
      assert(u.geoAfterDefined, 'residue geometry was not created on first emission');
    });
    await check('land: fallback leaves the authored death visual in place', () => {
      const u = report.land?.unsupported;
      assert(u, 'no unsupported land result');
      assert(u.holderVisible, 'holder was hidden, so the authored death visual was replaced');
      assert(!u.replaced, 'fallback casualty was registered as a full physics wreck');
      assert(u.deathCloneSet, 'the authored death clone path did not run');
      assert(u.liveAfter === u.liveBefore, 'fallback created a full vehicle wreck');
    });
    await check('land: supported visible death uses the authored wreck and no residue', () => {
      const s = report.land?.supported;
      assert(s, 'no supported vehicle was available');
      assert(s.replaced, 'supported vehicle was not captured as a physics wreck');
      assert(s.liveAfter > s.liveBefore, 'full vehicle wreck pool did not grow');
      assert(s.emittedAfter === s.emittedBefore, `residue emitted for a supported death (${s.emittedBefore} -> ${s.emittedAfter})`);
    });
    await check('land: visibility negatives do not disclose residue', () => {
      const n = report.land?.negatives || [];
      assert(n.length >= 1, 'no land visibility negative was tested');
      for (const x of n)
        assert(x.emittedAfter === x.emittedBefore, `${x.gate} death emitted residue (${x.emittedBefore} -> ${x.emittedAfter})`);
    });
    await check('land: residue physics does not move gameplay units', () => {
      const p = report.land?.physics;
      assert(p, 'no land physics result');
      assert(p.moved === 0, `${p.moved} of ${p.unitsTracked} gameplay units moved during residue physics`);
      assert(p.timeAfter === p.timeBefore, 'game time advanced while paused');
    });
    await check('land: residue is small and collision-isolated', () => {
      const s = report.land?.unsupported?.sample;
      assert(s, 'no land residue sample');
      assert(s.scale > 0 && s.scale <= 8, `residue scale ${s.scale} is not small`);
      assert(s.colliderGroups === 0, `residue collider groups ${s.colliderGroups} can interact`);
    });
    await check('land: no page errors', () => {
      const e = report.land?.errors || [];
      assert(e.length === 0, e.join(' | '));
    });

    // ----------------------------- space checks ----------------------------
    await check("space: mounted through Thrawn's Revenge profile", () => {
      const s = report.space;
      assert(s && !s.fatal, `space leg failed: ${s?.fatal || 'no result'}`);
      assert(s.profile === TR, `profile ${s.profile} != ${TR}`);
      assert(s.units > 0, 'no space units');
    });
    await check('space: residue contract exists before forced deaths', () => {
      const l = report.space?.lazy;
      assert(l, 'no space residue');
      assert(l.objectBeforeDefined, 'renderer.spaceWrecks.residue is missing');
      assert(l.piecesBefore >= 0, 'bad residue piece count');
      if (l.emittedBefore === 0)
        assert(!l.geoBeforeDefined, 'residue geometry/material was allocated before any emission (not lazy)');
    });
    await check('space: visible combat deaths emit additive physical debris', () => {
      const d = report.space?.deaths || [];
      assert(d.length >= 2, `only ${d.length} visible combat deaths were exercised`);
      for (const x of d) {
        assert(x.emittedAfter > x.emittedBefore, `${x.label} ${x.unit} emitted ${x.emittedBefore} -> ${x.emittedAfter}`);
        assert(x.piecesAfter > 0, `${x.label} ${x.unit} produced no residue pieces`);
        assert(x.sample?.hasBody && x.sample?.hasObj, `${x.label} ${x.unit} residue piece is missing {body,obj}`);
        assert(x.sample.scale > 0 && x.sample.scale <= 16, `${x.label} ${x.unit} residue scale ${x.sample.scale} is not small`);
        assert(
          x.sample.colliderGroups === 0,
          `${x.label} ${x.unit} residue collider groups ${x.sample.colliderGroups} can interact`
        );
      }
      assert(
        d.some(x => x.branch === 'authored-clone'),
        'no authored death clone was retained alongside residue'
      );
    });
    await check('space: every visible death in a burst emits residue', () => {
      const b = report.space?.burst;
      assert(b, 'no space burst result');
      assert(b.attempted >= 4, `burst only attempted ${b.attempted} visible deaths`);
      assert(
        b.emittedAfter - b.emittedBefore === b.attempted,
        `burst emitted ${b.emittedAfter - b.emittedBefore} for ${b.attempted} visible deaths`
      );
    });
    await check('space: full ship breakup still releases normally', () => {
      const f = report.space?.fullBreakup;
      assert(f, 'no full-breakup result');
      assert(f.released, `${f.path} did not release sections (${f.piecesBefore} -> ${f.piecesAfter})`);
    });
    await check('space: visibility negatives do not emit residue', () => {
      const n = report.space?.negatives || [];
      assert(n.length >= 1, 'no space visibility negative was tested');
      for (const x of n)
        assert(x.emittedAfter === x.emittedBefore, `${x.gate} death emitted residue (${x.emittedBefore} -> ${x.emittedAfter})`);
    });
    await check('space: residue physics does not move gameplay ships', () => {
      const p = report.space?.physics;
      assert(p, 'no space physics result');
      assert(p.moved === 0, `${p.moved} of ${p.shipsTracked} gameplay ships moved during residue physics`);
      assert(p.timeAfter === p.timeBefore, 'game time advanced while paused');
    });
    await check('space: no page errors', () => {
      const e = report.space?.errors || [];
      assert(e.length === 0, e.join(' | '));
    });
  } finally {
    await context.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
    report.pass = checks.every(c => c.ok);
    writeReport();
  }

  const failed = checks.filter(c => !c.ok);
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : ' :: ' + c.error}`);
  console.log(`\nreport: ${path.join(OUT, 'report.json')}`);
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll checks passed.');
  }
}

main().catch(e => {
  report.fatal = e.stack || e.message;
  report.pass = false;
  writeReport();
  console.error(e);
  process.exitCode = 1;
});
