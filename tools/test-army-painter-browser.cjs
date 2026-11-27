// SWR_GAME=<your install> node server.mjs, then NODE_PATH=<...> node tools/test-army-painter-browser.cjs.
// Disposable Chrome profile; reads real mounted models but never writes game art to the repository.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }),
    args: ['--enable-unsafe-swiftshader']
  });
  try {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    p.on('pageerror', e => errors.push(String(e)));
    const base = process.env.BASE_URL || 'http://127.0.0.1:8377';
    await p.goto(base + '/play.html?army-painter');
    const ap = p.locator('#armyPainter'),
      fac = ap.locator('#ap-faction'),
      unit = ap.locator('#ap-unit'),
      save = ap.locator('#ap-save'),
      field = ap.locator('#ap-name'),
      presets = ap.locator('#ap-preset');
    const live = () => ap.locator('.ap-model.rendered[aria-busy="false"] canvas').waitFor({ timeout: 90000 });
    await live();
    const faction = await fac.inputValue(),
      first = await unit.inputValue();
    assert.equal(await save.textContent(), 'Stock equipped');
    await p.emulateMedia({ reducedMotion: 'no-preference' });
    const pose = await ap.locator('.ap-model').screenshot();
    await p.waitForTimeout(850); // Sample two distinct points of the presentation idle.
    assert(!(await ap.locator('.ap-model').screenshot()).equals(pose), 'live unit idles');
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await ap.getByRole('button', { name: 'Create livery' }).click();
    await field.fill('Patrol Aurek');
    await ap.getByLabel('Primary color').fill('#d5572d');
    await ap.getByLabel('Secondary color').fill('#4e8199');
    await ap.getByRole('button', { name: 'Chevron' }).click();
    await live();
    const front = await ap.locator('.ap-model').screenshot();
    await ap.getByRole('button', { name: /Rotate unit/ }).click();
    const custom = await ap.locator('.ap-model').screenshot();
    assert(!front.equals(custom), 'turntable changes the view with motion paused');
    await ap.getByRole('button', { name: 'Next unit' }).click();
    assert.notEqual(first, await unit.inputValue());
    assert.equal(await field.inputValue(), 'Patrol Aurek');
    await unit.selectOption(first);
    await live();
    await save.click();
    const id = await presets.inputValue();
    assert.ok(id);
    const other = await fac.locator('option').evaluateAll((options, f) => options.find(o => o.value !== f).value, faction);
    await fac.selectOption(other);
    assert.equal(await presets.inputValue(), '');
    assert.equal(await presets.locator('option').count(), 1);
    await fac.selectOption(faction);
    assert.equal(await presets.inputValue(), id);
    assert.equal(await field.inputValue(), 'Patrol Aurek');
    await presets.selectOption('');
    await live();
    assert(!(await ap.locator('.ap-model').screenshot()).equals(custom), 'painted and stock model pixels differ with motion paused');
    await save.click();
    await p.reload();
    await live();
    assert.equal(await presets.inputValue(), '');
    await presets.selectOption(id);
    await save.click();
    const ship = await unit.locator('optgroup[label="Space"] option').first().getAttribute('value');
    await unit.selectOption(ship);
    await live();
    assert.equal(await presets.inputValue(), id, 'space model shares paint');
    await p.setViewportSize({ width: 390, height: 844 });
    await field.fill('Changed');
    await ap.locator('#ap-back').click();
    await ap.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await field.inputValue(), 'Changed');
    const bounds = await save.boundingBox();
    assert.ok(
      bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 845,
      'primary action fits phone'
    );
    await ap.locator('#ap-back').focus();
    await p.keyboard.press('Tab');
    assert.ok(await save.evaluate(e => e.matches(':focus-visible') && parseFloat(getComputedStyle(e).outlineWidth) >= 2));
    await ap.getByRole('button', { name: 'Delete livery', exact: true }).click();
    await ap.locator('.ap-confirm').getByRole('button', { name: 'Delete', exact: true }).click();
    assert.equal(await presets.locator('option').count(), 1);
    assert.equal(await save.textContent(), 'Stock equipped');
    assert.deepEqual(errors, []);
    console.log(
      'Live mounted ground and space models, paint pixels, faction/preview isolation, reload, equip/stock/delete, narrow layout OK'
    );
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
