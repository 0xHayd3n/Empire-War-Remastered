// A local evidence matrix, not an allowlist. Each exact ordered stack gets its own result.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { parseArgs } = require('node:util'),
  { chromium } = require('playwright-core');
const { values: opt } = parseArgs({
  options: {
    order: { type: 'string' },
    backend: { type: 'string', default: 'webgpu' },
    only: { type: 'string' },
    report: { type: 'string' }
  }
});
const { backend } = opt,
  host = 'http://127.0.0.1:8590/',
  timeout = 120000;
assert(['webgl', 'webgpu'].includes(backend));
function custom(s) {
  const ids = s.split(',');
  assert(
    ids.length <= 64 && new Set(ids).size === ids.length && ids.every(x => /^[1-9]\d{0,19}$/.test(x)),
    'Use 1–64 distinct comma-separated Workshop IDs, highest priority first'
  );
  return ids;
}
const requested = opt.order === undefined ? null : custom(opt.order);
const crypto = require('node:crypto');
const output = path.resolve(
  opt.report ||
    `tools/baselines/compatibility/${requested ? 'order-' + crypto.createHash('sha256').update(requested.join(',')).digest('hex').slice(0, 16) : opt.only ? 'partial-' + opt.only.replace(/[^a-z0-9-]/gi, '_') : 'installed'}-${backend}.json`
);
function persist(r) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output + '.tmp', JSON.stringify(r, null, 2) + '\n');
  fs.renameSync(output + '.tmp', output);
}
function listen(page, errors) {
  page.setDefaultTimeout(25000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => {
    if (d.type() === 'beforeunload') void d.accept();
    else {
      errors.push(d.message());
      void d.dismiss();
    }
  });
}
const child = p => p.frames().find(f => f.parentFrame() === p.mainFrame());
const title = (ui, id) => ui.locator(`[data-id="${id}"]:visible`).first().click({ timeout });
async function launchParent(page, c) {
  const ui = page.frameLocator('#game');
  await title(ui, 'TITLE_PLAY');
  await title(ui, 'IDC_INSTANT_BATTLE_BUTTON');
  const board = ui.locator('.op-setup'),
    search = board.getByRole('searchbox', { name: 'Search battlefields' }),
    selector = `[data-source="${c.ids[0] || 'stock'}"][data-domain="space"][data-file]`;
  await search.fill('Kuat space');
  let leaf = board.locator(selector).first();
  if (!(await leaf.isVisible())) {
    await search.fill(c.name + ' space');
    await leaf.waitFor({ timeout: 15000 });
  }
  const map = await leaf.getAttribute('data-file');
  await leaf.click();
  const go = ui.locator(`.op-setup[data-profile="${c.ids[0] || 'stock'}"] .op-go:enabled`);
  await go.waitFor({ timeout });
  await page.setViewportSize({ width: 390, height: 844 });
  const rect = await go.boundingBox();
  assert(rect?.width && rect.x >= 0 && rect.x + rect.width <= 391 && rect.y + rect.height <= 845, 'Start outside narrow viewport');
  await page.setViewportSize({ width: 1200, height: 800 });
  await go.click();
  return { frame: child(page), map };
}
async function launchWorkshop(page, c, errors) {
  const ui = page.frameLocator('#game');
  await title(ui, 'TITLE_WORKSHOP');
  if (c.collection) {
    await ui.locator(`[data-mod="${c.collection.primary}"]`).click();
    const notes = ui
      .locator('details.collection-note')
      .filter({ has: ui.getByText(`Collection: ${c.collection.name} · ${c.ids.length} enabled`, { exact: true }) });
    await notes.locator('summary').click();
    await notes.getByRole('button', { name: 'Use collection order' }).click();
  } else {
    for (const id of c.ids) {
      await ui.locator(`[data-mod="${id}"]`).click();
      await ui.getByRole('button', { name: 'Add to playset', exact: true }).click();
    }
  }
  const dock = ui.locator('.set-order li');
  assert.equal(await dock.count(), c.ids.length);
  await ui.getByRole('button', { name: 'Prepare playset', exact: true }).click();
  const link = ui.getByRole('link', { name: /Open playset game/ });
  await link.waitFor({ timeout: 35000 }).catch(async () => {
    throw Error('Playset not prepared: ' + (await ui.locator('[role="status"]:visible').allTextContents()).join(' '));
  });
  const opened = page.context().waitForEvent('page');
  await link.click();
  const game = await opened;
  listen(game, errors);
  await title(game, 'TITLE_PLAY');
  await title(game, 'IDC_INSTANT_BATTLE_BUTTON');
  await game.locator('.ib-go:visible').click({ timeout });
  return { frame: game.mainFrame() };
}
async function battle(frame, c, map) {
  await frame.waitForFunction(
    () =>
      window.game?.renderer?.draw &&
      game.world?.time > 2 &&
      game.world.units?.some(u => u.player?.id >= 0 && u.model) &&
      document.querySelector('#loading.hidden'),
    null,
    { timeout }
  );
  const data = await frame.evaluate(async probes => {
    const { loadContent } = await import('/js/content.js'),
      { fetchBinary } = await import('/js/vfs.js'),
      { snapshotNow, validate, putSave, getSave } = await import('/js/game/savegame.js');
    const content = await loadContent(),
      { world, setup, renderer } = game;
    const checks = [];
    for (const p of probes) {
      const b = await fetchBinary(p.path);
      checks.push(
        b ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join('') : null
      );
    }
    const snap = await snapshotNow(game, 'Compatibility matrix'),
      slot = await putSave(snap, 'compatibility-matrix'),
      back = await getSave(slot);
    if (
      validate(back) ||
      !snap.battle?.entities?.length ||
      back.name !== snap.name ||
      back.battle.time !== snap.battle.time ||
      JSON.stringify(back.content) !== JSON.stringify(content) ||
      back.setup.mapFile !== setup.mapFile
    )
      throw Error('Battle save readback mismatch');
    return {
      checks,
      mount: content.mods.map(m => ({ id: m.workshop, revision: m.packRevision || null, version: m.version || null })),
      edition: content.edition,
      map: setup.mapFile,
      units: world.units.length,
      mode: snap.summary?.family,
      time: world.time,
      saveEntities: back.battle.entities.length,
      backend: renderer.renderer.isWebGLRenderer ? 'webgl' : renderer.renderer === renderer.gpu ? 'webgpu' : 'unknown'
    };
  }, c.files.probes);
  const { checks, ...observed } = data;
  c.observed = observed;
  assert.equal(data.backend, backend, 'Renderer');
  assert.equal(data.mode, 'instant', 'Battle mode');
  assert.deepEqual(
    data.mount.map(x => x.id),
    c.ids.slice().reverse(),
    'Mounted IDs (low to high)'
  );
  if (map) assert.equal(data.map.toLowerCase(), map.toLowerCase(), 'Wrong battlefield');
  c.files.probes.forEach((p, i) => assert.equal(checks[i], p.sha256, `Source winner mismatch: ${p.path} / ${p.winner}`));
}
async function main() {
  const { readLibrary } = await import('./workshop-library.mjs'),
    { sourceOracle } = await import('./compatibility-orders.mjs');
  const lib = readLibrary(),
    oracle = sourceOracle(lib);
  const { steamRevision } = await import('./workshop-status.mjs'),
    manifest = steamRevision(lib.roots);
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const ctx = await browser.newContext(),
      page = await ctx.newPage();
    await page.goto(host);
    await page.frameLocator('#game').locator('[data-id="TITLE_PLAY"]:visible').waitFor({ timeout });
    const { catalog, eras } = await child(page).evaluate(async () => {
      const get = async u => {
        const r = await fetch(u);
        if (!r.ok) throw Error(`Catalog ${r.status}`);
        return r.json();
      };
      return { catalog: await get('/api/title-workshop/catalog'), eras: await get('/api/universal/eras') };
    });
    await ctx.close();
    const cases = [];
    if (!requested) {
      for (const e of eras)
        cases.push({ route: 'era', name: e.name, ids: e.id === 'stock' ? [] : [e.id], problem: e.ready ? null : 'Era not built' });
      for (const coll of catalog.collections) {
        const prior = cases.find(c => !coll.problem && JSON.stringify(c.ids) === JSON.stringify(coll.order));
        if (prior) {
          (prior.savedOrders ||= []).push(coll.name);
          continue;
        }
        cases.push({ route: 'workshop', name: coll.name, ids: coll.order, collection: coll, problem: coll.problem });
      }
    } else cases.push({ route: 'workshop', name: 'Explicit order', ids: requested });
    const rows = cases.filter(c => !opt.only || c.route === opt.only || c.ids.includes(opt.only));
    assert(rows.length, 'No cases selected');
    const git = args => require('node:child_process').execFileSync('git', args, { cwd: __dirname, encoding: 'utf8' }).trim();
    const report = {
      at: new Date().toISOString(),
      host,
      backend,
      baseCommit: git(['rev-parse', 'HEAD']),
      dirty: !!git(['status', '--porcelain']),
      priority: 'first ID wins',
      browser: browser.version(),
      skippedProfileFiles: lib.skipped,
      inventory: catalog.mods.map(m => ({
        id: m.id,
        name: m.name,
        installed: m.installed,
        ambiguous: m.duplicate,
        steamManifest: manifest(lib.items.get(m.id))
      })),
      collections: catalog.collections,
      rows
    };
    // File checks for each catalogued parent/submod pair, including disabled items. These are hypothetical
    // orders, not dependency recommendations. Nothing here launches them or changes the saved collection.
    if (!requested && !opt.only) {
      report.individualFileChecks = [];
      for (const c of catalog.collections)
        for (const id of new Set([...c.order, ...c.disabled])) {
          if (id === c.primary) continue;
          const ids = [id, c.primary],
            record = { ids, disabledInCollection: c.disabled.includes(id) };
          report.individualFileChecks.push(record);
          try {
            if (ids.some(x => !lib.items.has(x) || lib.ambiguous.has(x) || !catalog.mods.find(m => m.id === x)?.installed))
              throw Error('Missing or ambiguous source');
            const f = oracle(ids);
            Object.assign(record, {
              status: 'FILES ONLY',
              sharedModPaths: f.sharedModPaths,
              effectiveItemPaths: f.effectivePaths[id],
              probes: f.probes
            });
          } catch (e) {
            Object.assign(record, { status: 'BLOCKED', reason: e.message });
          }
        }
    }
    for (const c of rows) c.status = 'NOT RUN';
    persist(report);
    for (const c of rows) {
      let context;
      let stage = 'preflight';
      const errors = [];
      try {
        if (!lib.game || !catalog.gameAvailable) throw Error('Game installation unavailable');
        if (c.problem) throw Error(c.problem);
        for (const id of c.ids) {
          const m = catalog.mods.find(m => m.id === id);
          if (!m?.installed || m.duplicate || !lib.items.has(id) || lib.ambiguous.has(id)) throw Error('Missing or ambiguous item: ' + id);
        }
        if (c.route === 'workshop' && c.ids.filter(id => eras.some(e => e.id === id)).length > 1)
          throw Error('Workshop supports one primary overhaul per order');
        c.files = oracle(c.ids);
        stage = 'launch';
        console.log('START', c.name, c.route, c.ids.length);
        context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
        if (backend === 'webgl') await context.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
        const p = await context.newPage();
        listen(p, errors);
        await p.goto(host);
        const { frame, map } = await (c.route === 'era' ? launchParent(p, c) : launchWorkshop(p, c, errors));
        stage = 'battle';
        await battle(frame, c, map);
        assert.deepEqual(errors, [], 'Unexpected browser error');
        c.status = 'PASS';
      } catch (e) {
        c.status =
          stage === 'preflight' || e.message.startsWith('Playset not prepared:')
            ? 'BLOCKED'
            : e.code === 'ERR_ASSERTION'
              ? 'FAIL'
              : 'NOT VERIFIED';
        c.stage = stage;
        c.reason = e.message.split('Call log:')[0].trim().slice(0, 500);
        if (errors.length) c.browserErrors = errors.slice(0, 4);
      } finally {
        if (context) await context.close();
        persist(report);
      }
      console.log(c.status, c.name, c.observed?.map || '', c.observed?.units || '', c.reason || '');
      for (const s of c.files?.shadowed || [])
        console.warn('  NO WINNING FILES:', s.id, s.example || '(empty)', s.winner ? '→ ' + s.winner : '');
    }
    const after = steamRevision(lib.roots);
    report.changedDuringRun = report.inventory.filter(m => manifest(lib.items.get(m.id)) !== after(lib.items.get(m.id))).map(m => m.id);
    for (const row of rows)
      if (row.ids.some(id => report.changedDuringRun.includes(id))) {
        row.status = 'NOT VERIFIED';
        row.reason = 'Steam publication changed during the check; rerun.';
      }
    persist(report);
    console.log(output);
    if (rows.some(c => c.status !== 'PASS') || report.individualFileChecks?.some(r => r.status === 'BLOCKED')) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
