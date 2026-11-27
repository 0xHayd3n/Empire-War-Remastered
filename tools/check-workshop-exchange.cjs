// Disposable Chromium profile, game, Steam library, pack and port registry. Nothing is downloaded.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { spawn } = require('node:child_process'),
  { once } = require('node:events');
const host = 'http://127.0.0.1:9030',
  stock = 'http://127.0.0.1:9031';

async function server() {
  // Test-only socket binding: keep the prepared game's *actual* listener inside our assigned range.
  // The unchanged registry/hash algorithm is covered in test-title-workshop.mjs.
  const net = require('node:net'),
    listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (port, ...rest) {
    if (+port >= 30000 && +port < 47000) port = 9048;
    assert(+port >= 9030 && +port <= 9049);
    return listen.call(this, port, ...rest);
  };
  // The consent check exercises Steam's response validation, but cannot contact Steam.
  global.fetch = async (url, opts) => {
    assert.equal(String(url), 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/');
    assert.equal(opts.body.get('itemcount'), '1');
    assert.equal(opts.body.get('publishedfileids[0]'), '22');
    return Response.json({
      response: { publishedfiledetails: [{ result: 1, consumer_app_id: '32470', publishedfileid: '22', title: 'Signal relay' }] }
    });
  };
  process.argv = [process.execPath, 'server.mjs', '--universal', '--port', '9030'];
  await import('../server.mjs');
}

async function check() {
  const { chromium } = require('playwright-core');
  const { buildPack } = await import('./universal-library.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaw-exchange-')),
    steam = path.join(tmp, 'steam'),
    home = path.join(tmp, 'universal');
  const ids = ['1125571106', '22', '33'],
    paths = id => path.join(steam, 'steamapps/workshop/content/32470', id);
  function put(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  const committed = new Set();
  function appManifest(flags, done, total) {
    put(
      path.join(steam, 'steamapps/appmanifest_32470.acf'),
      `"AppState" { "appid" "32470" "StateFlags" "${flags}" "BytesDownloaded" "${done}" "BytesToDownload" "${total}" }`
    );
  }
  function createItem(id, title) {
    committed.add(id);
    put(
      path.join(steam, 'steamapps/workshop/appworkshop_32470.acf'),
      `"AppWorkshop" { "appid" "32470" "WorkshopItemsInstalled" { ${[...committed].map(id => `"${id}" { "size" "3" "manifest" "5111" }`).join(' ')} } }`
    );
    put(path.join(paths(id), 'Data', 'priority.txt'), id);
    if (title)
      put(
        path.join(paths(id), 'modinfo.json'),
        JSON.stringify({
          name: title,
          description: '<img src=https://invalid.test/attack> Notes are text.',
          icon: 'https://invalid.test/image.png',
          version: '1.0',
          nativeEdition: true
        })
      ); // untrusted evidence
  }
  let child, browser;
  try {
    for (const d of ['GameData', 'corruption']) put(path.join(tmp, 'game', d, 'Data', 'megafiles.xml'), '<Mega_Files/>');
    put(path.join(steam, 'steam.exe'), 'Capability marker; never executed.');
    createItem(ids[0], 'Flag squadron');
    createItem('22');
    createItem('33', 'Screen group');
    put(path.join(paths(ids[0]), 'splash.jpg'), fs.readFileSync(path.join(__dirname, '../public/icons/share.jpg')));
    put(
      path.join(tmp, 'ModCollectionLauncher/profiles/order.json'),
      JSON.stringify({
        schemaVersion: 1,
        profile: {
          displayName: 'Border patrol',
          variant: 'forces-of-corruption',
          isDraft: false,
          primaryItemId: ids[0],
          itemOrder: ['33', ids[0]],
          requiredItemIds: ['33'],
          optionalItemIds: ['66'],
          disabledItemIds: ['66'],
          incompatibilities: []
        }
      })
    );
    buildPack(home, ids[0], paths(ids[0]));
    child = spawn(process.execPath, [__filename, '--fixture-server'], {
      env: {
        ...process.env,
        PORT: '9030',
        STEAM_PATH: steam,
        'ProgramFiles(x86)': path.join(tmp, 'programs'),
        HOME: tmp,
        USERPROFILE: tmp,
        LOCALAPPDATA: tmp,
        SWR_STATIC: '',
        SWR_MOD: '',
        SWR_GAME: path.join(tmp, 'game'),
        SWR_UNIVERSAL_LIBRARY: home,
        SWR_PLAYSET_HOME: tmp,
        SWR_COLLECTION_ART: path.join(tmp, 'art')
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((ok, no) => {
      const timer = setTimeout(() => no(Error('Timed out starting fixture')), 15000);
      child.stdout.on('data', b => {
        if (b.includes('Universal game:')) {
          clearTimeout(timer);
          ok();
        }
      });
      child.stderr.on('data', b => process.stderr.write(b));
      child.once('exit', c => {
        clearTimeout(timer);
        no(Error('Fixture exited: ' + c));
      });
    });
    const mounted = await fetch(host + '/api/mount/stock', { method: 'POST', headers: { Origin: host } });
    assert(mounted.ok);
    const catalog = await (await fetch(stock + '/api/title-workshop/catalog')).json();
    assert.equal(catalog.mods.filter(m => m.installed).length, 3);
    assert(catalog.mods.every(m => !m.nativeId && !m.baseId));
    assert(!JSON.stringify(catalog).includes(JSON.stringify(tmp).slice(1, -1)));
    assert.equal(catalog.mods.find(m => m.id === ids[0]).ready, true, JSON.stringify(catalog.mods.find(m => m.id === ids[0])));
    browser = await chromium.launch({ channel: 'chrome' });
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 850 } }),
      page = await ctx.newPage();
    page.setDefaultTimeout(9000);
    const errors = [],
      outside = [],
      network = [];
    page.on('pageerror', e => errors.push(e.message));
    ctx.on('request', r => network.push(r.url()));
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.protocol.startsWith('http') && u.hostname !== '127.0.0.1') {
        outside.push(u.href);
        return route.abort();
      }
      return route.continue();
    });
    // Minimal title frame to avoid a game-archive dependency. Catalog, media, titles, refresh,
    // prepare and the opened /play.html + /asset endpoints are the real server implementations.
    // Real host + title navigation; only the game bootstrap is replaced with menu-control fixtures.
    const shell = (
      universal = true
    ) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${universal ? `<meta name="swr-universal" content="${host}">` : ''}
      ${['typography', 'style', 'briefing', 'title-menu', 'mode-tiles', 'command-library'].map(n => `<link rel="stylesheet" href="${n}.css">`).join('')}
      <script type="importmap">{"imports":{"three":"./vendor/three/build/three.module.js","three/addons/":"./vendor/three/examples/jsm/"}}</script>
      <body class="front-end"><script type="module">import {titleMenu} from './js/game/titlemenu.js';
        const menu = titleMenu({controls:['IDC_MAIN_MENU_SINGLE_PLAYER_GAMES','IDC_MAIN_MENU_MULTIPLAYER'].map(id=>({id}))}, {play(){}},
          {singleDef:{controls:[]},multiDef:{controls:[]}, latest:()=>null}); menu.show('workshop');</script>`;
    await ctx.route(stock + '/play.html', r =>
      r.fulfill({
        contentType: 'text/html',
        headers: { 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
        body: shell()
      })
    );
    await page.goto(host);
    const f = page.frameLocator('iframe'),
      btn = s => f.getByRole('button', { name: s, exact: true });
    const tile = id => f.locator(`[data-mod="${id}"]`),
      find = f.getByLabel('Search mods'),
      heading = s => f.getByRole('heading', { name: s, exact: true });
    await tile(ids[0]).waitFor();
    assert.equal(await f.getByText(/native/i).count(), 0);
    await require('./check-workshop-management.cjs')({ page, f, appManifest, item: ids[0] });
    const hero = f.locator('#wx-dossier img');
    await hero.evaluate(img => img.decode());
    assert.equal(await hero.getAttribute('src'), '/api/title-workshop/picture/' + ids[0]);
    await tile(ids[0]).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await tile('1976399102').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Home');
    assert(await tile(ids[0]).evaluate(e => document.activeElement === e));
    await find.fill('xxxxxxxxxx');
    await f.getByText('No matching mods.').waitFor();
    await find.fill('Border patrol');
    assert.equal(await f.locator('[data-mod]').count(), 3);
    await tile('66').click();
    await f.getByText('Source · Steam Workshop', { exact: true }).click();
    const steamLink = f.getByRole('link', { name: 'Open Steam to subscribe' });
    assert.equal(await steamLink.getAttribute('href'), 'https://steamcommunity.com/sharedfiles/filedetails/?id=66');
    assert.equal(await steamLink.getAttribute('target'), '_blank');
    assert.equal(await btn('Add to playset').count(), 0);
    const titlePosts = () => network.filter(x => x.endsWith('/title-workshop/titles')).length;
    assert.equal(titlePosts(), 0);
    await btn('Look up titles').click();
    await f.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    assert.equal(titlePosts(), 0);
    await btn('Look up titles').click();
    await f.getByRole('dialog').getByRole('button', { name: 'Look up titles' }).click();
    await find.fill('Signal relay');
    await tile('22').waitFor();
    assert.equal(titlePosts(), 1);
    await find.fill('');
    await tile(ids[0]).click();
    await btn('Add to playset').click();
    assert(await btn('Remove from playset').evaluate(e => e === document.activeElement));
    await f.getByText('Author notes').click();
    await f.getByText('<img src=https://invalid.test/attack> Notes are text.').waitFor();
    await f.getByText('Collection: Border patrol · 2 enabled').click();
    await btn('Use collection order').click();
    const order = f.locator('.set-order strong');
    assert.deepEqual(await order.allTextContents(), ['Screen group', 'Thrawn’s Revenge']);
    await btn('Raise Thrawn’s Revenge').click();
    assert.deepEqual(await order.allTextContents(), ['Thrawn’s Revenge', 'Screen group']);
    assert(await btn('Lower Thrawn’s Revenge').evaluate(e => e === document.activeElement));
    await f.getByLabel('Playset name').fill('Vanguard');
    await btn('Save playset').click();
    await btn('Remove from playset').click();
    await f.getByLabel('Saved playset').selectOption({ label: 'Vanguard' });
    await btn('Use saved').click();
    await page.reload();
    await order.first().waitFor();
    assert.deepEqual(await order.allTextContents(), ['Thrawn’s Revenge', 'Screen group']);
    await btn('Prepare playset').click();
    const open = f.getByRole('link', { name: 'Open playset game' });
    await open.waitFor();
    const gameUrl = 'http://127.0.0.1:9048/play.html';
    assert.equal(await open.getAttribute('href'), gameUrl);
    const popup = ctx.waitForEvent('page');
    await open.click();
    const game = await popup;
    await game.waitForURL(gameUrl, { waitUntil: 'commit' });
    const layers = await game.request.get(new URL('/api/mounted', gameUrl).href);
    assert.deepEqual(
      (await layers.json()).map(r => r.workshop),
      ['33', ids[0]]
    );
    assert.equal(
      await (await game.request.get(new URL('/asset/Data/priority.txt', gameUrl).href)).text(),
      ids[0],
      'First item wins real asset lookup'
    );
    await game.close();
    // Only mutate our temp inventory. Handoff did not install 66. Explicit refresh discovers it.
    createItem('66', 'Newly local');
    await btn('Refresh').click();
    await f.getByText('4 local items · 1 collection.', { exact: false }).waitFor();
    await tile('66').click();
    await heading('Newly local').waitFor();
    assert.equal(await btn('Add to playset').count(), 1);
    assert.equal(await open.count(), 0);
    await page.setViewportSize({ width: 360, height: 680 });
    await tile(ids[0]).click();
    assert(await f.locator('.title-menu').evaluate(e => e.scrollWidth <= innerWidth));
    assert(await f.locator('.wx-wall').evaluate(e => e.scrollWidth > e.clientWidth));
    await tile(ids[0]).focus();
    await page.keyboard.press('End');
    assert.equal(await f.locator('[data-mod]:focus').count(), 1);
    await page.keyboard.press('Tab');
    assert(await f.locator('#wx-dossier :focus').count(), 'Tab leaves entire wall for preview actions');
    if (process.env.SWR_WORKSHOP_SHOTS) {
      await tile(ids[0]).click();
      await tile(ids[0]).evaluate(e => e.closest('.title-menu').scrollTo(0, 0));
      await page.screenshot({ path: path.join(process.env.SWR_WORKSHOP_SHOTS, 'exchange-phone.png') });
      await page.setViewportSize({ width: 1360, height: 850 });
      await tile(ids[0]).evaluate(e => e.closest('.title-menu').scrollTo(0, 0));
      await page.screenshot({ path: path.join(process.env.SWR_WORKSHOP_SHOTS, 'exchange-desktop.png') });
    }
    await tile(ids[0]).click();
    const packed = 'http://127.0.0.1:9032';
    await Promise.all([
      page.waitForEvent('framenavigated', { predicate: fr => fr.url() === packed + '/play.html?universal-mode=profile-play' }),
      btn('Play this overhaul').click()
    ]);
    assert.equal((await (await fetch(packed + '/api/mounted')).json())[0].workshop, ids[0]);
    // Supported-case UI using an explicitly reviewed pair fixture from the actual catalog builder.
    const { titleWorkshop } = await import('./title-workshop.mjs'),
      { readLibrary } = await import('./workshop-library.mjs');
    const reviewed = titleWorkshop({
      home,
      library: readLibrary([steam], path.join(tmp, 'ModCollectionLauncher/profiles'), path.join(tmp, 'game')),
      eras: () => [],
      verifiedEditions: [{ base: '22', native: '33', evidence: 'Fixture release note: 33 is the author’s stripped-back version of 22.' }]
    });
    await ctx.route(stock + '/api/title-workshop/catalog', r => r.fulfill({ json: reviewed.catalog() }));
    await page.reload();
    await tile('22').click();
    await btn('Inspect Native edition').click();
    await heading('Native · Author’s stripped edition').waitFor();
    await f.getByText('Source · Steam Workshop', { exact: true }).click();
    assert.equal(
      await f.getByRole('link', { name: 'View on Steam' }).getAttribute('href'),
      'https://steamcommunity.com/sharedfiles/filedetails/?id=33'
    );
    await btn('Remove from playset').click();
    await btn('Add to playset').click();
    assert.equal((await order.allTextContents()).at(-1), 'Screen group');
    await btn('Inspect Base edition').click();
    await heading('Base · Original source mod').waitFor();
    // Standalone playset: mounted doesn't mean installed; no Steam builder actions.
    await ctx.route('http://127.0.0.1:9048/exchange', r => r.fulfill({ contentType: 'text/html', body: shell(false) }));
    await page.goto('http://127.0.0.1:9048/exchange');
    await page.getByRole('heading', { name: 'Screen group', exact: true }).waitFor();
    assert.equal(await page.locator('[data-mod]').count(), 2);
    assert.equal(await page.getByRole('button', { name: 'Add to playset' }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Manage local mods' }).getAttribute('href'), 'index.html');
    assert.equal(await page.getByRole('button', { name: /installed/i }).count(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(outside, []);
    console.log(
      'PASS: gallery, keyboard/mobile, Steam handoff + opt-in lookup, refresh, literal metadata, edition gate, saved collection/order, real opened playset + winning asset, mounted fallback.'
    );
  } finally {
    await browser?.close();
    if (child && child.exitCode === null && !child.killed) {
      const end = once(child, 'exit');
      child.kill();
      await end;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
(process.argv.includes('--fixture-server') ? server() : check()).catch(e => {
  console.error(e);
  process.exitCode = 1;
});
