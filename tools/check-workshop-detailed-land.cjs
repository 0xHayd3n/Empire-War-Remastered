'use strict';
// Mounted Universal integration check: real Workshop LAND battle, real kill
// callbacks, last-pose infantry ragdoll and a multi-piece vehicle wreck.
//
// Run: npm run test:physics-workshop-land (Chrome, playwright-core, mounted packs).
// Report, captures and a throwaway browser profile go to a fresh temp directory.
//
// The battle is a real Instant Battle: Thrawn's Revenge profile 1125571106
// on its own _MP_LAND_GROUNDWAR_M.TED map. One side uses the mod's own
// Galactic Empire (Imperial Stormtrooper infantry). The other side is a real
// guest armour company from another mounted Workshop mod (Awakening of the
// Rebellion AT-AT Company), because TR's own default land forces are
// infantry-only. No skin swap, no injected roster and no debug flag is used to
// make the wreck succeed: both casualties are killed through world.hurt(), the
// same path live combat uses, and the wreck layer's public state is observed.
//
// Space is exercised separately by npm run test:physics-workshop.
//
// Exit code is 0 only when every check passes. A red run is a real result: the
// raw observations in report.json say which contract failed.

const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8590/';
const SOURCE = path.resolve(__dirname, '..');
const TR = '1125571106';
const APOS = '\u2019';
const DOT = '\u00b7';
const TR_EMPIRE = `Galactic Empire ${DOT} Thrawn${APOS}s Revenge`;
const GUEST_CANDIDATES = [
  {
    profile: '1397421866',
    label: `Galactic Empire ${DOT} Awakening of the Rebellion`,
    company: 'AT-AT Company'
  },
  {
    profile: '1770851727',
    label: `Galactic Empire ${DOT} Empire at War: Remake`,
    company: 'AT-AT Walker Company'
  },
  {
    profile: '1976399102',
    label: `Galactic Republic ${DOT} Fall of the Republic`,
    company: 'A6 Juggernaut'
  }
];
const OUT = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'eawr-workshop-land-'));
const EVIDENCE = path.join(OUT, 'evidence');
fs.mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const report = {
  baseUrl: BASE,
  source: SOURCE,
  generatedAt: new Date().toISOString(),
  sourceFingerprint: null,
  chrome: null,
  cpu: null,
  battle: null,
  infantry: null,
  vehicle: null,
  cleanup: null,
  checks,
  errors: []
};

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
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
function fingerprint() {
  const rows = [
    'public/js/game/landgame.js',
    'public/js/game/vehicle-wrecks.js',
    'public/js/game/infantry-ragdoll.js',
    'public/js/game/infantry-articulation.js',
    'public/js/game/death-fragments.js',
    'public/js/game/hull-cut-cache.js',
    'public/js/game/wreck-skin.js',
    'public/js/game/posecache.js'
  ].map(rel => {
    const file = path.join(SOURCE, rel);
    try {
      const s = fs.statSync(file);
      return { file: rel, size: s.size, mtime: s.mtime.toISOString() };
    } catch {
      return { file: rel, missing: true };
    }
  });
  return rows;
}
function round(v, n = 3) {
  return Number.isFinite(v) ? +v.toFixed(n) : v;
}

