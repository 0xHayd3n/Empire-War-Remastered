// End-to-end against real stock, Thrawn and Fall mounts. No player browser,
// persistent playset registry, atlas writes or object hydration in the source library.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { spawn } = require('node:child_process'),
  { chromium } = require('playwright-core');
const ids = ['1125571106', '1976399102'];
(async () => {
  const port = Number(process.env.SWR_TEST_WINDOW_PORT || 9050),
    origin = `http://127.0.0.1:${port}`;
  assert(port >= 9050 && port <= 9062, 'Reserve eight consecutive test ports in 9050–9069.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaw-unit-armory-')),
    library = path.join(tmp, 'library');
  const source = (await import('./universal-library.mjs')).libraryHome();
  let server, browser, page;
  try {
    for (const folder of ['profiles', 'campaign-atlas-v1', 'planet-portraits-v1']) {
      const dest = path.join(library, folder),
        src = path.join(source, folder);
      fs.mkdirSync(dest, { recursive: true });
      if (!fs.existsSync(src)) continue;
      for (const f of fs.readdirSync(src)) {
        if (folder === 'profiles' && !ids.includes(path.basename(f, '.json'))) continue;
        // Content-addressed caches are immutable. Test-side additions/renames are private.
        try {
          fs.linkSync(path.join(src, f), path.join(dest, f));
        } catch {
          fs.copyFileSync(path.join(src, f), path.join(dest, f));
        }
      }
    }
    for (const id of ids) assert(fs.existsSync(path.join(library, 'profiles', id + '.json')), 'Build both test packs first.');
    server = spawn(process.execPath, ['server.mjs', '--universal', '--port', String(port)], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_LIBRARY: library, SWR_PLAYSET_HOME: tmp },
      stdio: ['ignore', 'pipe', 'inherit']
    });
    await new Promise((ok, no) => {
      server.stdout.on('data', d => {
        if (d.includes('Universal game:')) ok();
      });
      server.once('exit', n => no(Error('server exit ' + n)));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true, reducedMotion: 'reduce' });
    // Observe real worker creation, messages and termination without providing
    // any native art, camera pose, frames, local storage, or fake staging.
    await page.addInitScript(() => {
      const Native = Worker;
      window.stageTrace = { opened: 0, closed: 0, draws: 0, moving: 0 };
      window.Worker = class extends Native {
        constructor(url, options) {
          super(url, options);
          this.inspection = String(url).includes('armorystageworker.js');
          if (this.inspection) stageTrace.opened++;
        }
        postMessage(q, ...rest) {
          if (this.inspection && q.kind === 'draw') {
            stageTrace.draws++;
            if (q.dt > 0) stageTrace.moving++;
          }
          return super.postMessage(q, ...rest);
        }
        terminate() {
          if (this.inspection) stageTrace.closed++;
          return super.terminate();
        }
      };
    });
    page.setDefaultTimeout(75000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin);
    const f = page.frameLocator('#game'),
      actual = () => page.frames().find(frame => frame.url().includes('/play.html'));
    const click = id => f.locator(`[data-id="${id}"]:visible`).first().click(),
      button = name => f.getByRole('button', { name, exact: true });
    // Customize is a Home tile and Back is the only way out of a section.
    const section = () => f.locator('.title-menu').getAttribute('data-section');
    const goHome = async () => {
      for (let i = 0; i < 4 && (await section()) !== 'home'; i++) await f.locator('.title-menu .mode-back:visible').first().click();
      await f.locator('.title-menu[data-section="home"]').waitFor();
    };
    const registry = () => button('Fleet registry').click();
    await click('TITLE_CUSTOMIZE'); await registry();
    async function mount(id) {
      const s = f.getByLabel('Mod profile');
      await s.locator(`option[value="${id}"]`).waitFor({ state: 'attached' });
      await s.selectOption(id);
      await f.locator(`meta[name="swr-pack-revision"][content^="${id}:"]`).waitFor({ state: 'attached' });
      await registry();
      await f.locator('.armory-inspect').first().waitFor();
      const opt = await f
        .locator('.faction option')
        .evaluateAll(os => os.find(o => o.value.toLowerCase() === 'empire')?.value || os[0].value);
      await f.locator('.faction').selectOption(opt);
      return opt;
    }
    // Renderer-only fixture: use a real installed animated Lancet ALO + ALA,
    // without adding that land-tactical craft to anyone's space roster.
    const fixture = f.locator('armory-live-stage');
    await fixture.evaluate(e => e.show({ file: 'EV_TIE_LANCET.ALO', hull: 'Lancet', label: 'Lancet' }));
    const surface = f.getByRole('group', { name: 'Unit inspection camera' });
    await surface.scrollIntoViewIfNeeded();
    await button('Play idle').waitFor();
    assert.equal(await actual().evaluate(() => stageTrace.moving), 0, 'reduced motion starts paused');
    const image = () => fixture.locator('canvas').evaluate(c => c.toDataURL());
    const beforeIdle = await image();
    await button('Play idle').click();
    await actual().waitForFunction(() => stageTrace.moving > 4);
    assert.notEqual(await image(), beforeIdle, 'native bone clip changed pixels at a fixed camera');
    await page.setViewportSize({ width: 850, height: 450 });
    await f.locator('.armory-blueprint .desk-actions').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const frames = await actual().evaluate(() => stageTrace.draws);
    await page.waitForTimeout(350);
    assert.equal(await actual().evaluate(() => stageTrace.draws), frames, 'offscreen animation stopped');
    await surface.scrollIntoViewIfNeeded();
    await actual().waitForFunction(n => stageTrace.draws > n + 1, frames);
    await button('Pause idle').click();
    console.log('PASS renderer fixture: mounted Lancet ALA changed pixels; reduced motion, offscreen suspension and resume.');
    await page.setViewportSize({ width: 1440, height: 900 });
    const faction = await mount(ids[0]);
    const { lead, support, cost, key, unitLabel } = await actual().evaluate(async faction => {
      const a = await import('./js/game/instantbattle.js'),
        r = a.instantRoster(faction).filter(r => !r.hero);
      const [lead, support] = r;
      const fm = await import('./js/game/fleetpresets.js'),
        key = await fm.presetKey();
      // Exact old key + v1 payload, not saved through the new API.
      const c = await (await import('./js/content.js')).loadContent();
      const old =
        'swr-fleet-presets-v1:' +
        JSON.stringify([c.edition, ...c.mods.map(m => [m.workshop || m.name, m.version || '', m.packRevision || ''])]);
      if (old !== key) throw Error('Valid old key no longer resolves');
      localStorage.setItem(old, JSON.stringify([{ id: 'legacy', faction, name: 'Legacy patrol', units: [support.name] }]));
      return { lead: lead.name, support: support.name, cost: lead.cost, key, unitLabel: lead.label };
    }, faction);
    console.log('Mounted:', faction, lead, support, '· checking saved v1, art, keyboard, editing');
    // A Home round trip must keep the mounted profile and its saved blueprint.
    await goHome();
    await click('TITLE_CUSTOMIZE'); await registry();
    await f.locator('.faction').selectOption(faction);
    await f.getByLabel('Blueprint', { exact: true }).selectOption('legacy');
    assert.equal(await f.locator('.preset-name').inputValue(), 'Legacy patrol');
    await f.getByLabel('Blueprint', { exact: true }).selectOption('');
    const inspect = f.locator(`[data-inspect="${lead}"]`);
    await inspect.focus();
    await inspect.press('Enter');
    assert.equal(await f.locator('.record h2').textContent(), unitLabel);
    const stage = f.locator('armory-live-stage'),
      camera = f.getByRole('group', { name: 'Unit inspection camera' }),
      frame = stage.locator('canvas:visible');
    const trace = () => actual().evaluate(() => ({ ...stageTrace }));
    const pixels = () =>
      frame.evaluate(c => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let alpha = 0,
          hash = 1;
        const colors = new Set();
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] > 20) {
            alpha++;
            colors.add(d[i]);
          }
          hash = (Math.imul(31, hash) + d[i] + d[i + 3]) | 0;
        }
        return { alpha, hash, shades: colors.size };
      });
    const waitChange = async hash => {
      for (let i = 0; i < 60; i++) {
        const snap = await pixels();
        if (snap.hash !== hash) return snap;
        await page.waitForTimeout(50);
      }
      throw Error('Camera did not change visible geometry');
    };
    await camera.scrollIntoViewIfNeeded();
    await frame.waitFor({ timeout: 30000 });
    const opening = await pixels(),
      alpha = opening.alpha;
    assert(alpha > 1000 && opening.shades > 18);
    assert.match(await f.locator('.stage-status').innerText(), /\b[1-9]\d* textures?/);
    await camera.focus();
    await camera.press('ArrowRight');
    const turned = await waitChange(opening.hash);
    assert.notEqual(turned.alpha, alpha);
    await camera.press('Home');
    let reset = await waitChange(turned.hash);
    assert.equal(reset.alpha, opening.alpha);
    await button('Zoom in').click();
    assert((await waitChange(reset.hash)).alpha > alpha * 1.1);
    await button('Reset camera').click();
    await camera.focus();
    const box = await camera.boundingBox();
    await page.mouse.move(box.x + box.width * 0.47, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.52, { steps: 10 });
    await page.mouse.up();
    const dragged = await waitChange(reset.hash);
    assert.notEqual(dragged.alpha, alpha);
    await button('Reset camera').click();
    await page.waitForTimeout(250);
    let snap = await trace();
    await page.waitForTimeout(250);
    assert.equal((await trace()).draws, snap.draws, 'on-demand only while motion is reduced');
    console.log(
      'Live hull:',
      await f.locator('.stage-status').innerText(),
      'visible pixels',
      alpha,
      '→ keyboard',
      turned.alpha,
      '→ drag',
      dragged.alpha,
      '· shades',
      opening.shades
    );
    const handle = await stage.elementHandle();
    await f.locator(`[data-inspect="${support}"]`).click();
    await inspect.click();
    await f.locator(`[data-inspect="${support}"]`).click();
    await frame.waitFor();
    assert(await handle.evaluate(e => e === document.querySelector('armory-live-stage')));
    assert.match(await f.locator('.stage-status').innerText(), /A-9/i);
    assert.equal((await trace()).opened - (await trace()).closed, 1);
    await f.getByLabel('Preview mode').selectOption('portrait');
    assert.equal((await trace()).opened, (await trace()).closed);
    assert.equal(await frame.count(), 0);
    await inspect.click();
    await f.getByLabel('Preview mode').selectOption('live');
    await frame.waitFor();
    const count = Math.max(2, Math.ceil(1350 / cost));
    assert(count < 256);
    await f.getByLabel('Lead count').fill(String(count));
    await f.getByLabel('Companion', { exact: true }).selectOption(support);
    await button('Save flight card').click();
    await f.getByText('Card saved. Add it to a matching fleet in Instant Battle.').waitFor();
    await button('Add card to blueprint').click();
    await f.getByLabel('Preset name').fill('Escort detail');
    await button('Save preset').click();
    await f.getByText('Saved. Select this preset in Instant Battle for this faction.').waitFor();
    if (process.env.SWR_DESK_SHOTS) {
      await camera.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(process.env.SWR_DESK_SHOTS, 'flight-registry.png') });
    }
    const search = f.getByRole('searchbox', { name: 'Search units' });
    await search.fill('no_matching_32676');
    await f.getByText(/No matching space units/).waitFor();
    assert.equal(await f.locator('.flight-card input').count(), 0);
    await search.fill('');
    await inspect.focus();
    await inspect.press('ArrowDown');
    assert.notEqual(await f.locator('.armory-inspect[aria-pressed=true]').getAttribute('data-inspect'), lead);
    await inspect.click();
    await f.getByLabel('Lead count').fill('1');
    // Back keeps the dirty guard: Cancel stays in the desk, the discard route leaves for Home.
    await f.locator('.title-menu .mode-back:visible').click();
    await button('Cancel').click();
    assert.equal(await f.getByLabel('Lead count').inputValue(), '1');
    await f.getByLabel('Lead count').fill(String(count));
    await f.locator('.title-menu .mode-back:visible').click();
    await f.locator('.title-menu[data-section="home"]').waitFor();
    await click('TITLE_PLAY');
    const parked = await trace();
    assert(parked.opened - parked.closed <= 1, 'at most one parked renderer');
    await page.waitForTimeout(200);
    assert.equal((await trace()).draws, parked.draws, 'no GPU draws while the desk is closed');
    await click('IDC_MAIN_MENU_SINGLE_PLAYER_GAMES');
    await click('IDC_INSTANT_BATTLE_BUTTON');
    await actual().waitForFunction(() => stageTrace.opened === stageTrace.closed);
    await button('Edit fleets').click();
    await f.locator('#instantBattle .ib-editor:visible').waitFor();
    const preset = f.getByLabel('Fleet preset', { exact: true }),
      card = f.getByLabel('Flight card', { exact: true });
    await preset.selectOption('legacy');
    await button('Apply preset').click();
    const army = () => actual().evaluate(() => JSON.parse(localStorage.getItem('swr-instant-setup')).players[0].army);
    assert.deepEqual(await army(), [support]);
    const budget = f.locator('.ib-fleet').first().locator('input.ib-small');
    await budget.fill('1000');
    await budget.press('Tab');
    const before = await army();
    await card.selectOption(lead);
    assert(await button('Add flight card').isDisabled());
    assert.match(await f.locator('.ib-preset-message').innerText(), /Needs .* credits/);
    assert.deepEqual(await army(), before);
    await budget.fill('1000000');
    await budget.press('Tab');
    await preset.selectOption('legacy');
    await button('Apply preset').click();
    await card.selectOption(lead);
    await button('Add flight card').click();
    assert.deepEqual(await army(), [support, ...Array(count).fill(lead), support]);
    await preset.selectOption({ label: 'Escort detail' });
    await button('Apply preset').click();
    assert.deepEqual(await army(), [...Array(count).fill(lead), support]);
    assert.equal(await f.locator('.ib-unit.has').count(), 2);
    console.log(
      'PASS actual staging ·',
      faction,
      lead,
      count,
      '+',
      support,
      '· legacy replace, atomic budget rejection, card append, exact blueprint replace; hull pixels',
      alpha
    );
    await page.goto(origin);
    await click('TITLE_CUSTOMIZE'); await registry();
    await mount(ids[1]);
    const otherKey = await actual().evaluate(async () => (await import('./js/game/fleetpresets.js')).presetKey());
    assert.notEqual(key, otherKey);
    assert.equal(await f.locator('.blueprints option').count(), 1);
    assert.equal(await f.locator('.card-flag:visible').count(), 0);
    await page.setViewportSize({ width: 375, height: 667 });
    assert(await f.locator('.title-menu').evaluate(e => e.scrollWidth <= innerWidth));
    await camera.scrollIntoViewIfNeeded();
    await frame.waitFor();
    const mobile = await pixels();
    const mb = await camera.boundingBox(),
      cdp = await page.context().newCDPSession(page);
    const touch = async (type, x, y) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }] });
    const x = mb.x + mb.width * 0.4,
      y = mb.y + mb.height * 0.5;
    await touch('touchStart', x, y);
    for (let i = 1; i <= 6; i++) await touch('touchMove', x + i * 9, y + 1);
    await touch('touchEnd');
    await waitChange(mobile.hash);
    const oldScroll = await f.locator('.title-menu').evaluate(e => e.scrollTop);
    await touch('touchStart', x, y);
    for (let i = 1; i <= 6; i++) await touch('touchMove', x, y - i * 11);
    await touch('touchEnd');
    await page.waitForTimeout(400);
    assert((await f.locator('.title-menu').evaluate(e => e.scrollTop)) > oldScroll, 'vertical swipe still scrolls');
    await cdp.detach();
    await camera.scrollIntoViewIfNeeded();
    if (process.env.SWR_DESK_SHOTS) await page.screenshot({ path: path.join(process.env.SWR_DESK_SHOTS, 'flight-registry-mobile.png') });
    await mount(ids[0]);
    await f.getByLabel('Blueprint', { exact: true }).selectOption({ label: 'Escort detail' });
    await f.locator(`[data-inspect="${lead}"]`).click();
    assert.equal(await f.getByLabel('Lead count').inputValue(), String(count));
    assert.equal(await f.getByLabel('Companion', { exact: true }).inputValue(), support);
    // Fail just the optional hull request. The command portrait, facts and
    // deployment actions must remain usable without running another GL scene.
    const pattern = /\/asset\/Data\/Art\/Models\/.+(?:\?|$)/i;
    await page.route(pattern, route => route.fulfill({ status: 204 }));
    await f.locator(`[data-inspect="${support}"]`).click();
    await camera.scrollIntoViewIfNeeded();
    await f.getByText('Command portrait · live model unavailable').waitFor();
    assert(await f.getByRole('img', { name: /Command portrait of/ }).isVisible());
    assert(await button('Save flight card').isEnabled());
    await page.unroute(pattern);
    const otherFaction = await f.locator('.faction option').evaluateAll(os => os.find(o => !o.selected)?.value);
    await f.locator('.faction').selectOption(otherFaction);
    assert.equal(await f.locator('.blueprints option').count(), 1);
    assert.equal(await f.locator('.card-flag:visible').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      'PASS actual Thrawn → Fall → Thrawn isolation, separate factions, 375px layout, native hulls, missing-model fallback and saved card restore.'
    );
  } catch (e) {
    if (page)
      for (const frame of page.frames())
        console.error(
          frame.url(),
          (
            await frame
              .locator('body')
              .innerText({ timeout: 3000 })
              .catch(() => '')
          ).slice(-2000)
        );
    throw e;
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) {
      const exit = new Promise(ok => server.once('exit', ok));
      server.kill();
      await exit;
    }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
