// Local installed-stock + Fall browser benchmark. Wall time from native menu input to
// two animation frames after the requested foreground is visible. No campaign is launched.
const { chromium } = require('playwright-core'),
  { spawn } = require('node:child_process'),
  path = require('node:path');
(async () => {
  const port = Number(process.env.SWR_TEST_WINDOW_PORT || 8780),
    s = spawn(process.execPath, ['server.mjs', '--universal', '--port', String(port)], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'inherit']
    });
  let browser;
  try {
    await new Promise((ok, no) => {
      s.stdout.on('data', d => d.toString().includes('Universal game:') && ok());
      s.once('exit', () => no(Error('Test server exited')));
    });
    browser = await chromium.launch({ channel: 'chrome' });
    for (let n = 0; n < 2; n++) {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.setDefaultTimeout(120000);
      page.on('console', m => {
        if (m.type() === 'warning' && m.text().includes('Galaxy')) console.error(m.text());
      });
      page.on('pageerror', e => console.error(e.message));
      await page.goto(`http://127.0.0.1:${port}/`);
      const f = page.frameLocator('#game');
      await f.locator('[data-id="IDC_MAIN_MENU_SINGLE_PLAYER_GAMES"]').click();
      await f.locator('[data-id="IDC_CUSTOM_CAMPAIGN_BUTTON"]').click();
      const board = f.locator('.uc-atlas'),
        native = board.locator('[data-scene="native"]');
      await native.waitFor();
      await board.getByRole('button', { name: 'Clone Wars', exact: true }).click();
      const range = board.getByRole('slider', { name: 'Starting year' });
      await range.focus();
      await range.press('Home');
      await range.press('ArrowRight');
      const results = [];
      for (const action of ['Small', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'Medium', 'ArrowLeft', 'ArrowLeft', 'Small', 'ArrowLeft']) {
        const control = action.startsWith('Arrow') ? range : board.getByRole('button', { name: new RegExp('Known Galaxy - ' + action) });
        await control.evaluate(
          (e, kind) => e.addEventListener(kind, () => (window.ucInputAt = performance.now()), { capture: true, once: true }),
          action.startsWith('Arrow') ? 'keydown' : 'click'
        );
        if (action.startsWith('Arrow')) await control.press(action);
        else await control.click();
        await native.waitFor({ timeout: 90000 });
        results.push(
          await native.evaluate(
            e =>
              new Promise(ok =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => ok([e.closest('dialog').dataset.campaign, Math.round(performance.now() - window.ucInputAt)]))
                )
              )
          )
        );
      }
      console.log(JSON.stringify({ session: n + 1, results }));
      await page.close();
    }
  } finally {
    await browser?.close();
    s.kill();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
