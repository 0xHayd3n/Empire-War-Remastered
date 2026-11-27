// Optional mounted smoke: start the game server and run with Chrome + playwright-core.
// Record the actual scene draw, not just the presence of planet model objects.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' });
  try {
    const p = await browser.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => {
      const proto = WebGL2RenderingContext.prototype;
      const draw = proto.drawElements;
      let drew = false;
      proto.drawElements = function (...args) {
        if (!drew && this.canvas.closest('#view')) drew = true;
        return draw.apply(this, args);
      };
      const gpu = globalThis.GPURenderPassEncoder?.prototype;
      if (gpu) {
        const indexed = gpu.drawIndexed;
        gpu.drawIndexed = function (...args) {
          drew = true;
          return indexed.apply(this, args);
        };
      }
      new MutationObserver(() => {
        const el = document.querySelector('#splash:is([data-scene="galaxy"], [data-scene="era"])');
        if (el?.classList.contains('hidden') && window.reveal === undefined) window.reveal = drew;
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    const base = process.env.BASE_URL || 'http://127.0.0.1:8377';
    const renderer = process.argv.includes('--gpu') ? '' : '&webgl';
    const campaign = process.argv.includes('--story') ? '&campaign=Full_Story_Campaign_Underworld' : '';
    await p.goto(`${base}/play.html?autostart&mode=galactic${renderer}${campaign}`);
    await p.waitForFunction(() => window.reveal !== undefined || document.querySelector('#loading[data-failed]'), null, { timeout: 120000 });
    const result = await p.evaluate(() => ({
      drew: window.reveal,
      planets: window.game?.planetViews.filter(p => p.inst && p.show).length,
      renderer: window.game?.renderer.device ? 'WebGPU' : 'WebGL',
      failure: document.querySelector('#loading[data-failed]')?.textContent
    }));
    assert.equal(result.failure, undefined, result.failure);
    assert.deepEqual(errors, []);
    assert(result.planets > 0);
    assert.equal(result.drew, true, 'galaxy uncovered before any planet scene draw');
    console.log(`First ${result.renderer} galaxy draw behind the briefing (${result.planets} planet models)`);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
