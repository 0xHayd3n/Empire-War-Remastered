// Time a real Start click, including any profile remount, through the host reveal.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const cases = process.env.CASE ? process.env.CASE.split(',') : ['conquest', 'story', 'clone-wars'];
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const kind of cases) {
      const story = kind === 'story',
        cross = kind === 'clone-wars';
      assert(story || cross || kind === 'conquest');
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
      page.setDefaultTimeout(120000);
      try {
        await page.goto(process.env.HOST || 'http://127.0.0.1:8590/');
        const f = page.frameLocator('#game');
        await f.locator('[data-id="TITLE_PLAY"]').click();
        await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
        await f.locator(`[data-id="${story ? 'IDC_NEW_CAMPAIGN_BUTTON' : 'IDC_CUSTOM_CAMPAIGN_BUTTON'}"]`).click();
        const board = f.locator(story ? '.op-setup' : '.uc-atlas');
        if (story) {
          await board.getByRole('tab', { name: /Faction/ }).click();
          await board.getByRole('radio', { disabled: false }).first().check();
        } else await board.locator('.uc-map-choice[aria-pressed="true"]').waitFor();
        if (cross) {
          await board.getByRole('button', { name: 'Clone Wars', exact: true }).click();
          const rows = board.locator('tr[data-profile="1976399102"]');
          const collapsed = rows.locator('.uc-size-group[aria-expanded="false"]:visible');
          while (await collapsed.count()) await collapsed.first().click();
          const choices = rows.locator('.uc-map-choice:visible');
          const largest = await choices.evaluateAll(
            bs =>
              bs
                .map((b, i) => [i, parseInt(b.closest('tr').querySelector('.uc-planet-count').textContent) || 0])
                .sort((a, b) => b[1] - a[1])[0]?.[0]
          );
          assert.notEqual(largest, undefined, 'No Fall of the Republic scenario on the selected tab');
          await choices.nth(largest).click();
        }
        const target = story ? await board.getByRole('radio', { checked: true }).inputValue() : await board.getAttribute('data-campaign');
        const plate = page.locator('.battle-plate');
        await plate.evaluate(el => {
          window.coverTiming = {};
          new MutationObserver(() => {
            window.coverTiming[el.hidden ? 'revealed' : 'covered'] ??= performance.timeOrigin + performance.now();
          }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
        });
        const start = board.locator(story ? '.op-go' : '.uc-start');
        const clicked = new Promise(resolve =>
          page.once('console', function capture(m) {
            if (m.text().startsWith('campaign-start-clock:')) resolve(Number(m.text().split(':')[1]));
            else page.once('console', capture);
          })
        );
        await start.evaluate(b =>
          b.addEventListener('click', () => console.debug('campaign-start-clock:' + (performance.timeOrigin + performance.now())), {
            capture: true,
            once: true
          })
        );
        await start.click();
        const t = await clicked;
        await page.waitForFunction(() => Number.isFinite(window.coverTiming?.revealed), {}, { timeout: 120000 });
        const { covered, revealed } = await page.evaluate(() => window.coverTiming);
        const state = await f.locator('body').evaluate(() => {
          const g = window.game;
          return {
            campaign: g?.galaxy?.campaign?.name,
            worlds: g?.galaxy?.planets?.length,
            placed: g?.planetViews.filter(p => p.inst && p.show).length,
            faction: g?.me,
            ai: !!g?.ai,
            story: !!g?.story,
            hud: !!g?.ui,
            stages: (window.loadLog || []).map(([ms, s]) => [performance.timeOrigin + ms, s])
          };
        });
        assert(t <= covered && covered <= revealed);
        assert.equal(state.campaign, target);
        assert(state.worlds && state.placed && state.hud && state.story && state.ai, 'incomplete playable galaxy');
        const { stages, ...identity } = state;
        const ms = Math.round(revealed - t);
        console.log(
          JSON.stringify({
            kind,
            ...identity,
            ms,
            ...(process.env.LOAD_TIMINGS ? { stages: stages.filter(([at]) => at >= t - 1).map(([at, s]) => [Math.round(at - t), s]) } : {})
          })
        );
        if (process.env.MAX_START_MS) assert(ms <= +process.env.MAX_START_MS, `${kind}: ${ms} ms exceeds limit`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