// ---------------------------------------------------------------------------
// Real UI mount: stock title -> Instant Battle -> a land battlefield belonging
// to the TR profile. Selecting a guest row remounts the board under that
// profile; the second click is the real land setup.
// ---------------------------------------------------------------------------
async function mountLandBattle(page) {
  const f = page.frameLocator('#game');
  await page.goto(BASE);
  const title = f.locator('.title-menu [data-id="TITLE_PLAY"]:visible');
  await title.waitFor({ timeout: 120000 });
  await title.click();
  await f.locator('.title-menu [data-id="IDC_INSTANT_BATTLE_BUTTON"]:visible').click();
  const setup = f.locator('.op-setup');
  await setup.waitFor({ timeout: 60000 });
  await setup.getByRole('searchbox').fill('Tatooine');
  await page.waitForTimeout(1200);

  const landRow = setup.locator(`[data-world="Tatooine"][data-domain="land"][data-source="${TR}"]`).first();
  await landRow.waitFor({ timeout: 30000 });
  const remount = page.waitForEvent('framenavigated', {
    predicate: fr => fr.parentFrame() === page.mainFrame(),
    timeout: 60000
  });
  await landRow.click();
  await remount;

  const board = f.locator(`.op-setup[data-profile="${TR}"]`);
  await board.waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  await board.getByRole('searchbox').fill('Tatooine');
  await page.waitForTimeout(1200);
  const mapRow = board
    .locator(`[data-world="Tatooine"][data-domain="land"][data-source="${TR}"]`)
    .filter({ hasText: 'Ground War' })
    .first();
  await mapRow.waitFor({ timeout: 30000 });
  const mapTitle = (await mapRow.textContent())?.trim();
  await mapRow.click();
  await page.waitForTimeout(2500);

  await board.getByRole('tab', { name: /Forces/i }).click();
  await page.waitForTimeout(300);

  const factions = () => board.locator('select:not([aria-label])');
  await factions().nth(0).selectOption({ label: TR_EMPIRE });
  await page.waitForTimeout(4500);

  let picked = null;
  for (const candidate of GUEST_CANDIDATES) {
    const optionLabels = await factions().nth(1).locator('option').allTextContents();
    if (!optionLabels.includes(candidate.label)) continue;
    await factions().nth(1).selectOption({ label: candidate.label });
    const company = board.locator('select[aria-label="Opponent company"]');
    let labels = [];
    try {
      await company.waitFor({ state: 'visible', timeout: 20000 });
      for (let i = 0; i < 30; i++) {
        labels = await company.locator('option').allTextContents();
        if (labels.includes(candidate.company)) break;
        await page.waitForTimeout(500);
      }
    } catch {
      labels = [];
    }
    if (!labels.includes(candidate.company)) continue;
    await company.selectOption({ label: candidate.company });
    for (let i = 0; i < 40 && (await board.locator('.op-go').isDisabled()); i++) await page.waitForTimeout(500);
    if (await board.locator('.op-go').isDisabled()) continue;
    picked = { ...candidate, companyLabels: labels };
    break;
  }
  assert(picked, 'No mounted guest armour company was selectable for the opponent');

  await board.locator('.op-go:enabled').click();
  await page.waitForTimeout(2000);
  await f.locator('#loading.hidden').waitFor({ state: 'attached', timeout: 180000 });

  const body = f.locator('body');
  const ready = await body.evaluate(async () => {
    const deadline = performance.now() + 180000;
    while (!(window.game?.vehicleWrecks && game.ui && !game.warming)) {
      if (performance.now() > deadline) throw new Error('Land battle did not become ready: ' + document.body.innerText.slice(-240));
      await new Promise(r => setTimeout(r, 100));
    }
    return true;
  });
  assert(ready, 'Battle not ready');
  return {
    page,
    frame: f,
    body,
    mapTitle,
    config: { profile: TR, yourFaction: TR_EMPIRE, opponent: picked.label, opponentCompany: picked.company, opponentProfile: picked.profile, companyLabels: picked.companyLabels }
  };
}

