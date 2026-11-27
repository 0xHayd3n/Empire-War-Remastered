// Optional: serve the checkout with `node server.mjs --static`, then run this file
// with playwright-core and Chrome available. No game archives or WebGL required.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' });
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const base = process.env.BASE_URL || 'http://127.0.0.1:8377';
    // Keep the real entry point and stylesheet order, but open setup without booting the simulation.
    await page.route('**/js/main.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(new URL('play.html', base).href);
    const reference = await page.evaluate(async () => {
      const { showSplash } = await import('/js/splash.js');
      showSplash('staging');
      return {
        art: getComputedStyle(document.querySelector('#splash'), '::before').backgroundImage,
        title: getComputedStyle(document.querySelector('#briefTitle')).color
      };
    });
    assert.notEqual(reference.art, 'none', 'the staging card has its fleet illustration');
    await page.evaluate(async () => {
      const { hideSplash } = await import('/js/splash.js');
      const { openInstantBattle } = await import('/js/game/instantmenu.js');
      hideSplash();
      await openInstantBattle({
        maps: ['_MP_SPACE_TEST.TED', '_MP_SPACE_Long_sector_name_for_a_modded_battlefield.TED'],
        factions: ['Empire', 'Rebel']
      });
      await document.fonts.ready;
    });
    const menu = page.locator('#instantBattle');
    const title = menu.getByRole('heading', { name: 'Instant Battle', exact: true });
    assert.equal(await title.evaluate(el => getComputedStyle(el).color), reference.title, 'card and menu title share the same ink');
    const scene = await menu.evaluate(el => getComputedStyle(el).backgroundImage);
    assert.ok(scene.includes(reference.art), 'setup uses the staging illustration, not a substitute map photo');
    await menu.getByRole('button', { name: 'Edit fleets' }).click();
    const fleet = menu.getByRole('button', { name: /^Select fleet 2:/ });
    await fleet.focus();
    await page.keyboard.press('Space');
    assert.ok(
      await fleet.evaluate(el => el === document.activeElement && el.getAttribute('aria-pressed') === 'true'),
      'keyboard fleet selection retains focus'
    );
    await page.keyboard.press('Escape');
    assert.ok(await menu.getByRole('button', { name: 'Edit fleets' }).evaluate(el => el === document.activeElement), 'returns to the battlefield');
    const map = menu.getByRole('button', { name: /Long sector name/ });
    await map.focus();
    await page.keyboard.press('Enter');
    assert.equal(await map.getAttribute('aria-pressed'), 'true', 'keyboard map selection');
    const start = menu.getByRole('button', { name: 'Start battle', exact: true });
    const back = menu.getByRole('button', { name: 'Back', exact: true });
    await back.focus();
    await page.keyboard.press('Tab');
    assert.ok(
      await start.evaluate(el => el.matches(':focus-visible') && parseFloat(getComputedStyle(el).outlineWidth) > 0),
      'visible keyboard focus'
    );
    assert.equal(await menu.evaluate(el => el.getAnimations().length), 0, 'still in reduced motion');

    // Simulate unavailable artwork at phone width. The real controls must still fit and work.
    await page.setViewportSize({ width: 390, height: 844 });
    await menu.evaluate(el => el.style.setProperty('--brief-fleet-art', 'none'));
    assert.ok(await title.isVisible());
    await start.scrollIntoViewIfNeeded();
    const bounds = await start.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 845);
    await start.click();
    assert.match(await menu.locator('.ib-error').innerText(), /no ships/i, 'empty roster produces a real validation message');
    await page.keyboard.press('Escape');
    assert.ok(await menu.getByRole('button', { name: 'Edit fleets' }).isVisible(), 'validation led to the empty fleet');
    await page.keyboard.press('Escape');
    assert.equal(await menu.count(), 0, 'setup can be dismissed without assets');
    console.log('Briefing and Instant Battle: shared title and art, focus, reduced motion, narrow no-art setup and dismissal OK');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
