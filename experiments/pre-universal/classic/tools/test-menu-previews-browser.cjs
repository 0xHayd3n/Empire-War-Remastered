// Mounted stock game + Chrome + playwright-core. Use the real Main Menu → Single Player paths.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' });
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.context().on('request', r => requests.push(new URL(r.url()).pathname.toUpperCase()));
    await page.goto((process.env.BASE_URL || 'http://127.0.0.1:8377') + '/play.html');
    const button = id => page.locator(`.dlg-veil:visible [data-id="${id}"]`).first();
    await button('IDC_MAIN_MENU_SINGLE_PLAYER_GAMES').click({ timeout: 120000 });
    await button('IDC_NEW_CAMPAIGN_BUTTON').waitFor();
    // The file-backed previews start before any of their mode buttons are pressed.
    assert(requests.some(p => p.endsWith('/GALACTIC_BACK.TGA')), 'conquest backdrop not preloaded');
    assert(requests.some(p => p.endsWith('/_MP_SPACE_KUAT.TGA')), 'initial stock battlefield not preloaded');
    await page.evaluate(async () => {
      (await import('/js/game/tutorialprofile.js')).markTutorialSuggestion();
      window.framesSeen = {};
      window.openMs = {};
      let clicked;
      document.addEventListener('click', () => { clicked = performance.now(); }, true);
      function observe() {
        if (document.querySelector('#splash.hidden')) {
          const menu = document.querySelector('.op-setup:not([hidden])');
          const name = menu?.getAttribute('aria-label');
          if (name && !(name in framesSeen)) {
            openMs[name] = Math.round(performance.now() - clicked);
            framesSeen[name] = name === 'Instant Battle'
              ? !!menu.querySelector('.ib-preview-img canvas') && menu.querySelectorAll('.ib-mark').length === 2
              : !!menu.querySelector('.op-map-preview:not([hidden]) canvas, .op-planet');
          }
          const image = [...document.querySelectorAll('[data-id="IDC_IMAGE"]')].find(el => el.getClientRects().length);
          if (image && !('Conquest' in framesSeen)) {
            openMs.Conquest = Math.round(performance.now() - clicked);
            framesSeen.Conquest = !!image.querySelector('.campaign-preview img');
          }
        }
        requestAnimationFrame(observe);
      }
      requestAnimationFrame(observe);
    });
    const firstFrame = async name => {
      await page.waitForFunction(n => n in framesSeen, name);
      assert.equal(await page.evaluate(n => framesSeen[n], name), true, `first visible ${name} frame missing map or markers`);
    };
    const back = () => page.getByRole('button', { name: 'Back', exact: true }).click();
    await button('IDC_SKIRMISH_GAMES_BUTTON').click();
    await firstFrame('Skirmish Battles');
    await back();
    await page.getByText('Instant Battle', { exact: true }).last().click();
    await firstFrame('Instant Battle');
    await back();
    await button('IDC_NEW_CAMPAIGN_BUTTON').click();
    await firstFrame('New Campaign');
    await back();
    await button('IDC_CUSTOM_CAMPAIGN_BUTTON').click();
    await firstFrame('Conquest');
    await button('IDC_CANCEL_BUTTON').click();
    assert.deepEqual(errors, []);
    console.log('Click to first complete selector frame (ms):', await page.evaluate(() => openMs));
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
