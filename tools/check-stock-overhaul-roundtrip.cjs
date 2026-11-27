// Uses an ephemeral browser profile. Only hashes and public identifiers leave the mounted frame.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright-core');
const host = 'http://127.0.0.1:8590/', overhaul = '1976399102', timeout = 150000;
const backend = process.argv[2] || 'webgpu';
assert(['webgpu', 'webgl'].includes(backend), 'Usage: node tools/check-stock-overhaul-roundtrip.cjs [webgpu|webgl]');
const slot = 'compatibility-roundtrip'; // deliberately the SAME slot in both profiles
const paths = ['Data/Art/Models/EV_LAMBDASHUTTLE_SPACE.ALO', 'Data/XML/GameConstants.xml', 'Data/Art/Models/Venator_Legions.alo'];

async function reference() {
  const { readLibrary } = await import('./workshop-library.mjs'), { openGame } = await import('./megfs.mjs');
  const lib = readLibrary(), mod = lib.items.get(overhaul);
  assert(lib.game && mod && !lib.ambiguous.has(overhaul), 'Requires FoC and one unambiguous Fall of the Republic installation');
  const output = {};
  for (const id of ['stock', overhaul]) {
    const archive = openGame(lib.game, id === 'stock' ? [] : [mod.folder]);
    try {
      output[id] = paths.map(p => { const k = archive.resolve(p); return k ? createHash('sha256').update(archive.read(k)).digest('hex') : null; });
    } finally { archive.close(); }
  }
  for (const i of [0, 1]) {
    assert(output.stock[i] && output[overhaul][i], 'Missing common model/rules file: ' + paths[i]);
    assert.notEqual(output.stock[i], output[overhaul][i], 'Fixture must be overridden: ' + paths[i]);
  }
  assert(!output.stock[2] && output[overhaul][2], 'Venator must be overhaul-only in this fixture');
  return output;
}
async function run() {
  const expected = await reference();
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } }), page = await ctx.newPage();
    if (backend === 'webgl') await ctx.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
    const ui = page.frameLocator('#game'), board = ui.locator('.op-setup'), errors = [];
    const frame = () => page.frames().find(f => f.parentFrame() === page.mainFrame());
    page.on('pageerror', e => { errors.push(e.message); console.error('Page error:', e.message); });
    page.on('dialog', d => { if (d.type() === 'beforeunload') void d.accept(); else { errors.push('Dialog: ' + d.message()); void d.dismiss(); } });
    page.setDefaultTimeout(45000);
    async function title() {
      await page.goto(host);
      await ui.locator('[data-id="TITLE_PLAY"]:visible').waitFor({ timeout });
    }
    async function start(id, search) {
      await ui.locator('[data-id="TITLE_PLAY"]:visible').click();
      await ui.locator('[data-id="IDC_INSTANT_BATTLE_BUTTON"]:visible').click();
      await board.getByRole('searchbox', { name: 'Search battlefields' }).fill(search);
      const leaf = board.locator(`[data-source="${id}"][data-world="Kuat"][data-domain="space"]`).first();
      const file = await leaf.getAttribute('data-file');
      assert(file, 'Expected an authored battlefield file');
      await leaf.click();
      const go = ui.locator(`.op-setup[data-profile="${id}"] .op-go:enabled`);
      await go.waitFor({ timeout });
      // Check the action remains reachable on a narrow window as well.
      await page.setViewportSize({ width: 390, height: 844 });
      const box = await go.boundingBox();
      assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 391 && box.y + box.height <= 845, 'Start outside mobile viewport');
      await page.setViewportSize({ width: 1200, height: 800 });
      await go.click();
      await running();
      assert.equal((await frame().evaluate(() => game.setup.mapFile)).toLowerCase(), file.toLowerCase(), 'Wrong battlefield loaded');
    }
    async function running() {
      await frame().waitForFunction(() => window.game?.renderer?.draw && game.world?.time > 1 && game.world.units?.some(u => u.player && u.model) && document.querySelector('#loading.hidden'), null, { timeout }).catch(async err => {
        console.error('Battle failed at', frame().url(), await ui.locator('#loadText').textContent().catch(() => 'unknown')); throw err;
      });
    }
    async function probe(id) {
      const p = await frame().evaluate(async (paths) => {
        const { fetchBinary } = await import('/js/vfs.js'), { db } = await import('/js/gamedata.js'), { loadContent } = await import('/js/content.js');
        const hashes = [];
        for (const path of paths) { const bytes = await fetchBinary(path); hashes.push(bytes ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('') : null); }
        const t = db.type('Venator_Star_Destroyer'), venator = t ? { name: t.name, model: t.str('Space_Model_Name') } : null;
        const { setup, world, renderer } = game;
        return { hashes, venator, content: await loadContent(), map: setup.mapFile, planet: setup.planetBattle?.id, time: world.time,
          units: world.units.length, types: [...new Set(world.units.filter(u => u.player?.id >= 0).map(u => u.type.name))].sort(),
          restored: setup.restore?.name, factions: setup.teamFactions, origin: location.origin,
          backend: renderer.renderer.isWebGLRenderer ? 'webgl' : renderer.renderer === renderer.gpu ? 'webgpu' : 'unknown' };
      }, paths);
      assert.equal(p.backend, backend, 'Requested backend not active');
      assert.deepEqual(p.hashes, expected[id], 'Mounted VFS differs from local installation for ' + id);
      assert.deepEqual(p.content.mods.map(m => m.workshop), id === 'stock' ? [] : [id]);
      assert.equal(p.planet, 'Kuat'); assert(p.types.length && p.units > 1 && p.time > 1, 'No populated tactical world');
      if (id === 'stock') assert.equal(p.venator, null); else assert.equal(p.venator?.model?.toLowerCase(), 'venator_legions.alo');
      console.log(id, p.map, p.backend, p.units, 'units;', p.types.slice(0, 8).join(', '));
      return p;
    }
    async function save(id) {
      return frame().evaluate(async ({ id, slot }) => {
        const { listSaves, snapshotNow, putSave, getSave, validate } = await import('/js/game/savegame.js');
        if ((await listSaves()).some(s => s.id === slot) || await getSave(slot)) throw Error('Other profile save visible before writing ' + id);
        const snap = await snapshotNow(game, 'Compatibility: ' + id);
        const why = validate(snap); if (why) throw Error(why);
        if (snap.summary.family !== 'instant' || snap.mode !== 'space' || !snap.battle.entities.length) throw Error('Not a live Instant Battle snapshot');
        await putSave(snap, slot);
        const stored = await getSave(slot);
        if (stored?.name !== snap.name || stored.battle.time !== snap.battle.time || stored.battle.entities.length !== snap.battle.entities.length || !(await listSaves()).some(s => s.id === slot && s.name === snap.name)) throw Error('Checkpoint did not round trip');
        return { name: snap.name, time: snap.battle.time, entities: snap.battle.entities.length, map: snap.setup.mapFile, content: snap.content };
      }, { id, slot });
    }
    await title();
    await ui.getByRole('button', { name: 'System menu' }).click();
    await ui.getByRole('button', { name: 'Settings', exact: true }).click();
    await ui.getByRole('tab', { name: 'Graphics Quality', exact: true }).click();
    assert.equal(await ui.getByRole('button', { name: 'Open fighter workshop' }).count(), 0);
    await title(); await start('stock', 'Kuat Forces of Corruption space');
    const stock = await probe('stock'), original = await save('stock');
    await title(); await start(overhaul, 'Kuat Fall of the Republic space');
    const mod = await probe(overhaul), other = await save(overhaul);
    assert.notEqual(stock.origin, mod.origin);
    assert(mod.types.some(t => !stock.types.includes(t)), 'No different unit types instantiated in the overhaul battle');
    assert.deepEqual(original.content, stock.content); assert.deepEqual(other.content, mod.content);
    await title();
    const check = await frame().evaluate(async slot => {
      const { getSave, listSaves } = await import('/js/game/savegame.js');
      const snap = await getSave(slot);
      return { name: snap?.name, entities: snap?.battle.entities.length, time: snap?.battle.time, map: snap?.setup.mapFile, content: snap?.content,
        names: (await listSaves()).filter(s => s.id === slot).map(s => s.name) };
    }, slot);
    assert.deepEqual(check, { ...original, names: [original.name] });
    await frame().evaluate(async slot => (await import('/js/game/transit.js')).loadSaved(slot), slot);
    await running();
    const back = await probe('stock');
    assert.deepEqual(back.content, stock.content); assert.equal(back.origin, stock.origin); assert.equal(back.map, original.map);
    assert.equal(back.restored, original.name, 'Expected the real stock save, not a fresh battle');
    const foreignTypes = await frame().evaluate(async names => { const { db } = await import('/js/gamedata.js'); return names.filter(n => !db.type(n)); }, mod.types);
    assert(foreignTypes.length, 'Expected at least one deployed overhaul type absent from the stock rules');
    assert(back.time >= original.time - .1, 'Did not resume at the saved battle time');
    assert.deepEqual(errors, []);
    console.log('PASS: stock → Fall of the Republic → restored stock. Same-path ALO and rules match source SHA-256; Venator scoped; independent same-ID saves.', { stock: original.time, overhaul: other.time, resumed: back.time });
  } finally { await b.close(); }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
