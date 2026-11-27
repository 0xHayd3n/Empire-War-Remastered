// Optional end-to-end check: retail game server + a disposable, locally running lobby Worker.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const base = process.env.BASE_URL || 'http://127.0.0.1:8377',
    relay = process.env.SWR_TEST_RELAY,
    mode = process.argv.includes('--land') ? 'land' : 'space';
  assert(relay && ['localhost', '127.0.0.1'].includes(new URL(relay).hostname), 'Set SWR_TEST_RELAY to a local test Worker');
  const b = await chromium.launch({
    channel: 'chrome',
    args: ['--enable-unsafe-swiftshader', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp']
  });
  try {
    const names = ['Aurek', 'Besh'],
      patterns = ['split', 'banded'];
    const pages = await Promise.all(
      names.map(async (name, i) => {
        const ctx = await b.newContext();
        await ctx.addInitScript(
          ({ name, relay, mode }) => {
            localStorage.setItem('swr.lobby', relay);
            localStorage.setItem('swr.mpname', name);
            localStorage.setItem('swr.mptype', mode);
          },
          { name, relay, mode }
        );
        const p = await ctx.newPage();
        p.setDefaultTimeout(65000);
        await p.goto(base + '/play.html?army-painter');
        await p.locator('#ap-faction option').first().waitFor({ state: 'attached' });
        await p.evaluate(
          async ({ name, pattern }) => {
            const { saveLivery } = await import('/js/game/liveries.js');
            const { painterFactions } = await import('/js/game/painter-roster.js');
            for (const f of painterFactions()) saveLivery(f, '', name, { pattern, colors: ['#55aa00', '#681365', '#e8dcdd', '#8182cc'] });
          },
          { name, pattern: patterns[i] }
        );
        return p;
      })
    );
    const [host, guest] = pages,
      ctl = (p, id) => p.locator(`[data-id="${id}"]:visible`).first();
    const lobby = base + '/play.html?multiplayer=lan&nowarm&preload=1';
    await host.goto(lobby);
    await ctl(host, 'IDC_LAN_HOST_GAME_BUTTON').click();
    await ctl(host, 'IDC_INTERNET_CREATE_GAME_BUTTON').click();
    const code = (
      await host
        .getByText(/^Join code \(/)
        .first()
        .textContent()
    )
      .split(': ')
      .pop()
      .trim();
    await guest.goto(lobby + '&join=' + encodeURIComponent(code));
    await ctl(guest, 'IDC_LAN_START_GAME_BUTTON').waitFor();
    await host
      .getByText(/Besh joined the game/i)
      .first()
      .waitFor();
    await ctl(guest, 'IDC_LAN_START_GAME_BUTTON').click();
    // Wait for the host to display the accepted guest before pressing Start.
    await host.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-id^="IDC_ACCEPT_PLAYER_"]')].filter(n => n.style.backgroundImage.includes('radial-gradient'))
          .length >= 2,
      null
    );
    await ctl(host, 'IDC_LAN_START_GAME_BUTTON').click();
    for (const p of pages) {
      await p.waitForFunction(() => window.game?.setup?.net && game.setup.players.some(s => s.livery), null, { timeout: 100000 });
      assert.deepEqual(
        await p.evaluate(() => game.setup.players.filter(s => s.human).map(s => [s.name, s.livery?.pattern])),
        names.map((n, i) => [n, patterns[i]])
      );
      await p.waitForFunction(
        () => {
          const paints = new Set();
          (game.scene || game.renderer?.scene)?.traverse(o => {
            if (o.material?.defines?.LIVERY) paints.add(o.material.uniforms.liveryParams.value.x);
          });
          return paints.has(1) && paints.has(2);
        },
        null,
        { timeout: 100000 }
      );
    }
    console.log(`LAN room: host & guest joined, accepted, launched; both live ${mode} scenes contain both owner-specific livery materials.`);
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
