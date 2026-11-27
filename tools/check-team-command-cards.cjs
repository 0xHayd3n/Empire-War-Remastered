// The real Teams tab and a real assignment for every installed roster. The
// portrait is sampled off the CARD, never the focused ring or an atlas icon.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }),
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Observe the private studio without publishing a game/QA global in production.
    await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      window.__cardContexts = [];
      HTMLCanvasElement.prototype.getContext = function (type, opts, ...rest) {
        const gl = get.call(this, type, opts, ...rest);
        if (
          type === 'webgl2' &&
          gl &&
          opts?.preserveDrawingBuffer &&
          opts?.powerPreference === 'low-power' &&
          !window.__cardContexts.includes(gl)
        )
          window.__cardContexts.push(gl);
        return gl;
      };
    });
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      board = f.locator('[data-universal-screen="skirmish"]');
    for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_SKIRMISH_GAMES_BUTTON'])
      await f.locator(`[data-id="${id}"]`).click({ timeout: 90000 });
    await board.getByRole('tab', { name: 'Teams' }).click();
    const first = board.locator('.op-seat-card[data-seat="0"]'),
      stage = board.locator('.op-command-stage');
    // No click on a faction/portrait is needed to see the character options.
    await stage.locator('.op-ring-assign[data-source="stock"]').waitFor({ timeout: 90000 });
    await first.locator('.op-card-still[src]').waitFor({ timeout: 45000 });
    assert.equal(await board.locator('.op-team-list .op-commander-portrait,.op-team-list table,.op-seat-card canvas').count(), 0);
    const paint = board.getByLabel('Opponent 1 color', { exact: true }),
      ai = board.locator('.op-seat-card[data-seat="1"]'),
      skill = board.getByLabel('Opponent 1 difficulty', { exact: true });
    const base = await ai.evaluate(b => b.style.getPropertyValue('--faction-ink'));
    await paint.fill('#41f284');
    await skill.selectOption('hard');
    assert.equal(await paint.inputValue(), '#41f284');
    assert.equal(await ai.evaluate(b => b.style.getPropertyValue('--faction-ink')), base);
    const saved = await ai.getAttribute('data-roster');
    await ai.locator('[data-choose-seat]').click();
    await stage.getByRole('searchbox').fill('Nute Gunray');
    assert.equal(await ai.getAttribute('data-roster'), saved);
    await stage.getByRole('searchbox').press('Escape');
    assert.equal(await ai.getAttribute('data-roster'), saved);
    assert(await ai.locator('[data-choose-seat]').evaluate(b => b === document.activeElement));
    await ai.locator('[data-choose-seat]').click();
    await stage.getByRole('searchbox').fill('Nute Gunray');
    await stage.locator('.op-ring-assign[data-source="1976399102"][data-faction="Trade_Federation"]').click();
    assert.equal(await ai.getAttribute('data-roster'), '1976399102/Trade_Federation');
    assert(await stage.isVisible(), 'Assign should keep commander selection open instead of returning to the galaxy');
    assert(!(await board.locator('.op-galaxy').isVisible()), 'the galaxy must stay hidden on Assign');
    assert.equal(await ai.evaluate(b => b.style.getPropertyValue('--faction-ink')), '#4977af');
    assert.equal(await paint.inputValue(), '#41f284');
    assert.equal(await skill.inputValue(), 'hard');
    assert.equal(await stage.getByRole('searchbox').inputValue(), 'Nute Gunray');
    assert(await stage.locator('.op-ring-assign').evaluate(b => b === document.activeElement));
    assert(await board.locator('.op-go').evaluate(b => !b.closest('[inert]')), 'Assign should unlock the battle footer');

    // Hero first, destination second: a directory pick is still a preview.
    const firstRoster = await first.getAttribute('data-roster');
    await stage.locator('.op-faction-toggle').click();
    await stage.locator('button[data-roster="1976399102/Empire"]').click();
    await first.locator('[data-choose-seat]').click();
    const yoda = stage.locator('.op-ring-assign[data-source="1976399102"][data-faction="Empire"]');
    assert(await yoda.isVisible(), 'switching the target player must keep an unassigned hero in view');
    assert.equal(await first.getAttribute('data-roster'), firstRoster);
    assert.equal(await first.locator('[data-choose-seat]').getAttribute('aria-expanded'), 'true');
    assert.equal(await ai.locator('[data-choose-seat]').getAttribute('aria-expanded'), 'false');
    await stage.locator('.op-ring-arena').press('Enter');
    assert.equal(await first.getAttribute('data-roster'), '1976399102/Empire');
    assert.equal(await ai.getAttribute('data-roster'), '1976399102/Trade_Federation');
    assert(await yoda.isVisible());
    await ai.locator('[data-choose-seat]').click();
    assert(await stage.locator('.op-ring-assign[data-source="1976399102"][data-faction="Trade_Federation"]').isVisible(),
      'with no pending preview, show the newly selected player’s own hero');
    for (const card of [first, ai]) await card.locator('.op-card-still[src]').waitFor({ timeout: 45000 });
    const stillUrls = await board.locator('.op-card-still').evaluateAll(imgs => imgs.map(i => i.src));
    await board.getByRole('tab', { name: 'Settings' }).click();
    await board.getByRole('tab', { name: 'Teams' }).click();
    for (const [width, height] of [
      [1440, 900],
      [390, 844]
    ]) {
      await page.setViewportSize({ width, height });
      await stage.locator('canvas').waitFor();
      for (const card of [first, ai]) await card.locator('.op-card-still[src]').evaluate(im => im.decode());
      assert.deepEqual(
        await board.locator('.op-card-still').evaluateAll(imgs => imgs.map(i => i.src)),
        stillUrls,
        'returning to Teams must reuse the cached portraits'
      );
      assert(await board.getByRole('tab', { name: 'Teams' }).isVisible());
      const a = await first.boundingBox(),
        s = await stage.boundingBox();
      assert(a.width > 200 && a.x >= 0 && a.x + a.width <= width + 1 && (width > 680 ? s.x + s.width <= a.x : s.y + s.height <= a.y));
      assert(await board.locator('.op-go').isDisabled(), 'Teams must not select a battlefield');
      if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `team-command-cards-${width}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    const audit = await board.evaluate(async board => {
      const wait = async (fn, msg) => {
        const end = performance.now() + 30000;
        while (!fn()) {
          if (performance.now() > end) throw Error(msg);
          await new Promise(r => setTimeout(r, 25));
        }
      };
      const seen = new Set(),
        rows = [],
        fingerprints = new Set(),
        per = 9,
        W = 142,
        H = 116;
      const n = +board.querySelector('.op-command-stage').dataset.total,
        { profiles } = await (await import('/js/game/solooperationlibrary.js')).soloLibrary();
      const sheet = document.createElement('canvas');
      sheet.width = W * per;
      sheet.height = H * Math.ceil(n / per);
      const cx = sheet.getContext('2d');
      for (let i = 0; i < n; i++) {
        if (i) board.querySelector('.op-ring-next').click();
        const btn = board.querySelector('.op-ring-assign'),
          key = btn.dataset.source + '/' + btn.dataset.faction,
          name = btn.dataset.commander;
        if (seen.has(key)) throw Error('Repeated roster ' + key);
        seen.add(key);
        btn.click();
        const card = board.querySelector('.op-seat-card[data-seat="0"]'),
          im = card.querySelector('.op-card-still');
        if (card.dataset.roster !== key) throw Error('Wrong assignment: ' + key);
        await wait(() => im.src && im.complete && im.naturalWidth, 'Missing card still: ' + key);
        const profile = profiles.find(p => p.id === btn.dataset.source),
          art = profile.commanders[btn.dataset.faction].stage;
        if (
          !im.src.startsWith('blob:') ||
          im.dataset.headshotKey !==
            JSON.stringify([
              profile.id,
              profile.revision,
              art.profile || profile.id,
              art.revision || profile.revision,
              art.model,
              art.idle,
              (art.props || []).map(p => [p.model, p.bone])
            ])
        )
          throw Error('Portrait is not the assigned stage body: ' + key);
        const c = document.createElement('canvas');
        c.width = 112;
        c.height = 96;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(im, 0, 0, 112, 96);
        const d = ctx.getImageData(0, 0, 112, 96).data;
        let solid = 0,
          clear = 0,
          hash = 2166136261;
        for (let j = 0; j < d.length; j += 4) {
          if (d[j + 3] > 200) solid++;
          if (!d[j + 3]) clear++;
          for (let k = 0; k < 4; k++) hash = Math.imul(hash ^ d[j + k], 16777619);
        }
        if (solid < 120 || !clear || im.naturalWidth < 112)
          throw Error(`Empty, opaque or tiny portrait: ${key} (${solid}/${clear}/${im.naturalWidth})`);
        fingerprints.add(hash);
        rows.push({ key, name, width: im.naturalWidth, height: im.naturalHeight, solid, clear });
        const x = (i % per) * W,
          y = Math.floor(i / per) * H;
        cx.fillStyle = '#17232f';
        cx.fillRect(x, y, W, H);
        cx.drawImage(im, x + 4, y, 135, 90);
        cx.fillStyle = '#eee';
        cx.font = '11px sans-serif';
        cx.fillText(name, x + 4, y + 101, W - 8);
        cx.fillStyle = '#bac7cb';
        cx.font = '9px sans-serif';
        cx.fillText(key, x + 4, y + 113, W - 8);
      }
      await wait(
        () => window.__cardContexts.length && window.__cardContexts.every(gl => gl.isContextLost()),
        'portrait studio held its graphics context while idle'
      );
      return { rows, unique: fingerprints.size, png: sheet.toDataURL().split(',')[1] };
    });
    assert.equal(audit.rows.length, 75);
    assert(audit.unique >= 65, 'unexpected reuse of card portraits');
    await stage.locator('.op-ring-arena').press('Escape');
    assert(await first.locator('[data-choose-seat]').evaluate(b => b === document.activeElement));
    assert(await board.locator('.op-galaxy').isVisible(), 'explicit Escape leaves commander selection');
    await first.locator('[data-choose-seat]').press('Escape');
    await board.waitFor({ state: 'detached' });
    const released = await f.locator('body').evaluate(
      async (_, urls) =>
        Promise.all(
          urls.map(url =>
            fetch(url).then(
              () => false,
              () => true
            )
          )
        ),
      stillUrls
    );
    assert(released.every(Boolean), 'closing Skirmish must revoke the private stills');
    assert.deepEqual(errors, []);
    if (process.env.SHOTS) {
      fs.writeFileSync(path.join(process.env.SHOTS, 'all-commander-card-stills.png'), Buffer.from(audit.png, 'base64'));
      fs.writeFileSync(path.join(process.env.SHOTS, 'commander-card-audit.json'), JSON.stringify(audit.rows, null, 2));
    }
    console.log(
      `Verified ${audit.rows.length} exact card assignments, ${audit.unique} distinct rendered stills; auto-open, manual paint, difficulty, cancel, and mobile cards OK.`
    );
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