// ---------------------------------------------------------------------------
// Land observations: real kills, ragdoll skin/palette, wreck pieces, cleanup.
// ---------------------------------------------------------------------------
async function observeBattle(body) {
  return body.evaluate(async () => {
    const raf = () => new Promise(requestAnimationFrame);
    const g = window.game;
    const w = g.world;
    const vw = g.vehicleWrecks;
    const res = vw.residue;
    const wld = vw.world;
    const native = () => ({ bodies: wld.bodies.len(), colliders: wld.colliders.len(), joints: wld.impulseJoints.len() });
    const unitSnapshot = u => ({ x: u.x, y: u.y, z: u.z });
    const r3 = v => (Number.isFinite(v) ? +v.toFixed(3) : v);
    const out = { errors: [], config: { keepBodies: vw.keepBodies?.() === true } };

    g.paused = true;
    await raf();

    const visible = w.units.filter(
      u => !u.dead && u.holder?.visible && !u.cloaked && u.seen !== false && !u.inside && !u.scriptHidden && !u.netHidden
    );
    out.units = {
      total: w.units.length,
      infantry: visible.filter(u => u.foot && u.kind === 'INFANTRY').length,
      vehicles: visible.filter(u => u.kind === 'VEHICLE' && !u.foot && !u.structure && !u.flies).length
    };
    out.battle = {
      map: g.setup.mapFile,
      mapId: g.setup.planetBattle?.id || null,
      backend: g.gpuOn ? 'webgpu' : 'webgl',
      pack: document.querySelector('meta[name="swr-pack-revision"]')?.content?.split(':')[0] || null,
      instantArmies: g.setup.instant?.groundArmies?.map(a => a.slice(0, 4)) || null,
      time: w.time
    };
    const counted = {};
    for (const u of visible) counted[u.type?.name || '?'] = (counted[u.type?.name || '?'] || 0) + 1;
    out.types = counted;

    const inf = visible.find(
      u => u.foot && u.kind === 'INFANTRY' && u.inst?.skins?.length && u.inst?.bones?.length > 10 && u.side >= 0
    );
    const veh = visible
      .filter(u => u.kind === 'VEHICLE' && !u.foot && !u.flies && !u.structure && u.side >= 0 && u.inst?.root)
      .sort((a, b) => (b.visualRadius || 0) - (a.visualRadius || 0))[0];
    if (!inf) throw Error('No rigged visible mod infantryman in the battle');
    if (!veh) throw Error('No visible mod vehicle in the battle');

    // Aim the live camera at the two real casualties for the evidence shot.
    Object.assign(g.view, {
      x: (inf.x + veh.x) / 2,
      y: (inf.y + veh.y) / 2,
      dist: Math.max(170, Math.min(430, Math.hypot(inf.x - veh.x, inf.y - veh.y) * 0.95)),
      pitch: 1.08
    });

    // ---- last live pose, realized exactly as the ragdoll builder will use it.
    const { settlePose } = await import('/js/game/posecache.js');
    settlePose(inf.inst);
    inf.holder.updateWorldMatrix(true, true);
    inf.inst.syncSkins();
    const prePose = [];
    inf.inst.root.traverseVisible(m => {
      if (!m.isMesh || !m.material?.uniforms?.boneMatrices?.value) return;
      prePose.push({
        key: m.geometry.uuid + '|' + m.material.uuid,
        geo: m.geometry.uuid,
        values: Array.from(m.material.uniforms.boneMatrices.value)
      });
    });

    const stillInf = unitSnapshot(inf);
    const stillVeh = unitSnapshot(veh);
    const baseline = native();
    const residueBefore = { emitted: res.emitted, pieces: res.pieces.length };
    const liveBefore = vw.live.length;

    // ---- real infantry kill callback.
    w.hurt(inf, 1e8, null);
    const infWreck = vw.live.at(-1);
    const doll = infWreck?.doll || null;
    if (!doll) throw Error('Infantry death did not create a ragdoll (fallback would be residue)');

    const meshInfo = m => ({
      geo: m.geometry?.uuid,
      mat: m.material?.uuid,
      skinned: !!m.material?.defines?.SKINNED,
      visible: m.visible !== false && m.material?.visible !== false,
      palette: m.material?.uniforms?.boneMatrices?.value?.length || 0
    });
    const dollMeshes = [];
    doll.root.traverse(o => {
      if (o.isMesh) dollMeshes.push(meshInfo(o));
    });
    const infGeos = [];
    inf.inst.root.traverseVisible(o => {
      if (o.isMesh && o.geometry) infGeos.push(o.geometry);
    });
    const infAttrs = infGeos.map(g => g.attributes?.position).filter(Boolean);
    let realMeshes = 0;
    doll.root.traverse(o => {
      if (!o.isMesh) return;
      if (infGeos.includes(o.geometry) || (o.geometry?.attributes?.position && infAttrs.includes(o.geometry.attributes.position))) realMeshes++;
    });
    const dollSkinned = doll.root.children.filter(m => m.isMesh && m.material?.defines?.SKINNED);
    const dollRigid = doll.root.children.filter(m => m.isMesh && !m.material?.defines?.SKINNED);

    const readPalettes = () => {
      const rows = [];
      doll.root.traverse(m => {
        if (!m.isMesh || !m.material?.uniforms?.boneMatrices) return;
        m.onBeforeRender?.();
        rows.push({
          key: m.geometry.uuid + '|' + m.material.uuid,
          values: Array.from(m.material.uniforms.boneMatrices.value)
        });
      });
      return rows;
    };
    const maxDiff = (a, b) => {
      if (!a || !b) return Infinity;
      let d = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) d = Math.max(d, Math.abs(a[i] - b[i]));
      return d;
    };
    const initialPalettes = readPalettes();
    // Last-pose check: for each doll palette find the closest pre-death palette
    // with the same geometry+material key, or the same geometry.
    let lastPoseMax = 0;
    let lastPoseMatched = 0;
    for (const row of initialPalettes) {
      const sameKey = prePose.filter(p => p.key === row.key);
      const sameGeo = prePose.filter(p => p.geo === row.key.split('|')[0]);
      const pool = sameKey.length ? sameKey : sameGeo;
      if (!pool.length) continue;
      lastPoseMatched++;
      lastPoseMax = Math.max(lastPoseMax, Math.min(...pool.map(p => maxDiff(p.values, row.values))));
    }
    const node0 = doll.nodes.map(s => [s.position.x, s.position.y, s.position.z]);
    const rigid0 = dollRigid.map(m => Array.from(m.matrix.elements));

    // Step only the cosmetic wreck layer: gameplay stays paused.
    for (let i = 0; i < 45; i++) vw.step(1 / 60);

    const node1 = doll.nodes.map(s => [s.position.x, s.position.y, s.position.z]);
    const nodeMove = node0.map((p, i) => Math.hypot(p[0] - node1[i][0], p[1] - node1[i][1], p[2] - node1[i][2]));
    const laterPalettes = readPalettes();
    let paletteMoved = 0;
    for (let i = 0; i < Math.min(initialPalettes.length, laterPalettes.length); i++)
      paletteMoved = Math.max(paletteMoved, maxDiff(initialPalettes[i].values, laterPalettes[i].values));
    let rigidMoved = 0;
    for (let i = 0; i < dollRigid.length; i++) {
      const later = Array.from(dollRigid[i].matrix.elements);
      rigidMoved = Math.max(rigidMoved, maxDiff(rigid0[i], later));
    }
    out.infantry = {
      type: inf.type?.name,
      kind: inf.kind,
      side: inf.side,
      rig: {
        skins: inf.inst?.skins?.length || 0,
        flat: inf.inst?.flat ?? null,
        skinMask: inf.inst?.skinMask ?? null,
        bones: inf.inst?.bones?.length || 0,
        rootChildren: inf.inst?.root?.children?.length || 0
      },
      doll: {
        rootInScene: doll.root.parent === g.scene,
        rootVisible: doll.root.visible !== false,
        nodes: doll.nodes.length,
        nodeNames: doll.nodes.map(n => n.name),
        joints: doll.nodes.filter(n => n.joint).length,
        skinnedMeshes: dollSkinned.length,
        rigidMeshes: dollRigid.length,
        meshes: dollMeshes.length,
        realMeshes,
        palettes: dollMeshes.filter(m => m.palette > 0).map(m => m.palette),
        allMeshesVisible: dollMeshes.every(m => m.visible),
        lastPoseMax,
        lastPoseMatched,
        paletteMoved,
        rigidMoved,
        nodeMoveMax: +(Math.max(...nodeMove)).toFixed(4),
        detached: doll.detached || null
      },
      simulated: { before: stillInf, after: unitSnapshot(inf), unchanged: [inf.x, inf.y, inf.z].every((v, i) => v === [stillInf.x, stillInf.y, stillInf.z][i]) },
      replaced: vw.replaced.has(inf),
      holderVisible: inf.holder?.visible,
      dead: inf.dead === true,
      residueBefore,
      residueAfterInf: { emitted: res.emitted, pieces: res.pieces.length },
      liveBefore,
      liveAfterInf: vw.live.length
    };

    // ---- real vehicle kill callback.
    const intermediate = native();
    const vehResidueBefore = { emitted: res.emitted, pieces: res.pieces.length };
    w.hurt(veh, 1e8, null);
    const vehWreck = vw.live.at(-1);
    if (!vehWreck) throw Error('Vehicle death did not create a wreck');
    const pieces = vehWreck.pieces || [];
    const nativeGeos = new Set();
    const nativeMats = new Set();
    const allGeos = new Set();
    veh.inst?.root?.traverse(o => {
      if (!o.isMesh) return;
      allGeos.add(o.geometry);
      if (o.material) nativeMats.add(o.material);
      if (o.visible !== false && o.material?.visible !== false) nativeGeos.add(o.geometry);
    });
    const sourceAttrs = [...allGeos].map(g => g.attributes?.position).filter(Boolean);
    const residueGeo = res.geo || null;
    const residueMat = res.material || null;
    const rows = [];
    let unexplained = 0,
      residueOrigins = 0;
    for (const [i, part] of pieces.entries()) {
      const meshes = part.root.children.filter(m => m.isMesh);
      const info = meshes.map(m => {
        const geo = m.geometry;
        const mat = m.material;
        let origin = 'unexplained';
        if (geo === residueGeo || mat === residueMat) origin = 'residue';
        else if (allGeos.has(geo)) origin = 'reuse';
        else if (geo?.userData?.battleCut) origin = 'hull-cut';
        else if (geo?.attributes?.position && sourceAttrs.includes(geo.attributes.position)) origin = 'skin-island';
        const surface = !!(mat?.map || mat?.vertexColors || mat?.color || mat?.uniforms);
        if (origin === 'unexplained') unexplained++;
        if (origin === 'residue') residueOrigins++;
        return {
          geo: geo?.uuid,
          origin,
          geomType: geo?.type,
          indexed: !!geo?.index,
          vertices: geo?.attributes?.position?.count || 0,
          material: mat?.type,
          materialVisible: mat?.visible !== false,
          transparent: mat?.transparent === true,
          additive: mat?.userData?.additive === true,
          surface,
          map: !!mat?.map
        };
      });
      rows.push({
        index: i,
        visible: part.root.visible !== false && part.root.parent === g.scene,
        meshes: meshes.length,
        positions: [part.root.position.x, part.root.position.y, part.root.position.z],
        origins: [...new Set(info.map(m => m.origin))],
        surfaces: info.every(m => m.surface),
        allVisible: info.every(m => m.materialVisible && !m.transparent && !m.additive),
        sample: info.slice(0, 3)
      });
    }
    const p0 = pieces.map(p => [p.root.position.x, p.root.position.y, p.root.position.z]);
    for (let i = 0; i < 75; i++) vw.step(1 / 60);
    const p1 = pieces.map(p => [p.root.position.x, p.root.position.y, p.root.position.z]);
    const travel = p0.map((p, i) => Math.hypot(p[0] - p1[i][0], p[1] - p1[i][1], p[2] - p1[i][2]));
    let separationChange = 0;
    for (let i = 0; i < p0.length; i++)
      for (let j = i + 1; j < p0.length; j++) {
        const d0 = Math.hypot(p0[i][0] - p0[j][0], p0[i][1] - p0[j][1], p0[i][2] - p0[j][2]);
        const d1 = Math.hypot(p1[i][0] - p1[j][0], p1[i][1] - p1[j][1], p1[i][2] - p1[j][2]);
        separationChange = Math.max(separationChange, Math.abs(d1 - d0));
      }
    out.vehicle = {
      type: veh.type?.name,
      kind: veh.kind,
      side: veh.side,
      visualRadius: veh.visualRadius,
      rig: {
        skins: veh.inst?.skins?.length || 0,
        bones: veh.inst?.bones?.length || 0,
        rootChildren: veh.inst?.root?.children?.length || 0,
        meshes: (() => { let n = 0; veh.inst?.root?.traverseVisible(o => { if (o.isMesh) n++; }); return n; })()
      },
      pieceCount: pieces.length,
      pieces: rows,
      totalPieceMeshes: rows.reduce((n, r) => n + r.meshes, 0),
      unexplained,
      residueOrigins,
      allSurfaces: rows.every(r => r.surfaces),
      allVisible: rows.every(r => r.visible && r.allVisible),
      travel: travel.map(v => +v.toFixed(3)),
      maxTravel: r3(Math.max(...travel)),
      minTravel: r3(Math.min(...travel)),
      travelSpread: r3(Math.max(...travel) - Math.min(...travel)),
      separationChange: r3(separationChange),
      nativeBodiesBefore: intermediate,
      nativeAfterKills: native(),
      residueBefore: vehResidueBefore,
      residueAfter: { emitted: res.emitted, pieces: res.pieces.length },
      simulated: { before: stillVeh, after: unitSnapshot(veh), unchanged: [veh.x, veh.y, veh.z].every((v, i) => v === [stillVeh.x, stillVeh.y, stillVeh.z][i]) },
      replaced: vw.replaced.has(veh),
      holderVisible: veh.holder?.visible,
      dead: veh.dead === true
    };

    // Keep references for the cleanup pass, and frame the evidence shot.
    window.__detailTest = { g, w, vw, res, inf, veh, infWreck, vehWreck, doll, baseline, residueBefore, stillInf, stillVeh };
    Object.assign(g.view, {
      x: (p1[0]?.[0] ?? veh.x),
      y: (p1[0]?.[1] ?? veh.y),
      dist: 260,
      pitch: 1.02
    });
    await raf();
    await raf();
    return out;
  });
}

