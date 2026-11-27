// Mounted Universal, installed data. Time the click itself, including any wait on
// a cold preload; do not start the clock when the board or its sidebar mounts.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const modes = {
  conquest: 'IDC_CUSTOM_CAMPAIGN_BUTTON',
  story: 'IDC_NEW_CAMPAIGN_BUTTON',
  skirmish: 'IDC_SKIRMISH_GAMES_BUTTON',
  instant: 'IDC_INSTANT_BATTLE_BUTTON'
};
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({
      reducedMotion: process.env.MOTION || 'no-preference',
      viewport: { width: +process.env.WIDTH || 1366, height: 768 }
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      button = id => f.locator(`.title-menu [data-id="${id}"]`);
    await button('TITLE_PLAY').click({ timeout: 90000 });
    for (const entry of ['first', 'reopen'])
      for (const [mode, id] of Object.entries(modes)) {
        const result = await button(id).evaluate(
          (el, mode) =>
            new Promise(resolve => {
              const t = performance.now();
              function sample() {
                const board = document.querySelector(`[data-universal-screen="${mode === 'conquest' ? 'campaign' : mode}"]`);
                const map = board?.querySelector('.uc-map');
                if (map && map.checkVisibility({ visibilityProperty: true, opacityProperty: true })) {
                  const r = map.getBoundingClientRect();
                  if (board.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))) {
                    const ms = Math.round(performance.now() - t),
                      fg = map.querySelector('.uc-active-globes');
                    const probe = document.createElement('canvas');
                    probe.width = 240;
                    probe.height = 160;
                    const ctx = probe.getContext('2d');
                    ctx.drawImage(fg, 0, 0, 240, 160);
                    resolve({
                      ms,
                      scene: map.parentNode.dataset.scene,
                      routes: Number(map.parentNode.dataset.routes),
                      bodies: Number(fg.dataset.detailed),
                      painted: ctx.getImageData(0, 0, 240, 160).data.some((v, i) => i % 4 === 3 && v > 0),
                      worlds: [...map.querySelectorAll('[data-planet]')].map(n => n.dataset.planet)
                    });
                    return;
                  }
                }
                if (performance.now() - t > 45000) return resolve({ error: 'board did not open' });
                requestAnimationFrame(sample);
              }
              requestAnimationFrame(sample);
              el.click();
            }),
          mode
        );
        assert.equal(result.scene, 'native', JSON.stringify({ entry, mode, scene: result.scene, error: result.error }));
        assert(result.painted && result.bodies > 0, 'foreground portraits missing');
        // Resolve the intended opening from this mounted catalog, independently of
        // what the live board just drew. Never mistake another map for a complete one.
        const expected = await f.locator('.uc-map').evaluate(async (map, mode) => {
          const current = document.querySelector('meta[name="swr-pack-revision"]')?.content.split(':')[0] || 'stock';
          let p, m;
          if (mode === 'conquest') {
            const { campaignLibrary, campaignOpening } = await import('/js/game/universalcampaign.js');
            const { mapStart } = await import('/js/game/universalmaplist.js');
            const { initial } = campaignOpening(await campaignLibrary(), current);
            p = initial.p;
            m = p.maps[mapStart(initial).choice.variant.map];
          } else {
            const { soloLibrary, fieldProfiles } = await import('/js/game/solooperationlibrary.js'),
              data = await soloLibrary();
            if (mode === 'story') {
              const g = data.stories.find(g => g.p.id === current) || data.stories[0];
              p = g.p;
              m = p.maps[g.choices[0].map];
            } else {
              [p] = fieldProfiles(data);
              m = p.maps[0];
            }
          }
          const { planetArt } = await import('/js/game/universalplanetart.js');
          const pose = new DOMMatrix(getComputedStyle(map.querySelector('.uc-plane')).transform);
          const radius = Number(map.querySelector('.uc-active-globes').dataset.diameter) / 2;
          const labels = map.querySelector('.uc-worlds').children;
          const bodies = m.worlds.filter(([i], n) => {
            const u = parseFloat(labels[n].style.left) / 100, v = parseFloat(labels[n].style.top) / 100;
            const x = pose.e + u * map.clientWidth * pose.a, y = pose.f + v * map.clientHeight * pose.d;
            return planetArt(p, p.planets[i]) && x >= -radius && y >= -radius && x <= map.clientWidth + radius && y <= map.clientHeight + radius;
          }).length;
          return { bodies, routes: m.routes.length, worlds: m.worlds.map(([i]) => p.planets[i][0]) };
        }, mode);
        assert.deepEqual(result.worlds, expected.worlds);
        assert.equal(result.routes, expected.routes);
        assert.equal(result.bodies, expected.bodies, 'a visible authored portrait was missing on entry');
        console.log(entry, mode, { ms: result.ms, worlds: result.worlds.length, routes: result.routes, detailed: result.bodies });
        await page.keyboard.press('Escape');
        await button(id).waitFor();
      }
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
