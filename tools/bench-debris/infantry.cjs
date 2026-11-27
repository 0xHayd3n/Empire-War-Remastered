// Run serially against mounted Universal. Test code and Jolt never enter the game bundle.
const { chromium } = require('playwright-core'),
  fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const opts = Object.fromEntries(process.argv.slice(2).map(s => s.replace(/^--/, '').split('=')));
const perf = opts.suite === 'perf',
  first = opts.first || 'rapier',
  only = opts.only || null,
  n = +(opts.n || (perf ? 24 : 6));
assert(['rapier', 'jolt'].includes(first) && [null, 'rapier', 'jolt'].includes(only));
assert(Number.isInteger(n) && n >= 2 && n <= 32);
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling'] });
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' }),
      errors = [];
    p.setDefaultTimeout(150000);
    p.on('pageerror', e => {
      errors.push(e.message);
      console.error(e.message);
    });
    p.on('console', m => {
      if (m.text().startsWith('[infantry]') || m.text().includes('Using stock unit death')) console.log(m.text());
      if (/GPUValidationError|THREE.WebGLProgram: Shader Error/.test(m.text())) errors.push(m.text().slice(0, 240));
    });
    const f = p.frameLocator('#game'),
      body = f.locator('body');
    await p.goto('http://127.0.0.1:8590/' + (perf || n > 6 ? '#ground-offensive' : '#infantry-ragdolls'));
    await f.locator('#loading.hidden').waitFor({ state: 'attached' });
    if (only !== 'rapier') {
      for (const [key, file] of [
        ['__jolt', require.resolve('jolt-physics/wasm-compat')],
        ['__bridge', path.join(__dirname, 'jolt-bridge.mjs')]
      ]) {
        await body.evaluate(
          async (_, { key, src }) => {
            const u = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
            try {
              window[key] = await import(u);
            } finally {
              URL.revokeObjectURL(u);
            }
          },
          { key, src: fs.readFileSync(file, 'utf8') }
        );
      }
    }
    const cpuRate = +(opts.cpu || 1);
    assert([1, 4].includes(cpuRate));
    if (cpuRate !== 1) {
      const fr = await (await p.locator('#game').elementHandle()).contentFrame(),
        cdp = await p
          .context()
          .newCDPSession(fr)
          .catch(() => p.context().newCDPSession(p));
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    }
    const result = await body.evaluate(require(opts.suite === 'soak' ? './infantry-soak.cjs' : './infantry-trial.cjs'), {
      perf,
      first,
      only,
      nativeBudget:opts.budget==='native',
      n,
      live: opts.live === '1'
    });
    const report = { meta: { chrome: b.version(), cpu: require('node:os').cpus()[0].model, cpuRate, joltBudget:opts.budget==='native'?'native':'authored-extra' }, result, errors };
    if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    assert.deepEqual(errors, []);
    assert(
      result.legs.every(l => !l.failures.length),
      'An acceptance gate failed (report retained)'
    );
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