async function cleanupBattle(body) {
  return body.evaluate(async () => {
    const t = window.__detailTest;
    const { g, w, vw, res, infWreck, vehWreck, baseline } = t;
    const disposed = [];
    const watch = gs => {
      for (const geo of gs || []) {
        if (!geo || geo.__detailWatched) continue;
        geo.__detailWatched = true;
        const dispose = geo.dispose.bind(geo);
        geo.dispose = () => {
          disposed.push(geo.uuid);
          dispose();
        };
      }
    };
    const vehicleOwned = [...(vehWreck?.owned || []), ...(vehWreck?.skinViews || [])];
    watch(vehicleOwned);
    watch(infWreck?.owned);
    const sceneBefore = g.scene.children.length;
    const liveBefore = vw.live.length;
    const pieceRoots = (vehWreck?.pieces || []).map(p => p.root);
    // 1000 cosmetic steps ~ 16.7 s: past the 12 s wreck lifetime and the
    // infantry sleep/park threshold. Gameplay remains paused.
    for (let i = 0; i < 1000 && vw.live.length; i++) vw.step(1 / 60);
    const wld = vw.world;
    const sceneAfter = g.scene.children.length;
    return {
      liveBefore,
      liveAfter: vw.live.length,
      settled: vw.settled.length,
      settledVisible: vw.settled.map(s => ({ inScene: s.root.parent === g.scene, visible: s.root.visible !== false })),
      native: { bodies: wld.bodies.len(), colliders: wld.colliders.len(), joints: wld.impulseJoints.len() },
      baseline,
      sceneBefore,
      sceneAfter,
      residue: { emitted: res.emitted, pieces: res.pieces.length },
      ownedGeometries: vehicleOwned.length,
      infantryOwned: (infWreck?.owned || []).length,
      disposedGeometries: disposed.length,
      vehicleGeometryRetained: vehicleOwned.every(g => !disposed.includes(g.uuid)),
      originalRootsPresent: pieceRoots.filter(r => r.parent === g.scene && r.visible).length,
      unitSimAfter: { inf: [t.inf.x, t.inf.y, t.inf.z], veh: [t.veh.x, t.veh.y, t.veh.z] },
      unitSimStill: {
        inf: [t.inf.x, t.inf.y, t.inf.z].every((v, i) => v === [t.stillInf.x, t.stillInf.y, t.stillInf.z][i]),
        veh: [t.veh.x, t.veh.y, t.veh.z].every((v, i) => v === [t.stillVeh.x, t.stillVeh.y, t.stillVeh.z][i])
      }
    };
  });
}

