// Two independent Chrome profiles in the actual Universal shell, one real workerd, no cloud service.
const assert = require('node:assert/strict'),
  os = require('node:os'),
  fs = require('node:fs'),
  path = require('node:path'),
  { spawn } = require('node:child_process');
const { chromium } = require('playwright-core'),
  { worker } = require('./test-relay-fixture.cjs');
(async () => {
  const port = 9072,
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaw-comms-')),
    relay = 'http://127.0.0.1:9071';
  let browser, w, server;
  try {
    w = worker(path.join(tmp, 'worker'), 9071);
    await w.ready;
    server = spawn(process.execPath, ['server.mjs', '--universal', '--port', String(port)], {
      env: { ...process.env, SWR_PLAYSET_HOME: tmp },
      stdio: ['ignore', 'pipe', 'inherit']
    });
    await new Promise((resolve, reject) => {
      server.stdout.on('data', d => {
        if (d.includes('Universal game:')) resolve();
      });
      server.once('exit', c => reject(Error('Server exit ' + c)));
    });
    browser = await chromium.launch({ channel: 'chrome', args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
    const errors = [];
    async function client(name) {
      const ctx = await browser.newContext();
      await ctx.addInitScript(
        ({ relay, name }) => {
          localStorage.setItem('swr.lobby', relay);
          localStorage.setItem('swr.mpname', name);
        },
        { relay, name }
      );
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.setDefaultTimeout(38000);
      await page.goto('http://127.0.0.1:' + port);
      const f = page.frameLocator('#game'),
        ctl = id => f.locator(`[data-id="${id}"]:visible`).first(),
        btn = name => f.getByRole('button', { name, exact: true });
      await ctl('bell').click();
      await f.getByLabel('Callsign', { exact: true }).fill(name);
      await btn('Enable social').click();
      const id = (await f.getByText(/^Friend code · /).textContent()).slice(-16);
      assert.match(id, /^[a-f0-9]{16}$/);
      return { ctx, page, f, ctl, btn, id };
    }
    const [a, b] = await Promise.all([client('Aurek'), client('Besh')]);
    assert.notEqual(a.id, b.id);
    await a.f.getByLabel('Add by friend code').fill(b.id);
    await a.btn('Send request').click();
    await b.btn('Accept').click();
    await a.btn('Message').click();
    await a.f.getByLabel('Message', { exact: true }).fill('Private transmission');
    await a.btn('Transmit').click();
    await b.btn('Message').click();
    await b.f.getByRole('log').getByText('Aurek: Private transmission').waitFor();
    await b.btn('Back to friends').click();
    await a.btn('Back to friends').click();
    console.log('Browser: independent device codes, request/accept and friend-only message delivered.');
    await b.page.setViewportSize({ width: 375, height: 667 });
    assert(await b.f.locator('dialog[open]').evaluate(d => d.scrollWidth <= d.clientWidth + 1));
    await b.page.keyboard.press('Escape');
    await b.page.reload();
    await b.ctl('bell').click();
    await b.f.getByText('Friend code · ' + b.id).waitFor();
    console.log('Mobile drawer fits; reload preserved the device and friend.');
    // Settings manages this same opted-in commander, without exposing the roster/invite workflow in-game.
    await b.page.keyboard.press('Escape');
    await b.ctl('cog').click(); await b.btn('Settings').click();
    const settings = b.f.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('tab', { name: 'Social' }).click();
    await settings.getByText('Friend code · ' + b.id).waitFor();
    await b.btn('Hide online status').click(); await b.btn('Show online status').click();
    await b.btn('Hide online status').waitFor();
    assert.equal(await settings.getByRole('button', { name: 'Join lobby' }).count(), 0);
    await b.btn('Back').click(); await b.ctl('bell').click();
    console.log('Settings shares commander identity and changes online visibility through the real relay.');
    // Exercise the actual pointer target and native room, not just whether an invite button exists.
    await a.page.keyboard.press('Escape');
    const g = a.page.frames().find(f => f.parentFrame() === a.page.mainFrame());
    const game = g.url();
    await g.goto(new URL('?multiplayer=lan', game).href);
    await a.ctl('IDC_LAN_HOST_GAME_BUTTON').click();
    await a.ctl('IDC_INTERNET_CREATE_GAME_BUTTON').click();
    await a.btn('Invite friends').click();
    await a.btn('Invite to lobby').click();
    await a.f.getByText('Lobby invitation sent.').waitFor();
    let expected = (
      await a
        .ctl('IDC_LAN_CHAT_LIST')
        .getByText(/^Join code /)
        .textContent()
    )
      .split(': ')
      .pop()
      .trim();
    assert.match(expected, /^[a-z2-9]{9}$/);
    await a.btn('Close').click();
    await b.btn('Join lobby').waitFor();
    if (process.env.SWR_SOCIAL_ERA_CHECK === '1') {
      // The Universal shell owns the device identity, while the invitation is gated on the mounted data.
      await b.page.keyboard.press('Escape');
      await b.ctl('TITLE_CUSTOMIZE').click();
      await b.f.getByRole('button', { name: 'Fleet registry', exact: true }).click();
      const profile = b.f.getByLabel('Mod profile');
      async function switchTo(target) {
        const current = b.page.frames().find(f => f.parentFrame() === b.page.mainFrame());
        const origin = new URL(current.url()).origin;
        const ready = b.page.waitForEvent('framenavigated', {
          predicate: f => f.parentFrame() === b.page.mainFrame() && new URL(f.url()).origin !== origin
        });
        await profile.selectOption(target);
        await ready;
        await b.f.locator('#ap-back').click();
        await b.ctl('bell').click();
        await b.f.getByText('Friend code · ' + b.id).waitFor();
      }
      await switchTo('1125571106');
      await b.btn('Join lobby').click();
      await b.f.getByText(/Open the matching build.*invitation stays here/).waitFor();
      await b.page.keyboard.press('Escape');
      await b.ctl('TITLE_CUSTOMIZE').click();
      await b.f.getByRole('button', { name: 'Fleet registry', exact: true }).click();
      await switchTo('stock');
      await b.btn('Join lobby').waitFor();
      console.log('One Universal friend code across two mounts; incompatible era retained the unconsumed invitation.');
    }
    if (process.env.SWR_SOCIAL_SHOTS) await b.page.screenshot({ path: path.join(process.env.SWR_SOCIAL_SHOTS, 'commander-invite.png') });
    await b.btn('Join lobby').click();
    await a
      .ctl('IDC_LAN_CHAT_LIST')
      .getByText(/Besh.*joined/i)
      .waitFor();
    const chat = b.ctl('IDC_LAN_CHAT_EDIT').locator('input');
    await chat.fill('Linked from the bell');
    await chat.press('Enter');
    await a.ctl('IDC_LAN_CHAT_LIST').getByText('Besh: Linked from the bell').waitFor();
    assert.deepEqual(await (await fetch(relay + '/lobbies')).json(), []);
    console.log(
      'Actual unlisted native host → invite from staging → second device accepts from bell → same native room and bidirectional staging session.'
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) {
      const done = new Promise(r => server.once('exit', r));
      server.kill();
      if (server.exitCode === null) await done;
    }
    await w?.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
