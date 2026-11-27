// Real title and selector, disposable origins. No persistent game saves.
const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  assert = require('node:assert/strict'),
  path = require('node:path');
(async () => {
  const port = +(process.env.SWR_TEST_WINDOW_PORT || 8860),
    host = spawn(process.execPath, ['server.mjs', '--universal'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SWR_UNIVERSAL_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      host.stdout.on('data', b => {
        if (b.toString().includes('Universal game:')) ok();
      });
      host.once('exit', () => no(Error('port unavailable')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    for (const opening of ['learner', 'progressive', 'static']) {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.setDefaultTimeout(120000);
      await page.goto(`http://127.0.0.1:${port}`);
      const f = page.frameLocator('#game');
      await f.locator('[data-id="TITLE_PLAY"]').click();
      await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
      await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
      const b = f.locator('.uc-atlas');
      await b.locator('.uc-map-choice[aria-pressed="true"]').waitFor();
      await b.getByRole('button', { name: 'New Republic', exact: true }).click();
      const leaf = b.locator('[data-family^="Custom_Small_Era_1_" i]');
      await leaf.waitFor({ state: 'attached' });
      if (!(await leaf.isVisible()))
        await b.locator(`[aria-controls~="${await leaf.locator('xpath=ancestor::tr').getAttribute('id')}"]`).click();
      await leaf.click();
      await b.getByRole('tab', { name: 'Faction', exact: true }).click();
      await b.locator('[data-field="faction"] input[value="Rebel"]').check();
      await b.getByRole('tab', { name: 'Settings', exact: true }).click();
      await b.locator('[data-field="opening"]').selectOption(opening);
      await b.locator('[data-field="difficulty"] input[value="hard"]').check();
      await b.locator('.uc-start').click();
      const plate = page.locator('.battle-plate');
      await plate.waitFor();
      await plate.waitFor({ state: 'hidden' });
      let run = page.frames().find(x => x.parentFrame() === page.mainFrame());
      await run.waitForFunction(() => window.game?.story?.values.get('CURRENT_ERA') != null && game.renderer.domElement.width > 0);
      const actual = await run.evaluate(() => ({
        target: game.galaxy.campaign.name,
        faction: game.galaxy.active,
        mode: game.setup.startingTechLevel ?? null,
        difficulty: game.setup.difficulty,
        learner: !!game.story.values.get('CUSTOM_LEARNER_MODE'),
        progressive: !!game.story.values.get('PROGRESSIVE_INFINITY'),
        era: game.story.values.get('CURRENT_ERA')
      }));
      console.log(opening, actual);
      assert.deepEqual(actual, {
        target: 'Custom_Small_Era_1_Rebel',
        faction: 'Rebel',
        mode: { learner: 5, progressive: 4, static: null }[opening],
        difficulty: 'hard',
        learner: opening === 'learner',
        progressive: opening === 'progressive',
        era: 1
      });
      await page.close();
    }
  } finally {
    await browser?.close();
    host.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
