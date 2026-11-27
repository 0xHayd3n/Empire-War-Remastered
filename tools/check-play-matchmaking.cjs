// Two real Chrome storage contexts, installed game data and the unmodified relay Worker running under local workerd.
// Prerequisites and local relay setup: docs/play-operations.md#verify-locally
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const { worker: localWorker } = require('./test-relay-fixture.cjs');
const base = 'http://127.0.0.1:',
  relay = base + '9020',
  stock = base + '9012',
  modded = base + '9019';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaw-play-'));
const servers = [];
async function serve(args, env, ready) {
  const s = spawn(process.execPath, ['server.mjs', ...args], {
    env: { ...process.env, ...env, SWR_PLAYSET_HOME: tmp },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  servers.push(s);
  await new Promise((ok, no) => {
    s.stdout.on('data', b => {
      if (b.includes(ready)) ok();
    });
    s.once('exit', c => no(Error('Server exit ' + c)));
  });
}
async function until(f) {
  for (let i = 0; i < 100; i++) {
    const v = await f();
    if (v) return v;
    await new Promise(r => setTimeout(r, 150));
  }
  throw Error('Timed out waiting for relay state');
}
(async () => {
  let worker, browser;
  try {
    const { game } = (await import('./workshop-library.mjs')).readLibrary();
    assert(game, 'Install Forces of Corruption or set SWR_GAME');
    const mod = path.join(tmp, 'Local verification mod');
    fs.mkdirSync(path.join(mod, 'Data'), { recursive: true });
    fs.writeFileSync(path.join(mod, 'modinfo.json'), JSON.stringify({ name: 'Isolation check', version: '1' }));
    worker = localWorker(path.join(tmp, 'relay'), 9020);
    await worker.ready;
    const listings = async () => (await fetch(relay + '/lobbies')).json();
    assert.deepEqual(await listings(), []);
    await serve(['--universal', '--port', '9011'], {}, 'Universal game:');
    const mount = await fetch(base + '9011/api/mount/stock', { method: 'POST', headers: { origin: base + '9011' } });
    assert.equal(mount.status, 200);
    await serve(['--port', '9019', '--mod', mod], { SWR_GAME: game }, 'Game server:');
    browser = await chromium.launch({ channel: 'chrome', args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
    const errors = [];
    async function client(name) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript(
        ({ relay, name }) => {
          localStorage.setItem('swr.lobby', relay);
          localStorage.setItem('swr.mpname', name);
        },
        { relay, name }
      );
      const page = await ctx.newPage();
      page.setDefaultTimeout(55000);
      page.on('pageerror', e => errors.push(e.message));
      const ctl = id => page.locator(`[data-id="${id}"]:visible`).first();
      const btn = label => page.getByRole('button', { name: label, exact: true });
      // Play is a tabbed section: Multiplayer offers matchmaking and custom games as two Play routes.
      async function enterMatchmaking() {
        await ctl('PLAY_MATCHMAKING').click();
        await ctl('FLIGHT_PLAYLIST').waitFor();
        await btn('Start matchmaking').waitFor();
      }
      async function open(origin) {
        await page.goto(origin + '/play.html');
        await ctl('TITLE_PLAY').click();
        await ctl('IDC_MAIN_MENU_MULTIPLAYER').click();
        await ctl('PLAY_CUSTOM').waitFor();
        return enterMatchmaking();
      }
      async function afterPairedStaging() {
        await btn('Start matchmaking').waitFor();
        assert(await page.locator('.title-menu[data-section="multi"][data-immersive]').isVisible(), 'paired staging returns to matchmaking');
      }
      async function choose(ladder, id) {
        await ctl('FLIGHT_PLAYLIST').click();
        await page.locator(`dialog[open] [data-ladder="${ladder}"]`).click();
        await page.locator(`dialog[open] [data-variant="${id}"]`).click();
        await btn('Use playlist').click();
      }
      async function configure(url) {
        await ctl('FLIGHT_NETWORK').click();
        await page.getByLabel('Matchmaking network').selectOption(url ? 'custom' : 'inherit');
        if (url) await page.getByLabel('Relay address').fill(url);
        await btn('Apply network').click();
      }
      return {
        page,
        btn,
        ctl,
        open,
        choose,
        configure,
        afterPairedStaging,
        close: () => ctx.close(),
        search: () => btn('Start matchmaking').click(),
        cancel: () => btn('Cancel search').click()
      };
    }
    if (process.argv.includes('--battles')) {
      await require('./check-operation-launch.cjs')({ client, stock, listings, until, ids: process.argv.slice(3) });
      assert.deepEqual(errors, []);
      return;
    }
    const a = await client('Aurek'),
      b = await client('Besh');
    await Promise.all([a.open(stock), b.open(modded)]);
    await a.page.setViewportSize({ width: 375, height: 667 });
    assert(await a.page.locator('.title-menu').evaluate(e => e.scrollWidth <= innerWidth));
    assert.equal(await a.ctl('IDC_MULTIPLAYER_INTERNET_BUTTON').count(), 0);
    assert.equal(await a.page.locator('.title-menu [data-id="TITLE_PLAY"]').isVisible(), false);
    assert.equal(await a.ctl('bell').count(), 0);
    assert.equal(await a.page.evaluate(() => getComputedStyle(document.body, '::before').filter), 'none');
    assert.equal(await a.page.locator('.mm-left').evaluate(e => getComputedStyle(e).transform), 'none');
    await a.page.keyboard.press('Backspace');
    assert(await a.ctl('PLAY_MATCHMAKING').evaluate(b => document.activeElement === b));
    assert.equal(await a.ctl('IDC_MAIN_MENU_MULTIPLAYER').getAttribute('aria-selected'), 'true');
    await a.ctl('PLAY_MATCHMAKING').click();
    await a.ctl('FLIGHT_PLAYLIST').waitFor();
    // An external ?title-section=multiplayer link still opens a live matchmaking lobby.
    await a.page.goto(stock + '/play.html?title-section=multiplayer');
    await a.ctl('FLIGHT_PLAYLIST').waitFor();
    assert.equal(await a.page.locator('.title-menu').getAttribute('data-section'), 'multi');
    const shot = async (c, name) => {
      if (process.env.SWR_FLIGHT_SHOTS)
        await c.page.screenshot({ path: path.join(process.env.SWR_FLIGHT_SHOTS, 'match-' + name + '.png') });
    };
    await a.choose('social', 'beachhead');
    await shot(a, 'phone');
    await a.page.getByRole('heading', { name: 'Beachhead' }).waitFor();
    await a.configure('http://127.0.0.1:9029');
    await a.open(stock);
    await a.page.getByRole('heading', { name: 'Beachhead' }).waitFor();
    await a.ctl('FLIGHT_NETWORK').getByText('Custom relay').waitFor();
    assert.equal(await a.page.evaluate(() => localStorage.getItem('swr.lobby')), relay);
    await a.search();
    await a.page.getByText(/Matchmaking relay unavailable/).waitFor();
    await a.configure(null);
    await a.search();
    await until(async () => (await listings()).some(g => g.map === 'beachhead'));
    await a.cancel();
    await until(async () => !(await listings()).length);
    console.log('Mobile Land playlist, unavailable loopback service → Retry → live ticket → Cancel: listing removed.');
    await a.page.setViewportSize({ width: 1280, height: 800 });
    await a.ctl('FLIGHT_NETWORK').click();
    const callsign = a.page.getByLabel('Commander callsign');
    await callsign.fill('Aurekx');
    await callsign.press('Backspace');
    assert.equal(await callsign.inputValue(), 'Aurek');
    await a.btn('Test relay').click();
    await a.page.getByText('Relay reachable. No queue ticket was created.').waitFor();
    await shot(a, 'network');
    await a.page.keyboard.press('Backspace');
    await a.ctl('FLIGHT_PLAYLIST').click();
    await a.page.locator('[data-ladder="ranked"]').click();
    await a.page.locator('[data-variant="last-flight"]').click();
    await shot(a, 'playlist');
    await a.page.keyboard.press('Escape');
    await a.page.getByRole('heading', { name: 'Beachhead' }).waitFor();
    await a.choose('social', 'orbital-foundry');
    await b.choose('social', 'orbital-foundry');
    await a.ctl('FLIGHT_PLAYLIST').focus();
    await a.page.keyboard.press('ArrowDown');
    assert(await a.ctl('FLIGHT_NETWORK').evaluate(b => document.activeElement === b));
    await a.page.keyboard.press('ArrowUp');
    assert.notEqual(await a.page.locator('.mm-left').evaluate(e => getComputedStyle(e).transform), 'none');
    await a.page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await a.page.locator('.mm-left').evaluate(e => getComputedStyle(e).transform), 'none');
    await a.page.emulateMedia({ reducedMotion: 'no-preference' });
    await shot(a, 'lobby');
    await a.search();
    await a.btn('Cancel countdown').waitFor();
    await shot(a, 'countdown');
    assert.deepEqual(await listings(), []);
    await a.page.keyboard.press('Escape');
    await a.page.getByText(/Countdown cancelled/).waitFor();
    await new Promise(r => setTimeout(r, 5200));
    assert.deepEqual(await listings(), [], 'cancelled countdown never registered');
    if (process.env.SWR_FLIGHT_SHOTS) await a.page.screenshot({ path: path.join(process.env.SWR_FLIGHT_SHOTS, 'flight-deck.png') });
    await Promise.all([a.search(), b.search()]);
    const tickets = await until(async () => {
      const l = await listings();
      return l.length === 2 && l;
    });
    assert.notEqual(tickets[0].mod, tickets[1].mod, 'different mounted content');
    await a.page.getByText(/No compatible commander yet/).waitFor();
    await b.page.getByText(/No compatible commander yet/).waitFor();
    await a.page.getByText('Tickets: 1   /   Compatible: 0', { exact: true }).waitFor();
    await shot(a, 'search');
    assert.equal(await a.ctl('IDC_INTERNET_START_GAME_BUTTON').count(), 0);
    assert.equal(await b.ctl('IDC_INTERNET_START_GAME_BUTTON').count(), 0);
    await Promise.all([a, b].map(c => c.page.getByText(/No compatible commander found/).waitFor({ timeout: 100000 })));
    await until(async () => !(await listings()).length);
    console.log('Incompatible stock / mounted mod: two tickets, full real search window elapsed, no staging or leftover listings.');
    await b.open(stock);
    await b.choose('social', 'orbital-foundry');
    await Promise.all([a.btn('Retry matchmaking').click(), b.search()]);
    await Promise.all(
      [a, b].map(c =>
        c.page
          .getByRole('button', { name: /^Vote for / })
          .first()
          .waitFor()
      )
    );
    assert.equal(await a.page.locator('.mm-slot span').textContent(), 'Besh');
    assert.equal(await b.page.locator('.mm-slot span').textContent(), 'Aurek');
    await a.page.keyboard.press('Backspace');
    await a.page.getByText('Left the map vote. No result recorded.').waitFor();
    await b.btn('Retry matchmaking').waitFor();
    await until(async () => !(await listings()).length);
    assert.equal(await b.page.evaluate(() => localStorage.getItem('swr.ranked.ledger.v1')), null);
    await Promise.all([a.search(), b.btn('Retry matchmaking').click()]);
    for (const c of [a, b]) {
      await c.ctl('IDC_INTERNET_START_GAME_BUTTON').waitFor();
      await c
        .ctl('IDC_INTERNET_CHAT_LIST')
        .getByText(/joined the game/)
        .waitFor();
    }
    if (process.env.SWR_FLIGHT_SHOTS) await a.page.screenshot({ path: path.join(process.env.SWR_FLIGHT_SHOTS, 'flight-staging.png') });
    const chat = b.ctl('IDC_INTERNET_CHAT_EDIT').locator('input');
    await chat.fill('Flight check from Besh');
    await chat.press('Enter');
    await a.ctl('IDC_INTERNET_CHAT_LIST').getByText('Besh: Flight check from Besh').waitFor();
    await until(async () => !(await listings()).length);
    console.log('Compatible stock pair: both native Internet staging dialogs; Besh → Aurek staging chat delivered.');
    for (const c of [a, b]) {
      const names = await Promise.all(
        [0, 1].map(i =>
          c
            .ctl('IDC_PLAYER_NAME_' + i)
            .locator('.dlg-combo-text')
            .textContent()
        )
      );
      assert.deepEqual(names.sort(), ['Aurek', 'Besh']);
    }
    // Leaving paired staging returns to matchmaking. Manual Internet/LAN rooms use the separate custom games route.
    const guest = /Accept/i.test(await a.ctl('IDC_INTERNET_START_GAME_BUTTON').textContent()) ? a : b;
    const host = guest === a ? b : a;
    await guest.ctl('IDC_LAN_CANCEL_BUTTON').click();
    await guest.afterPairedStaging();
    await host.page.keyboard.press('Escape');
    await host.afterPairedStaging();
    await host.search();
    await until(async () => (await listings()).length === 1);
    await host.page.keyboard.press('Escape');
    await until(async () => !(await listings()).length);
    await host.page.getByText(/Search cancelled/).waitFor();
    for (const c of [host, guest]) {
      await c.btn('Custom games').click();
    }
    await host.ctl('IDC_MULTIPLAYER_LAN_BUTTON').click();
    await host.ctl('IDC_LAN_HOST_GAME_BUTTON').click();
    await host.ctl('IDC_INTERNET_CREATE_GAME_BUTTON').click();
    const line = await host
      .ctl('IDC_LAN_CHAT_LIST')
      .getByText(/^Join code /)
      .textContent();
    const code = /: ([a-z2-9]{9})$/.exec(line)?.[1];
    assert(code, 'The private host has a real join code');
    await host.btn('Invite friends').waitFor();
    assert.deepEqual(await listings(), [], 'LAN room must never be advertised');
    await guest.ctl('IDC_MULTIPLAYER_INTERNET_BUTTON').click();
    await guest.ctl('IDC_SWR_JOIN_BY_CODE').click();
    await guest.ctl('IDC_INTERNET_GAME_PASSWORD_EDIT').locator('input').fill(code);
    await guest.ctl('IDC_OK').click();
    await guest
      .ctl('IDC_INTERNET_CHAT_LIST')
      .getByText(/joined the game/)
      .waitFor();
    assert.equal(await host.btn('Invite friends').isVisible(), false);
    assert.equal(await guest.btn('Invite friends').isVisible(), false);
    await guest.ctl('IDC_LAN_CANCEL_BUTTON').click();
    await host.btn('Invite friends').waitFor();
    await guest.page.goto(stock + '/play.html?multiplayer=lan&join=' + code + '&lobby=' + encodeURIComponent(relay));
    await guest
      .ctl('IDC_LAN_CHAT_LIST')
      .getByText(/joined the game/)
      .waitFor();
    assert.equal(await host.btn('Invite friends').isVisible(), false);
    console.log(
      'PASS: rosters, Back through the Play tab, private LAN → Internet join-by-code, invite availability, and direct accepted-invite URL → staging.'
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    for (const s of servers) s.kill();
    await worker?.dispose();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
