// node tools/check-remaster-reveal.cjs [all|planet] [remaster|original|fallback]
const { chromium } = require('playwright-core');
const { observeReveal, readReveal, checkReveal } = require('./remaster/first-battlefield.cjs');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const [which = 'all', mode = 'remaster'] = process.argv.slice(2);
const planets = ['endor','yavin','tatooine','hoth','geonosis','naboo','utapau'];
if (!(which === 'all' || planets.includes(which)) || !['remaster','original','fallback'].includes(mode)) throw Error('Unknown map or mode');
const backend = process.env.LOOK_BACKEND || 'webgpu';
if (!['webgpu','webgl'].includes(backend)) throw Error('Unknown renderer');
(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'remaster-reveal-'));
  console.log('Private capture:', out);
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const planet of which === 'all' ? planets : [which]) {
      const p = await b.newPage({ viewport: { width: 1100, height: 680 } });
      try {
        const errors = [];
        p.on('pageerror', e => errors.push(e.message));
        await p.addInitScript(observeReveal);
        if (backend === 'webgl') await p.addInitScript(() => sessionStorage.setItem('swr-webgpu-dropped', '1'));
        // Stall one real donor, not the page or its animation clock. A corrupt response
        // exercises the same loading barrier but must reveal a final stock decision.
        let donors = 0;
        await p.route(/\/art\/[^/]+\/[^/?]+-surface\.dds(?:\?.*)?$/i, async route => {
          if (++donors !== 1) return route.continue();
          await new Promise(r => setTimeout(r, 10000));
          return mode === 'fallback' ? route.fulfill({ body: 'damaged' }) : route.continue();
        });
        const hash = `${planet}-${mode === 'original' ? 'original' : planet === 'endor' ? 'ultra' : 'remaster'}`;
        await p.goto(`http://127.0.0.1:${Number(process.env.SWR_TEST_WINDOW_PORT || 8590)}/#${hash}`);
        const first = await readReveal(p.frameLocator('#game').locator('body'));
        console.log(hash, backend, JSON.stringify(first));
        await p.screenshot({ path: path.join(out, `${planet}.jpg`), type: 'jpeg', quality: 82 });
        checkReveal(first, { planet, mode, backend, width: 2048 });
        if (!!donors !== (mode !== 'original') || errors.length) throw Error(`Donor requests: ${donors}; page errors: ${errors.join('; ')}`);
      } finally { await p.context().close(); }
    }
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
