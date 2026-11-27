// Verify the exact hand prop, moving insignia and presentation on the real selector.
const assert = require('node:assert/strict'),
  { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await b.newPage({ viewport: { width: 1350, height: 850 } });
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game');
    for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_SKIRMISH_GAMES_BUTTON'])
      await f.locator(`[data-id="${id}"]`).click({ timeout: 90000 });
    const board = f.locator('[data-universal-screen="skirmish"]');
    await board.evaluate(async () => {
      const { CommandRing } = await import('/js/game/commandring.js'),
        set = CommandRing.prototype.set;
      CommandRing.prototype.set = function (...args) {
        window.stageTest = this;
        CommandRing.prototype.set = set;
        return set.apply(this, args);
      };
    });
    await board.getByRole('tab', { name: 'Teams' }).click();
    await board.locator('[data-choose-seat="0"]').click();
    const stage = board.locator('.op-command-stage'),
      search = stage.getByRole('searchbox');
    await search.fill('Kayn Somos');
    await board.locator('.op-command-stage[data-model="FIELDCOMMANDER_STORMTROOPER_4.ALO"][data-ready="true"]').waitFor();
    const weapon = await stage.evaluate(() => {
      const r = stageTest,
        rig = r.cache.get(r.focus.key).rig;
      const parts = [];
      rig.root.traverse(o => {
        if (o.userData.commandProp) parts.push([o.userData.commandProp, o.parent.name, o.children.length]);
      });
      return parts;
    });
    assert(
      weapon.some(
        ([file, bone, parts]) => file.toUpperCase() === 'WEAPON_E11RIFLE.ALO' && bone.toUpperCase() === 'ATTACH_HAND_RIGHT' && parts > 0
      ),
      'Kayn Somos must carry his installed E-11 on the animated right hand'
    );
    assert.equal(await stage.locator('.op-stage-back,.op-stage-head,.op-ring-count,.op-ring-kicker').count(), 0);
    assert.equal(await stage.locator('.op-ring-origin').innerText(), 'Thrawn’s Revenge');
    assert.match(await stage.locator('.op-ring-dates').innerText(), /4–12 ABY/);
    async function hologram() {
      return stage.evaluate(() => {
        const o = stageTest.hologram.mesh;
        return { visible: o.visible, angle: o.rotation.z, key: o.userData.seat };
      });
    }
    await search.fill('Galactic Republic');
    let seen = new Map();
    const count=Number(await stage.getAttribute('data-total'));
    for (let i = 0; i < count; i++) {
      await board.locator('.op-command-stage[data-ready="true"]').waitFor();
      const id = await stage.locator('.op-ring-assign').getAttribute('data-source'),
        mark = await stage.locator('.op-family-current img').getAttribute('src');
      await stage.evaluate(async () => {
        const end = performance.now() + 5000;
        while (stageTest.hologram.mesh.userData.seat !== stageTest.focus.key && performance.now() < end)
          await new Promise(requestAnimationFrame);
      });
      const h = await hologram();
      assert(h.visible && h.key.startsWith(id + '/'));
      seen.set(id, mark);
      await stage.getByRole('button', { name: 'Next commander', exact: true }).click();
    }
    assert(seen.has('3387971722')&&seen.size>=3);assert.equal(new Set(seen.values()).size,seen.size,'each Republic source has its own ink on the shared stencil');
    await search.fill('Kayn Somos');
    await board.locator('.op-command-stage[data-ready="true"]').waitFor();
    const a = await hologram();
    await page.waitForTimeout(350);
    assert.notEqual((await hologram()).angle, a.angle);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await board.locator('.op-command-stage[data-motion="held"]').waitFor();
    const held = await hologram();
    await page.waitForTimeout(300);
    assert.equal((await hologram()).angle, held.angle);
    if (process.env.SHOTS) await stage.screenshot({ path: require('node:path').join(process.env.SHOTS, 'ring-hologram-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await stage.getByRole('button', { name: 'Assign', exact: true }).scrollIntoViewIfNeeded();
    if (process.env.SHOTS) await stage.screenshot({ path: require('node:path').join(process.env.SHOTS, 'ring-hologram-mobile.png') });
    await stage.getByRole('button', { name: 'Assign', exact: true }).click();
    assert(await stage.isVisible(), 'Assign on mobile must leave the commander ring open');
    assert(!(await board.locator('.op-galaxy').isVisible()));
    assert.match(await board.locator('[data-seat="0"] .op-player-name').innerText(), /Kayn Somos/);
    console.log('Verified authored rifle on hand, era-specific rotating/held crests, dates, and mobile Assign.');
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