// ---------------------------------------------------------------------------
async function main() {
  const profileDir = path.join(OUT, '.chrome-profile');
  fs.rmSync(profileDir, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    viewport: { width: 1280, height: 720 },
    reducedMotion: 'reduce',
    args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling']
  });
  const pageErrors = [];
  try {
    for (const p of context.pages()) await p.close().catch(() => {});
    report.chrome = context.browser()?.version() || 'unknown';
    report.cpu = require('node:os').cpus()[0]?.model || 'unknown';
    report.sourceFingerprint = fingerprint();

    const page = await context.newPage();
    page.setDefaultTimeout(180000);
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => {
      const t = m.text();
      if (/GPUValidationError|THREE.WebGLProgram: Shader Error/.test(t)) pageErrors.push(t.slice(0, 240));
    });

    const mounted = await mountLandBattle(page);
    const { body, mapTitle, config } = mounted;
    report.battle = { mapTitle, ...config };

    // Evidence before the kills: the real battle is on screen.
    await page.screenshot({ path: path.join(EVIDENCE, 'battle.png') });

    const observed = await observeBattle(body);
    report.infantry = observed.infantry;
    report.vehicle = observed.vehicle;
    report.units = observed.units;
    report.types = observed.types;
    report.battle = { ...report.battle, ...observed.battle };
    report.keepBodies = observed.config?.keepBodies ?? null;

    const frameAt = async (target, dist, pitch) => {
      await body.evaluate(async (_, v) => {
        const t = window.__detailTest;
        let p;
        if (v.target === 'doll') p = t.doll.nodes[0].position;
        else p = t.vehWreck.pieces[0].root.position;
        Object.assign(t.g.view, { x: p.x, y: p.y, dist: v.dist, pitch: v.pitch });
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }, { target, dist, pitch });
      await page.waitForTimeout(300);
    };
    // Frame the fallen soldier on its real skin, then the drifting AT-AT hull.
    await frameAt('doll', 52, 0.82);
    await page.screenshot({ path: path.join(EVIDENCE, 'ragdoll.png') });
    await frameAt('wreck', 300, 1.12);
    await page.screenshot({ path: path.join(EVIDENCE, 'wreck.png') });
    report.evidence = ['battle.png', 'ragdoll.png', 'wreck.png'];

    report.cleanup = await cleanupBattle(body);
    await check('terrain: ordered Workshop walker leaves measurable footprints',async()=>{
      report.walkerSteps=await body.evaluate(require('./craters/workshop-walker.cjs'));
      const s=report.walkerSteps;assert(s.travel>50 && s.marks>=2 && s.depth>.15,JSON.stringify(s));
    });
    report.errors = pageErrors;

    // ---------------------------------------------------------------------
    // Checks
    // ---------------------------------------------------------------------
    await check('battle: real Workshop Instant Battle mounted through the TR profile', () => {
      assert(report.battle.mapTitle, 'No battlefield selected');
      assert(report.battle.profile === TR, `Mounted profile ${report.battle.profile}`);
      assert(/Ground War/i.test(report.battle.mapTitle), `Battlefield ${report.battle.mapTitle}`);
      assert(report.units?.infantry > 0, 'No infantry in the mounted battle');
      assert(report.units?.vehicles > 0, 'No vehicles in the mounted battle');
      assert(Object.keys(report.types || {}).some(n => /stormtrooper/i.test(n)), 'No modded Imperial infantry type found');
      assert(Object.keys(report.types || {}).some(n => /AT_AT|AT-AT|Juggernaut|Tank|Walker/i.test(n)), 'No modded vehicle type found');
    });

    await check('infantry: real mod foot soldier died through the game kill callback', () => {
      const i = report.infantry;
      assert(i, 'No infantry observation');
      assert(i.kind === 'INFANTRY' && i.type, `Not an infantryman (${i.kind} ${i.type})`);
      assert(i.dead === true, 'Casualty did not die');
      assert(i.replaced === true, 'Wreck layer did not capture the casualty');
      assert(i.holderVisible === false, 'Authored unit holder stayed visible');
    });

    await check('infantry: visible last-pose ragdoll with a real rig, nodes and joints', () => {
      const d = report.infantry?.doll;
      const rig = report.infantry?.rig;
      assert(d && rig, 'No ragdoll/rig data');
      assert(rig.skins > 0, 'No skinned mesh on the mod infantryman');
      assert(rig.bones >= 10, `Rig has only ${rig.bones} bones`);
      assert(d.nodes === 10, `Expected 10 ragdoll nodes, got ${d.nodes}`);
      assert(d.joints === 9, `Expected 9 joints, got ${d.joints}`);
      assert(d.skinnedMeshes > 0, 'No skinned doll meshes');
      assert(d.rootInScene && d.rootVisible, 'Ragdoll root is not visible in the scene');
      assert(d.allMeshesVisible, 'A ragdoll mesh/material is not visible');
      assert(d.lastPoseMatched > 0, 'No doll palette matched the pre-death pose');
      assert(d.lastPoseMax < 0.5, `Doll starting palette is not the last pose (max ${d.lastPoseMax})`);
      assert(d.nodeMoveMax > 0.1, `Ragdoll nodes did not move (${d.nodeMoveMax})`);
    });

    await check("infantry: ragdoll is built from the casualty's authored meshes", () => {
      const d = report.infantry?.doll;
      assert(d, 'No ragdoll data');
      assert(d.meshes > 0, 'Ragdoll has no meshes');
      assert(d.realMeshes === d.meshes, `${d.realMeshes}/${d.meshes} doll meshes are the casualty's authored geometry`);
    });

    await check('infantry: skin/palette or rigid meshes animate without moving simulation coords', () => {
      const d = report.infantry?.doll;
      assert(d, 'No ragdoll data');
      assert(d.paletteMoved > 0.001 || d.rigidMoved > 0.0001, 'Neither palette nor rigid mesh transforms changed');
      assert(report.infantry.simulated.unchanged, 'Ragdoll changed the authoritative unit x/y/z');
    });

    await check('infantry: no residue fallback for the successful ragdoll', () => {
      const i = report.infantry;
      assert(i.residueAfterInf.emitted === i.residueBefore.emitted, `Residue emitted (${i.residueBefore.emitted} -> ${i.residueAfterInf.emitted})`);
      assert(i.residueAfterInf.pieces === i.residueBefore.pieces, 'Residue pieces were created');
    });

    await check('vehicle: detailed wreck from native unit geometry (>= 2 pieces)', () => {
      const v = report.vehicle;
      assert(v, 'No vehicle observation');
      assert(v.kind === 'VEHICLE' && v.type, `Not a vehicle (${v.kind} ${v.type})`);
      assert(v.dead === true && v.replaced === true, 'Vehicle was not captured as a wreck');
      assert(v.pieceCount >= 2, `Wreck has ${v.pieceCount} piece(s), expected >= 2`);
      assert(v.totalPieceMeshes >= 2, `Wreck has ${v.totalPieceMeshes} mesh(es)`);
      assert(v.unexplained === 0, `${v.unexplained} piece mesh(es) are not unit geometry or a documented cut`);
      assert(v.residueOrigins === 0, 'A wreck piece is the residue tetrahedron');
    });

    await check('vehicle: pieces drift independently, visibly and with material surfaces', () => {
      const v = report.vehicle;
      assert(v.allVisible, 'A wreck piece or material is not visible/opaque');
      assert(v.allSurfaces, 'A wreck piece has no material surface');
      assert(v.maxTravel > 1, `Wreck did not drift (max ${v.maxTravel})`);
      assert(v.travel.filter(x => x > 1).length >= 2, `Only ${v.travel.filter(x => x > 1).length} piece(s) moved`);
      assert(v.travelSpread > 0.5 || v.separationChange > 0.5, `Pieces moved as one body (spread ${v.travelSpread}, separation ${v.separationChange})`);
      assert(v.simulated.unchanged, 'Wreck changed the authoritative vehicle x/y/z');
    });

    await check('vehicle: wreck death does not emit residue', () => {
      const v = report.vehicle;
      assert(v.residueAfter.emitted === v.residueBefore.emitted, `Residue emitted (${v.residueBefore.emitted} -> ${v.residueAfter.emitted})`);
      assert(v.residueAfter.pieces === 0, `${v.residueAfter.pieces} residue piece(s)`);
    });

    await check('cleanup: settling releases native bodies but retains the drawn sections', () => {
      const c = report.cleanup;
      assert(c, 'No cleanup observation');
      assert(c.liveAfter === 0, `${c.liveAfter} live wreck(s) after lifetime`);
      assert(c.native.bodies === c.baseline.bodies, `Bodies ${c.baseline.bodies} -> ${c.native.bodies}`);
      assert(c.native.colliders === c.baseline.colliders, `Colliders ${c.baseline.colliders} -> ${c.native.colliders}`);
      assert(c.native.joints === c.baseline.joints, `Joints ${c.baseline.joints} -> ${c.native.joints}`);
      assert(c.originalRootsPresent === report.vehicle.pieceCount,'some original wreck sections disappeared');
      assert(c.vehicleGeometryRetained,'parked wreck lost geometry');
      assert(c.residue.pieces === 0, 'Residue pieces remain');
      assert(c.sceneAfter <= c.sceneBefore + 1, `Scene children grew ${c.sceneBefore} -> ${c.sceneAfter}`);
    });

    await check('cleanup: parked infantry (if kept) keeps its visual but no bodies', () => {
      const c = report.cleanup;
      assert(c.settled <= 1, `${c.settled} parked infantry corpses`);
      assert(c.settled === 0 || c.settledVisible.every(s => s.inScene && s.visible), 'Parked corpse is not visible in the scene');
    });

    await check('run: no page errors', () => {
      assert(pageErrors.length === 0, pageErrors.join(' | ').slice(0, 400));
    });
  } catch (e) {
    report.errors.push(e.stack || e.message);
    await check('run: completed without a fatal harness error', () => {
      throw e;
    });
  } finally {
    report.verdict = {
      total: checks.length,
      passed: checks.filter(c => c.ok).length,
      failed: checks.filter(c => !c.ok).length,
      ok: checks.every(c => c.ok)
    };
    writeReport();
    for (const c of checks) {
      const status = c.ok ? 'PASS' : 'FAIL';
      const detail = c.ok ? (c.detail ? ` ${JSON.stringify(c.detail).slice(0, 200)}` : '') : ` - ${c.error}`;
      console.log(`${status} ${c.name}${detail}`);
    }
    const failed = checks.filter(c => !c.ok).length;
    console.log(`\n${checks.length - failed}/${checks.length} checks passed. Report: ${path.join(OUT,'report.json')}`);
    await context.close().catch(() => {});
    fs.rmSync(profileDir, { recursive: true, force: true });
    if (failed) process.exitCode = 1;
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
