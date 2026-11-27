// Two isolated browser stores; only replace the wire, not Instant Battle's ready/start handlers.
// Run with the same mounted server, Chrome and NODE_PATH as test-army-painter-browser.cjs.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' });
  try {
    const pages = await Promise.all([b.newPage(), b.newPage()]),
      states = [];
    const paints = ['#db7533', '#6763bf'].map((primary, i) => ({
      colors: [primary, '#123456', '#6789ab', '#fedcba'],
      pattern: i ? 'banded' : 'split'
    }));
    for (const [i, p] of pages.entries()) {
      await p.route('**/js/main.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
      await p.goto((process.env.BASE_URL || 'http://127.0.0.1:8377') + '/play.html');
      await p.exposeFunction('wire', async (to, msg) => {
        if (msg.k === 'state') states[i] = msg.ib;
        await pages[to].evaluate(([from, m]) => window.receive?.(from, m), [i, msg]);
      });
      await p.evaluate(
        async ({ i, paint }) => {
          const { loadGameData, skirmishFactions } = await import('./js/gamedata.js');
          await loadGameData();
          const { saveLivery } = await import('./js/game/liveries.js');
          const { openInstantBattle } = await import('./js/game/instantmenu.js');
          const { hideSplash } = await import('./js/splash.js');
          hideSplash();
          // A peer with a preset for BOTH factions must not impose either one on the other seat.
          for (const f of skirmishFactions()) saveLivery(f, '', 'Patrol', paint);
          let receiver;
          const net = {
            id: i,
            on: (key, fn) => {
              if (key === 'message') receiver = fn;
              return () => {};
            },
            setListing() {},
            broadcast: m => wire(1 - i, m),
            send: (to, m) => wire(to, m)
          };
          window.receive = (from, m) => receiver?.(from, m);
          window.stage = (initial, solo = false) =>
            openInstantBattle({
              maps: ['_MP_SPACE_KUAT.TED'],
              factions: skirmishFactions(),
              mp: solo
                ? null
                : { session: net, host: i === 0, kind: 'lan', name: i ? 'Guest' : 'Host', version: 'test', data: 'test', initial },
              start: setup => {
                window.started = setup;
              },
              cancel() {}
            });
        },
        { i, paint: paints[i] }
      );
    }
    const [host, guest] = pages;
    await host.evaluate(() => stage());
    await host.evaluate(() => receive(1, { k: 'hello', name: 'Guest', version: 'test', data: 'test' }));
    assert(states[0]?.players.some(p => p.peer === 1));
    await guest.evaluate(ib => stage(ib), states[0]);
    await guest.getByRole('button', { name: 'Ready', exact: true }).click();
    await host.waitForFunction(() => [...document.querySelectorAll('.ib-ready')].some(e => e.textContent === 'Ready'));
    await host.getByRole('button', { name: 'Start Battle', exact: true }).click();
    for (const page of pages) {
      await page.waitForFunction(() => !!window.started);
      assert.deepEqual(await page.evaluate(() => started.players.map(p => p.livery)), paints);
    }
    await host.evaluate(() => {
      delete window.started;
      return stage(null, true);
    });
    await host.getByRole('button', { name: 'Start Battle', exact: true }).click();
    assert.deepEqual(await host.evaluate(() => started.players.map(p => p.livery || null)), [paints[0], null]);
    console.log(
      'Instant Battle: host and guest receive identical owner-specific liveries from separate stores; solo only paints the human'
    );
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
