// Home → Play → Skirmish, using the installed catalog, not a synthetic list.
// BENCH_BATTLE=space or land also samples a real four-seat stock battle.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const pct = (xs, p) => +[...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1].toFixed(1);
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      reducedMotion: process.env.REDUCED_MOTION ? 'reduce' : 'no-preference'
    });
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = page.frameLocator('#game'),
      board = f.locator('.op-setup'),
      menu = id => f.locator(`.title-menu [data-id="${id}"]`);
    await menu('TITLE_PLAY').click({ timeout: 90000 });
    const start = Date.now();
    await menu('IDC_SKIRMISH_GAMES_BUTTON').click();
    await board.locator('.op-galaxy[data-scene="native"]').waitFor({ timeout: 120000 });
    const readyMs = Date.now() - start;
    const ui = await board.evaluate(async el => {
      const search = el.querySelector('[aria-label="Search battlefields"]'),
        list = el.querySelector('.op-field-index');
      const frames = () => new Promise(requestAnimationFrame),
        keys = [],
        clear = [];
      let maxLive = 0;
      for (let i = 0; i < 4; i++)
        for (const value of ['K', 'Ku', 'Kua', 'Kuat', '']) {
          await frames();
          const t = performance.now();
          search.value = value;
          search.dispatchEvent(new Event('input', { bubbles: true }));
          // Charge synchronous style/layout to the input that caused it, then let the browser paint.
          list.getBoundingClientRect();
          (value ? keys : clear).push(performance.now() - t);
          await frames();
          maxLive = Math.max(maxLive, list.querySelectorAll('[data-planet-group]').length);
        }
      const map = el.querySelector('.uc-map'),
        mr = map.getBoundingClientRect(),
        gaps = [];
      let last = await frames();
      for (let i = 0; i < 60; i++) {
        map.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: i < 30 ? -12 : 12,
            clientX: mr.x + mr.width * 0.5,
            clientY: mr.y + mr.height * 0.5,
            bubbles: true,
            cancelable: true
          })
        );
        const next = await frames();
        gaps.push(next - last);
        last = next;
      }
      return { keys, clear, gaps, maxLive, worlds: el.querySelectorAll('[data-planet]').length, nodes: list.querySelectorAll('*').length };
    });
    console.log({
      readyMs,
      worlds: ui.worlds,
      liveParents: ui.maxLive,
      listNodes: ui.nodes,
      typingP95: pct(ui.keys, 0.95),
      clearP50: pct(ui.clear, 0.5),
      zoomFrameP95: pct(ui.gaps, 0.95)
    });
    const domain = process.env.BENCH_BATTLE;
    if (domain) {
      assert(['land', 'space'].includes(domain));
      await board.getByRole('searchbox').fill(`Abregado Forces of Corruption ${domain}`);
      await board.locator(`[data-world="Abregado_Rae"][data-domain="${domain}"][data-source="stock"]`).click();
      await board.getByRole('tab', { name: 'Teams' }).click();
      await board.getByRole('button', { name: 'Add ally' }).click();
      await board.getByRole('button', { name: 'Add opponent' }).click();
      await board.getByRole('button', { name: /^Ally 1 faction:/ }).click();
      await board.locator('.op-command-stage input').fill('Tyber Zann');
      await board.locator('[data-source="stock"][data-faction="Underworld"]').click();
      await board.locator('.op-go').click();
      const fr = page.frames().find(fr => fr.url().includes('play.html'));
      await fr.waitForFunction(
        t => window.game?.world?.time > t && !!document.querySelector('#loading.hidden') && !document.querySelector('.battle-plate'),
        Number(process.env.BENCH_START || 1),
        { timeout: 180000 }
      );
      let session;
      if (process.env.PROFILE) {
        session = await page
          .context()
          .newCDPSession(fr)
          .catch(() => page.context().newCDPSession(page));
        await session.send('Profiler.enable');
        await session.send('Profiler.start');
      }
      const result = await fr.evaluate(async () => {
        const g = window.game,
          w = g.world,
          begin = w.time,
          raf = () => new Promise(requestAnimationFrame),
          gaps = [];
        let now = await raf(),
          start = now;
        while (now - start < 5000) {
          const next = await raf();
          gaps.push(next - now);
          now = next;
        }
        return {
          file: g.setup.mapFile,
          elapsed: now - start,
          advanced: w.time - begin,
          units: w.units.length,
          worker: !!g.mirror,
          frames: gaps,
          worstMs: Math.max(...gaps),
          over33ms: gaps.filter(ms => ms > 33.4).length
        };
      });
      console.log({ ...result, frames: result.frames.length, frameP50: pct(result.frames, 0.5), frameP95: pct(result.frames, 0.95) });
      if (session) {
        const { profile } = await session.send('Profiler.stop');
        const ms = new Map();
        profile.samples.forEach((n, i) => ms.set(n, (ms.get(n) || 0) + profile.timeDeltas[i] / 1000));
        console.log(
          [...ms]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 18)
            .map(([id, t]) => {
              const fn = profile.nodes.find(n => n.id === id).callFrame;
              return [Math.round(t), fn.functionName, fn.url.split('/').pop(), fn.lineNumber + 1];
            })
        );
        await session.detach();
      }
      assert(result.advanced > 0 && result.units > 0, 'live simulation must advance');
    }
    assert(ui.worlds > 0 && ui.maxLive <= 100, 'large catalogs should not lay out hundreds of off-screen rows on input');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
