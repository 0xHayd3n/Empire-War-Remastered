// Real Chrome, local stock + Fall, Revan and Rebellion packs. Set SWR_TEST_ALL_ERAS to check the whole roster.
const assert = require('node:assert/strict'),
  path = require('node:path'),
  { spawn } = require('node:child_process'),
  { chromium } = require('playwright-core');
(async () => {
  const port = Number(process.env.SWR_TEST_WINDOW_PORT || 8680),
    url = `http://127.0.0.1:${port}/`,
    server = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let b, page;
  try {
    await new Promise((ok, no) => {
      server.stdout.on('data', d => {
        if (d.toString().includes('Universal game:')) ok();
      });
      server.once('exit', () => no(Error('Test port unavailable')));
    });
    b = await chromium.launch({ channel: 'chrome' });
    page = await b.newPage({ viewport: { width: 1366, height: 768 } });
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (m.text().includes('Galaxy preview:')) console.error(m.text());
    });
    await page.goto(url);
    const f = page.frameLocator('#game');
    await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
    if (process.env.SWR_TEST_ALL_ERAS) {
      const eras = f.locator('[data-universal-screen="eras"]');
      async function choose(period, name) {
        await eras.getByRole('option', { name: period, exact: true }).click();
        await eras.getByRole('option', { name, exact: true }).click();
        await eras.getByRole('button', { name: 'Continue' }).click();
      }
      await f.locator('[data-id="IDC_SKIRMISH_GAMES_BUTTON"]').filter({ hasNotText: 'Instant Battle' }).click();
      await choose('Old Republic', 'Revan’s Revenge');
      await f.locator('[data-id="IDC_SKIRMISH_START_GAME_BUTTON"]').waitFor();
      await f.locator('[data-id="IDC_CANCEL_BUTTON"]').click();
      await eras.getByRole('button', { name: 'Back' }).click();
      await f.getByText('Instant Battle', { exact: true }).click();
      await choose('Galactic Civil War', 'Forces of Corruption');
      await f.locator('#instantBattle').getByRole('button', { name: 'Back', exact: true }).click();
      await eras.getByRole('button', { name: 'Back' }).click();
    }
    await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
    const board = f.locator('[data-universal-screen="campaign"]'),
      field = k => board.locator(`[data-field="${k}"]`),
      radio = (k, v) => field(k).locator(`input[type=radio][value="${v}"]`),
      checkedValue = k => field(k).locator('input:checked').inputValue(),
      slider = k => field(k).getByRole('slider'),
      group = id => board.locator(`.uc-roster section[data-profile="${id}"]`),
      current = board.locator('.uc-map-choice[aria-pressed="true"]'),
      eras = board.getByRole('group', { name: 'Era', exact: true }),
      eraCard = name => eras.getByRole('button', { name, exact: true }),
      dates = board.getByRole('group', { name: 'Time period', exact: true }),
      year = dates.getByRole('slider', { name: 'Starting year' }),
      selectPeriod = async label => {
        const tick = dates.locator(`[data-year="${label}"]`);
        if (!(await tick.count())) {
          if (label === 'Scenario starts' && !(await dates.getByRole('button').count())) return;
          return dates.getByRole('button', { name: label, exact: true }).click();
        }
        if (await year.isDisabled()) await dates.getByRole('button', { name: 'By year' }).click();
        const { width, height } = await year.boundingBox();
        const x = 8 + (width - 16) * (await tick.evaluate(e => parseFloat(e.style.left) / 100));
        await year.click({ position: { x, y: height / 2 } });
        assert.equal(
          await year.getAttribute('aria-valuetext'),
          ['4 ABY', '3996 BBY'].includes(label) ? `${label} · FTGU available` : label
        );
      };
    await current.waitFor();
    // Escape leaves setup without a visible Back control.
    await page.keyboard.press('Escape');
    await board.waitFor({ state: 'detached' });
    await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
    await current.waitFor();
    assert.equal(await board.count(), 1);
    assert.equal(await board.locator('[data-field="story"],[data-field="campaign"],[data-field="date"]').count(), 0);
    assert.equal(await eras.getByRole('button').count(), 4);
    assert.deepEqual(await eras.getByRole('button').allTextContents(), [
      'Old Republic',
      'Clone Wars',
      'Galactic Civil War',
      'New Republic'
    ]);
    const { decodePNG } = await import('../public/js/png.js');
    async function checkCrests() {
      const palettes = new Set(),
        rowTops = new Map(),
        imperial = new Set();
      for (const card of await eras.getByRole('button').all()) {
        const crest = card.locator('svg.uc-era-crest');
        assert.equal(await crest.count(), 1);
        const palette = await card.evaluate(e =>
          ['--crest-left', '--crest-right'].map(k => getComputedStyle(e).getPropertyValue(k).trim())
        );
        palettes.add(palette.join('/'));
        const sides = await card.evaluate(e => ['--era-left', '--era-right'].map(k => getComputedStyle(e).getPropertyValue(k).trim()));
        const y = (await card.boundingBox()).y,
          crestY = (await crest.boundingBox()).y;
        if (rowTops.has(y)) assert.equal(crestY, rowTops.get(y), 'Crests must share a baseline within each card row');
        rowTops.set(y, crestY);
        const name = await card.getAttribute('data-era');
        if (name === 'New Republic' || name === 'Galactic Civil War') imperial.add([sides[1], palette[1]].join('/'));
        if (name === 'Clone Wars') {
          assert.equal(sides[0], '#f6f6f5');
          assert.equal(palette[0], '#a52032');
        }
        const shot = await decodePNG(Uint8Array.from(await card.screenshot()).buffer);
        for (const [i, x] of [5, shot.width - 6].entries()) {
          const rgb = shot.data.subarray(4 * (6 * shot.width + x), 4 * (6 * shot.width + x) + 3);
          const distance = hex =>
            hex
              .slice(1)
              .match(/../g)
              .reduce((sum, v, j) => sum + Math.abs(rgb[j] - parseInt(v, 16)), 0);
          assert(distance(sides[i]) + 35 < distance(sides[1 - i]), `Wrong background side on ${await card.textContent()}`);
        }
        const { width: w, height: h, data } = await decodePNG(Uint8Array.from(await crest.screenshot()).buffer);
        for (const [side, color] of palette.entries()) {
          assert.match(color, /^#[a-f\d]{6}$/i);
          const rgb = color
            .slice(1)
            .match(/../g)
            .map(v => parseInt(v, 16));
          let hits = 0,
            wrong = 0;
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++)
              if (rgb.every((n, c) => Math.abs(data[4 * (y * w + x) + c] - n) < 10)) {
                if (x < w / 2 === (side === 0)) hits++;
                else wrong++;
              }
          assert(
            hits > w * h * 0.035 && wrong < w * h * 0.015,
            `Split emblem: ${await card.textContent()}, ${color}, ${hits}/${wrong} at ${w}x${h}`
          );
        }
      }
      assert.equal(palettes.size, 4);
      assert.deepEqual([...imperial], ['#060606/#ffffff']);
      assert(
        await dates.locator('.uc-year-tick small').evaluateAll(labels => {
          const visible = labels.filter(e => getComputedStyle(e).visibility !== 'hidden').map(e => e.getBoundingClientRect());
          return visible.every((r, i) => !i || r.left >= visible[i - 1].right);
        }),
        'Year labels must not overlap'
      );
    }
    await checkCrests();
    assert.equal(await year.count(), 0, 'undated era has no synthetic year axis');
    assert.equal(await eraCard('Galactic Civil War').getAttribute('aria-pressed'), 'true');
    const tabs = board.getByRole('tablist', { name: 'Storyline' }),
      panel = board.getByRole('tabpanel');
    assert.equal(await tabs.getByRole('tab').count(), 3);
    assert.equal(await panel.count(), 1);
    await tabs.getByRole('tab', { selected: true }).press('ArrowRight');
    assert.equal(await board.getAttribute('data-campaign'), '');
    assert(await board.getByRole('button', { name: 'Start campaign' }).isDisabled());
    await tabs.getByRole('tab', { selected: true }).press('Home');
    await panel.locator('.uc-map-choice').first().click();
    const native = board.locator('.uc-canvas[data-scene="native"]');
    await native.waitFor();
    async function checkContext() {
      const stats = await native.evaluate(async e => {
        await new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)));
        const c = e.querySelector('.uc-context'),
          labels = e.querySelector('.uc-worlds'),
          rect = c.getBoundingClientRect(),
          css = getComputedStyle(c),
          sx = c.width / rect.width,
          sy = c.height / rect.height,
          image = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let ink = 0,
          clashes = 0;
        for (let i = 0; i < image.length; i += 4)
          if (image[i + 3]) {
            ink++;
            // Native source portraits are full-color; the composed context layer is grayscale.
          }
        const check = (l, t, r, b) => {
          for (let y = Math.max(0, Math.ceil(t * sy)); y < Math.min(c.height, Math.floor(b * sy)); y++)
            for (let x = Math.max(0, Math.ceil(l * sx)); x < Math.min(c.width, Math.floor(r * sx)); x++)
              if (image[4 * (y * c.width + x) + 3]) clashes++;
        };
        const map = labels.getBoundingClientRect();
        for (const label of labels.children) {
          const r = label.getBoundingClientRect();
          check(r.left - rect.left, r.top - rect.top, r.right - rect.left, r.bottom - rect.top);
          const X = map.left - rect.left + (parseFloat(label.style.left) * map.width) / 100,
            Y = map.top - rect.top + (parseFloat(label.style.top) * map.height) / 100;
          const r0 = Number(e.querySelector('.uc-active-globes').dataset.diameter) / 2;
          check(X - r0, Y - r0, X + r0, Y + r0);
        }
        return {
          ink,
          clashes,
          opacity: css.opacity,
          filter: css.filter,
          activeOpacity: getComputedStyle(labels).opacity,
          top: !!(c.compareDocumentPosition(labels) & Node.DOCUMENT_POSITION_FOLLOWING)
        };
      });
      assert(stats.ink > 0, 'Inactive planets should still be visible');
      assert.deepEqual({ ...stats, ink: 0 }, { ink: 0, clashes: 0, opacity: '0.2', filter: 'grayscale(1)', activeOpacity: '1', top: true });
    }
    await checkContext();
    const librarySheets = await native.locator('.uc-context').getAttribute('data-sheet-count');
    assert(Number(librarySheets) > 0);
    await native.locator(`.uc-context[data-loaded-sheets="${librarySheets}"]`).waitFor();
    const firstPlate = await native.getAttribute('data-backdrop-renders');
    assert(Number(await native.locator('.uc-context').getAttribute('data-inactive')) > 0, 'Missing inactive worlds');
    assert(await native.locator('.uc-context-note').isVisible());
    await panel.locator('.uc-map-choice').nth(1).click();
    await native.waitFor();
    // The first row may have been served entirely from the still cache before changing back to stock.
    await panel.getByRole('button', { name: /Equal Footing/ }).click();
    await native.waitFor();
    const globes = native.locator('.uc-active-globes');
    assert.equal(
      Number(await globes.getAttribute('data-detailed')),
      await native.locator('[data-planet]').count(),
      'Every active stock planet has mounted art'
    );
    assert(Number(await native.locator('.uc-context').getAttribute('data-detailed')) > 0, 'Off-map planets use mounted art too');
    assert(Number(await native.getAttribute('data-routes')) > 0);
    assert(
      firstPlate && (await native.getAttribute('data-backdrop-renders')) === firstPlate,
      'Second stock map reuses the prerendered backdrop'
    );
    assert(
      await native.evaluate(e => {
        const [a, b] = [...e.querySelectorAll('.uc-plane canvas')].map(c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
        let lit = 0,
          match = 0;
        for (let i = 0; i < a.length; i += 64)
          if (a[i] + a[i + 1] + a[i + 2] > 25) {
            lit++;
            if (Math.max(...[0, 1, 2].map(j => Math.abs(a[i + j] - b[i + j]))) <= 1) match++;
          }
        return lit > 100 && match > lit * 0.7;
      }),
      'Backdrop pixels must survive the foreground pass upright and without a color shift'
    );
    const galaxy = board.locator('.uc-map'),
      r = await galaxy.boundingBox();
    async function drag(x1, y1, x2, y2) {
      await page.mouse.move(r.x + x1, r.y + y1);
      await page.mouse.down();
      await page.mouse.move(r.x + x2, r.y + y2, { steps: 3 });
      await page.mouse.up();
    }
    const bounds = () =>
      galaxy.evaluate(e => {
        const a = e.getBoundingClientRect(),
          b = e.firstElementChild.getBoundingClientRect();
        return [a.left - b.left, a.top - b.top, b.right - a.right, b.bottom - a.bottom];
      });
    const settleZoom = z =>
      galaxy.evaluate(async (e, wanted) => {
        const start = performance.now();
        while (performance.now() - start < 3000) {
          await new Promise(requestAnimationFrame);
          const plane = new DOMMatrix(getComputedStyle(e.querySelector('.uc-plane')).transform);
          if (
            Math.abs(plane.a - wanted) < 0.00001 &&
            Math.abs(Number(e.querySelector('.uc-active-globes').dataset.diameter) - wanted * 6) < 0.00001
          )
            return;
        }
        throw Error('Camera did not reach ' + wanted);
      }, z);
    await galaxy.press('Home');
    await settleZoom(1);
    const label = native.locator('[data-planet]').first();
    const labelSize = await label.boundingBox();
    await label.dispatchEvent('dblclick');
    await settleZoom(1.8);
    assert.equal(await mapZoomed(), true);
    await checkContext();
    const labelGain = (await label.boundingBox()).width / labelSize.width;
    assert(labelGain > 1 && labelGain < 1.78, 'Labels must grow more slowly than planets');
    assert.equal(await label.evaluate(e => getComputedStyle(e).textShadow), 'none');
    assert(Math.abs(Number(await globes.getAttribute('data-diameter')) - 6 * 1.8) < 0.02);
    async function mapZoomed() {
      return galaxy.evaluate(e => e.hasAttribute('data-zoomed'));
    }
    await galaxy.press('Home');
    await settleZoom(1);
    await drag(20, 20, 220, 165);
    assert.deepEqual(await bounds(), [0, 0, 0, 0]);
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.wheel(0, -120);
    await board.locator('.uc-map[data-zoomed]').waitFor();
    for (const [a, b] of [
      [0.2, 0.8],
      [0.8, 0.2]
    ]) {
      await drag(r.width * a, r.height * a, r.width * b, r.height * b);
      const gaps = await bounds();
      assert(
        gaps.every(n => n >= -0.05),
        `Viewport exposed: ${gaps}`
      );
    }
    await galaxy.press('Home');
    await settleZoom(1);
    assert.deepEqual(await bounds(), [0, 0, 0, 0]);
    const root = await board.evaluate(e => (e.marker = crypto.randomUUID()));
    let docs = 0,
      mounts = 0,
      assets = 0;
    page.on('request', r => {
      if (r.isNavigationRequest() && r.url().includes('play.html')) docs++;
      if (r.url().includes('/api/mount/')) mounts++;
      if (r.url().includes('/asset/') && !r.url().startsWith(`http://127.0.0.1:${port + 1}/`)) assets++;
    });
    const times = [],
      checked = new Set();
    async function select(id) {
      const t = performance.now();
      const name =
        { 3417277973: 'Old Republic', 1976399102: 'Clone Wars', 3387971722: 'Clone Wars', 1125571106: 'New Republic' }[id] ||
        'Galactic Civil War';
      const changed = (await eraCard(name).getAttribute('aria-pressed')) !== 'true';
      await eraCard(name).click();
      if (changed) {
        assert.equal(await board.getAttribute('data-campaign'), '');
        assert(await board.getByRole('button', { name: 'Start campaign' }).isDisabled());
      }
      const date = { 3417277973: '3964 BBY', 1976399102: '22 BBY', 1125571106: '4 ABY' }[id] || 'Scenario starts';
      await selectPeriod(date);
      await tabs.locator(`[data-profile="${id}"]`).click();
      await group(id).locator('.uc-map-choice').first().click();
      assert.equal(await board.getAttribute('data-profile'), id);
      const count = await board.locator('[data-planet]').count();
      assert.match(await current.locator('.uc-planet-count').innerText(), new RegExp('^' + count + ' (setup )?planets?$'));
      assert.equal(await board.evaluate(e => e.marker), root);
      times.push(Math.round(performance.now() - t));
      if (process.env.SWR_TEST_ALL_ERAS && !checked.has(id)) {
        await board.locator('[data-scene="native"],[data-scene="unavailable"]').waitFor();
        assert.equal(await board.locator('.uc-canvas').getAttribute('data-scene'), 'native', id + ' preview');
        await galaxy.press('Home');
        await settleZoom(1);
        assert.equal(Number(await globes.getAttribute('data-diameter')), 6, id + ' world size at the same camera zoom');
        assert.equal(Number(await globes.getAttribute('data-worlds')), count, id + ' renders every active location');
        assert(
          await field('faction')
            .locator('.uc-face')
            .evaluateAll(
              es => es.length > 0 && es.every(e => ['img.uc-crest', 'img.uc-portrait'].every(k => e.querySelector(k)?.naturalWidth > 0))
            ),
          id + ' faction pictures'
        );
        const keyOwners = await board.locator('.uc-key > span').evaluateAll(es =>
          es.map(e => {
            if (!e.querySelector('img.uc-crest,b.uc-monogram')) throw Error('no owner badge');
            return e.dataset.owner;
          })
        );
        assert.deepEqual(
          keyOwners.sort(),
          [...new Set(await board.locator('[data-planet]').evaluateAll(es => es.map(e => e.dataset.owner)))].sort()
        );
        assert.equal(await native.getAttribute('data-backdrop-renders'), firstPlate, 'Storyline switches keep one galaxy');
        checked.add(id);
      }
    }
    await select('1976399102');
    await radio('faction', 'Rebel').check();
    assert.match(await board.getAttribute('data-campaign'), /Rebel/i);
    await radio('faction', 'Empire').check();
    const fall = group('1976399102');
    await selectPeriod('20 BBY');
    await fall.getByRole('button', { name: /Known Galaxy - Medium/ }).click();
    assert.match(await board.getAttribute('data-campaign'), /Medium_Era_4_Empire/i);
    assert.equal(await year.getAttribute('aria-valuetext'), '20 BBY');
    const corellia = board.locator('[data-planet="Corellia"]');
    await corellia.evaluate(el => (el.ucReuseCheck = true));
    const checkMap = async () => {
      const rows = await board
        .locator('[data-planet]')
        .evaluateAll(es => es.map(e => [e.dataset.planet, e.dataset.owner, e.title, e.style.getPropertyValue('--owner')]));
      assert.equal(new Set(rows.map(r => r[0])).size, rows.length);
      return rows;
    };
    const beforeYear = await checkMap();
    await galaxy.press('Home');
    await settleZoom(1);
    await corellia.dispatchEvent('dblclick');
    await settleZoom(1.8);
    const aimed = await galaxy.locator('.uc-plane').evaluate(e => e.style.transform);
    await selectPeriod('19 BBY');
    await native.waitFor();
    assert.equal(await galaxy.locator('.uc-plane').evaluate(e => e.style.transform), aimed, 'Related year should preserve player framing');
    assert(await corellia.evaluate(el => el.ucReuseCheck === true), 'Shared label should survive a year switch');
    const laterYear = await checkMap(),
      owners = new Map(beforeYear.map(row => row));
    assert(
      laterYear.some(([n, o]) => owners.has(n) && owners.get(n) !== o),
      'Fixture must exercise changed ownership'
    );
    await selectPeriod('20 BBY');
    await native.waitFor();
    assert.deepEqual(await checkMap(), beforeYear, 'Exact map order and ownership must round-trip');
    await fall.getByRole('button', { name: /From the Ground Up/ }).click();
    assert.equal(await year.getAttribute('aria-valuetext'), '20 BBY');
    await year.focus();
    await page.keyboard.press('Home');
    assert.equal(await year.getAttribute('aria-valuetext'), 'FTGU · pre-22 BBY');
    assert.equal(await fall.locator('.uc-map-choice').count(), 1);
    assert.equal(await dates.getByRole('button', { name: /FTGU/i }).count(), 0);
    await page.keyboard.press('ArrowRight');
    assert.equal(await year.getAttribute('aria-valuetext'), '22 BBY');
    await selectPeriod('FTGU · pre-22 BBY');
    await selectPeriod('21 BBY');
    assert.equal(await board.getAttribute('data-campaign'), 'Sandbox_FTGU_Republic');
    await board.getByRole('button', { name: 'Reset settings' }).click();
    assert.equal(await year.getAttribute('aria-valuetext'), '19 BBY');
    assert.equal(await board.getAttribute('data-campaign'), 'Sandbox_FTGU_Republic');
    assert.equal(await fall.getByRole('button', { name: /Foerost Campaign/ }).count(), 0);
    await selectPeriod('20 BBY');
    await fall.getByRole('button', { name: /Foerost Campaign/ }).click();
    assert.match(await current.textContent(), /Foerost/);
    assert.equal(await group('3387971722').count(), 0);
    await selectPeriod('21 BBY');
    assert.equal(await current.count(), 0);
    assert(await board.getByRole('button', { name: 'Start campaign' }).isDisabled());
    await selectPeriod('20 BBY');
    await fall.getByRole('button', { name: /Known Galaxy - Small/ }).click();
    assert.equal(await year.getAttribute('aria-valuetext'), '20 BBY');
    await select('3417277973');
    assert.equal(await dates.getByRole('button').count(), 2);
    assert.equal(await dates.locator('[data-year="3976 BBY"]').count(), 0);
    const stops = await dates.locator('[data-year]').evaluateAll(es => es.map(e => parseFloat(e.style.left) / 100));
    assert.equal(stops.length, 5);
    assert(stops.every((s, i) => Math.abs(s - [0, 32 / 39, 34 / 39, 37 / 39, 1][i]) < 1e-5));
    await selectPeriod('Scenario starts');
    assert(await year.isDisabled());
    assert.equal(await year.inputValue(), '-3964');
    assert.equal(await current.count(), 0);
    assert(await board.getByRole('group', { name: 'Scenarios', exact: true }).isVisible());
    if (process.env.SWR_TEST_SCREENSHOTS)
      await dates.screenshot({ path: path.join(process.env.SWR_TEST_SCREENSHOTS, 'scenario-mode.png') });
    await group('3417277973')
      .getByRole('button', { name: /Mandalorian Onslaught/ })
      .click();
    assert.match(await current.textContent(), /3964 - 3962 BBY/);
    assert.equal(
      await group('3417277973')
        .getByRole('button', { name: /From the Ground Up/ })
        .count(),
      1
    );
    await dates.getByRole('button', { name: 'By year' }).press('Space');
    assert(await year.isEnabled());
    assert.equal(await year.getAttribute('aria-valuetext'), '3964 BBY');
    await year.focus();
    assert.equal(await current.count(), 0);
    await page.keyboard.press('ArrowRight');
    assert.equal(await year.getAttribute('aria-valuetext'), '3962 BBY');
    const track = await year.boundingBox(),
      pos = t => track.x + 8 + (track.width - 16) * t;
    await page.mouse.move(pos(34 / 39), track.y + track.height / 2);
    await page.mouse.down();
    await page.mouse.move(pos(37 / 39), track.y + track.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.equal(await year.getAttribute('aria-valuetext'), '3959 BBY');
    assert.equal(await group('3417277973').locator('.uc-map-choice').count(), 1);
    assert.equal(await dates.locator('button[aria-pressed="true"]').innerText(), 'By year');
    const revan = group('3417277973'),
      chooseFtgu = () => revan.getByRole('button', { name: /From the Ground Up/ }).click();
    await selectPeriod('Scenario starts');
    await chooseFtgu();
    await field('credits').selectOption('3000');
    await selectPeriod('3996 BBY');
    await chooseFtgu();
    assert.equal(await revan.locator('.uc-map-choice').count(), 1);
    assert(await field('credits').isHidden());
    assert.equal(await field('faction').getByRole('radio').count(), 3);
    await selectPeriod('Scenario starts');
    assert.equal(await field('credits').inputValue(), '');
    await field('credits').selectOption('2000');
    await dates.getByRole('button', { name: 'By year' }).click();
    assert.equal(await year.inputValue(), '-3996');
    await selectPeriod('Scenario starts');
    assert.equal(await field('credits').inputValue(), '', 'Fixed date must discard custom era credits on the same FTGU row');
    await select('1397421866');
    if (process.env.SWR_TEST_ALL_ERAS) for (const id of ['1125571106', '3387971722', '1770851727', 'stock']) await select(id);
    await select('1976399102');
    await radio('faction', 'Empire').check();
    await fall.getByRole('button', { name: /Known Galaxy - Small/ }).click();
    await selectPeriod('20 BBY');
    if (process.env.SWR_TEST_THR) {
      await select('1125571106');
      await radio('faction', 'Empire').check();
      await group('1125571106').locator('[data-family="KnownSmall_Era_1_Rebel"]').click();
      await selectPeriod('11.5 ABY');
      assert.equal(await year.inputValue(), '11.5');
      await selectPeriod('6 ABY');
      const regimes = board.getByRole('group', { name: 'Starting variant' });
      await regimes.getByRole('button', { name: '6 ABY · Central Committee', exact: true }).click();
      assert.equal(await field('faction').getByRole('radio').count(), 1);
    }
    const opening = process.env.SWR_TEST_FTGU;
    if (opening) {
      if (process.env.SWR_TEST_THR) {
        await selectPeriod('4 ABY');
        const label = dates.locator('[data-year="4 ABY"] small');
        assert.match(await label.innerText(), /FTGU/);
        assert(await label.evaluate(e => e.getBoundingClientRect().height <= parseFloat(getComputedStyle(e).lineHeight) + 1));
        assert.match(await group('1125571106').locator('.uc-map-choice').first().innerText(), /From the Ground Up/);
        await group('1125571106')
          .getByRole('button', { name: /From the Ground Up/ })
          .click();
        await radio('faction', 'Empire').check();
        await field('progression').selectOption('on');
        await board.getByRole('button', { name: 'Reset settings' }).click();
        assert.equal(await field('progression').inputValue(), '');
        await field('progression').selectOption('on');
      } else {
        await selectPeriod('FTGU · pre-22 BBY');
        await fall.getByRole('button', { name: /From the Ground Up/ }).click();
        await radio('faction', 'Rebel').check();
      }
    }
    const revanLaunch = process.env.SWR_TEST_REVAN,
      destination = revanLaunch ? '3417277973' : process.env.SWR_TEST_THR ? '1125571106' : '1976399102';
    if (revanLaunch) {
      await select('3417277973');
      if (revanLaunch === 'scenario') {
        await selectPeriod('Scenario starts');
        await revan.getByRole('button', { name: /Mandalorian Onslaught/ }).click();
      } else {
        await selectPeriod('3996 BBY');
        await chooseFtgu();
      }
      await radio('faction', 'Underworld').check();
    }
    const target = await board.getAttribute('data-campaign');
    assert.match(
      target,
      revanLaunch
        ? revanLaunch === 'scenario'
          ? /^Sandbox_MandalorianOnslaught_Mandalorian$/i
          : /^Sandbox_FTGU_Mandalorian$/i
        : process.env.SWR_TEST_THR
          ? opening
            ? /^FTGU_Era_1_Empire$/i
            : /KnownSmall_Era_2_Empire_CCoGM/i
          : opening
            ? /^Sandbox_FTGU_CIS$/i
            : /Era_4_Empire/i
    );
    const stars = await board.locator('[data-planet]').evaluateAll(es => es.map(e => [e.dataset.planet, e.dataset.owner]));
    assert(stars.length > 10 && new Set(stars.map(p => p[1])).size > 1);
    assert.equal(await board.getByRole('button', { name: /Zoom|Fit|Configure|Back/i }).count(), 0);
    assert.equal(await field('difficulty').getByRole('radio').count(), 3);
    assert.equal(await slider('preset').getAttribute('aria-valuetext'), 'Campaign defaults');
    await slider('preset').focus();
    await page.keyboard.press('ArrowRight');
    assert.notEqual(await slider('preset').getAttribute('aria-valuetext'), 'Campaign defaults');
    await page.keyboard.press('Home');
    assert.equal(await checkedValue('treasury'), '');
    await slider('politics').focus();
    const nativePolitics = await slider('politics').getAttribute('aria-valuetext');
    await page.keyboard.press('End');
    if ((await slider('politics').getAttribute('aria-valuetext')) === nativePolitics) await page.keyboard.press('Home');
    const politics = Number.parseInt((await slider('politics').getAttribute('aria-valuetext')).replaceAll(',', ''));
    assert(Number.isFinite(politics));
    await radio('difficulty', 'hard').check();
    const cap = await field('treasury')
      .locator('input')
      .evaluateAll(os => os.find(o => o.value !== '')?.value);
    await radio('treasury', cap).check();
    assert.equal(docs, 0);
    assert.equal(mounts, 0);
    assert.equal(assets, 0);
    const snap = async name => {
      if (process.env.SWR_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SWR_TEST_SCREENSHOTS, name + '.png') });
    };
    const inline = () =>
      board.evaluate(e => {
        const p = e.querySelector('aside').getBoundingClientRect(),
          m = e.querySelector('.uc-map').getBoundingClientRect();
        return p.right === innerWidth && p.top === 0 && p.height === innerHeight && m.right === p.left && m.height === innerHeight;
      });
    assert(await inline());
    assert((await board.locator('.uc-key span:visible').count()) > 1);
    await board.locator('[data-scene="native"],[data-scene="unavailable"]').waitFor();
    assert.equal(await board.locator('.uc-canvas').getAttribute('data-scene'), 'native');
    assert(Number(await board.locator('.uc-active-globes').getAttribute('data-detailed')) > 10);
    await current.scrollIntoViewIfNeeded();
    await field('faction').scrollIntoViewIfNeeded();
    await snap('era-map-browser');
    await field('politics').scrollIntoViewIfNeeded();
    await snap('rule-controls');
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await inline());
    assert.equal(await checkedValue('difficulty'), 'hard');
    await field('faction').scrollIntoViewIfNeeded();
    assert(await board.locator('.uc-fields').evaluate(e => e.scrollWidth === e.clientWidth));
    assert(await board.locator('.uc-roster').evaluate(e => e.scrollWidth === e.clientWidth));
    assert(await eras.evaluate(e => e.scrollWidth === e.clientWidth && [...e.children].every(b => b.getBoundingClientRect().width > 0)));
    await checkCrests();
    await snap('era-narrow');
    await page.setViewportSize({ width: 1366, height: 768 });
    assert.equal(await checkedValue('treasury'), cap);
    assert.equal(await board.getAttribute('data-campaign'), target);
    const mountUrl = `**/api/mount/${destination}`;
    await page.route(mountUrl, r => r.fulfill({ status: 409, body: 'Test mount unavailable' }));
    await board.getByRole('button', { name: 'Start campaign' }).click();
    await board.getByRole('status').filter({ hasText: 'Test mount unavailable' }).waitFor();
    assert.equal(await board.getAttribute('data-campaign'), target);
    assert.equal(await board.getByRole('button', { name: 'Start campaign' }).getAttribute('aria-disabled'), 'false');
    await page.unroute(mountUrl);
    mounts = 0;
    await Promise.all([
      page.waitForEvent('framenavigated', { predicate: fr => fr.url().includes('universal-start') }),
      board.getByRole('button', { name: 'Start campaign' }).click()
    ]);
    const runtime = page.frames().find(fr => fr.parentFrame() === page.mainFrame());
    await runtime.waitForFunction(() => !!window.game?.story && !!game.galaxy?.planets.length, null, { timeout: 150000 });
    if (revanLaunch) await runtime.waitForFunction(() => game.story.values.has('GALACTIC_YEAR'), null, { timeout: 20000 });
    const actual = await runtime.evaluate(() => ({
      era: game.story.values.get('CURRENT_ERA'),
      year: game.story.values.get('GALACTIC_YEAR'),
      creditOverride: game.setup.campaignSettings?.credits,
      target: game.setup.campaign,
      campaign: game.galaxy.campaign.name,
      planets: game.galaxy.planets.filter(p => !p.background).map(p => p.name),
      difficulty: game.setup.difficulty,
      startingTech: game.setup.startingTechLevel ?? game.setup.campaignSettings?.tech,
      rules: game.galaxy.universalRules,
      origin: location.origin,
      isolated: crossOriginIsolated
    }));
    assert.equal(actual.origin, `http://127.0.0.1:${port + (revanLaunch ? 4 : process.env.SWR_TEST_THR ? 2 : 3)}`);
    assert.equal(actual.target, target);
    assert.equal(actual.campaign, target);
    if (revanLaunch) {
      assert.equal(actual.year, revanLaunch === 'scenario' ? -3964 : -3996);
      if (revanLaunch !== 'scenario') assert.equal(actual.era, 1);
      assert.equal(actual.creditOverride, undefined);
    } else if (opening) assert.equal(actual.startingTech, process.env.SWR_TEST_THR ? 4 : 0);
    assert.deepEqual(
      actual.planets,
      stars.map(p => p[0])
    );
    assert.equal(actual.difficulty, 'hard');
    assert.equal(actual.rules.treasury, +cap);
    assert.equal(actual.rules.politics, politics);
    assert(actual.isolated);
    assert.equal(docs, 1);
    assert.equal(mounts, 1);
    assert.equal(page.url(), url);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        switchChecksMs: times,
        previewPlanets: stars.length,
        uniqueOwners: new Set(stars.map(p => p[1])).size,
        nativeProfiles: [...checked],
        documentLoadsWhileBrowsing: 0,
        launchDocuments: docs,
        era: actual.era,
        year: actual.year,
        target,
        passed: true
      })
    );
  } catch (e) {
    if (page)
      for (const fr of page.frames())
        console.error(
          fr.url(),
          (
            await fr
              .locator('body')
              .innerText({ timeout: 1000 })
              .catch(() => '')
          ).slice(-950)
        );
    throw e;
  } finally {
    await b?.close();
    server.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
