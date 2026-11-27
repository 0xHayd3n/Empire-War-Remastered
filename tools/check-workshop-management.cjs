// Called by check-workshop-exchange.cjs against its real, isolated Universal frame.
const assert = require('node:assert/strict');
function tar() {
  const head = Buffer.alloc(512),
    data = Buffer.from('private archive fixture');
  head.write('Field Kit/Data/kit.txt');
  head.write('0000644\0', 100);
  head.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
  head.fill(32, 148, 156);
  head.write('0', 156);
  head.write('ustar\0', 257);
  head.write(
    [...head]
      .reduce((a, b) => a + b, 0)
      .toString(8)
      .padStart(6, '0') + '\0 ',
    148
  );
  return Buffer.concat([head, data, Buffer.alloc(512 - data.length + 1024)]);
}
module.exports = async function ({ page, f, appManifest, item }) {
  const b = name => f.getByRole('button', { name, exact: true }),
    cats = f.getByRole('region', { name: 'Mod categories' }),
    cat = n => cats.getByRole('button', { name: new RegExp('^' + n) });
  const first = f.locator(`[data-mod="${item}"]`),
    dialog = f.getByRole('dialog');
  await cat('Mod DB mirrors').click();
  assert.equal(await f.locator('[data-mod]').count(), 1);
  await f.getByText('Sources · Steam + Mod DB', { exact: true }).click();
  assert.equal(
    await f.getByRole('link', { name: 'Mod DB downloads' }).getAttribute('href'),
    'https://www.moddb.com/mods/thrawns-revenge/downloads'
  );
  assert.equal(await f.getByRole('link', { name: 'Publisher’s mirror list' }).getAttribute('href'), 'https://thrawnsrevenge.com/downloads');
  await b('New category').click();
  await dialog.getByLabel('Category name').fill('To try');
  await b('Save category').click();
  assert.equal(await f.locator('[data-mod]').count(), 0);
  await cat('All mods').click();
  await first.click();
  await f.getByText('File in categories', { exact: true }).click();
  await f.getByLabel('To try', { exact: true }).check();
  await cat('To try').click();
  assert.equal(await f.locator('[data-mod]').count(), 1);
  await b('Rename').click();
  await dialog.getByLabel('Category name').fill('Fleet picks');
  await b('Save category').click();
  await page.reload();
  await cat('Fleet picks').click();
  assert.equal(await first.count(), 1);
  await b('Delete category…').click();
  await b('Cancel').click();
  assert.equal(await cat('Fleet picks').count(), 1);
  await b('Delete category…').click();
  await dialog.getByRole('button', { name: 'Delete category', exact: true }).click();
  assert.equal(await cat('Fleet picks').count(), 0);
  assert.equal(await first.count(), 1);
  await first.click();
  await b('Manage in Steam…').click();
  assert.equal(
    await dialog.getByRole('link', { name: 'Open item in Steam client' }).getAttribute('href'),
    `steam://url/CommunityFilePage/${item}`
  );
  await b('Cancel').click();
  await b('Watch local status').click();
  await f.getByText(/Steam installation confirmed/).waitFor();
  appManifest('1048576', 25, 100);
  const meter = f.getByRole('progressbar', { name: 'App-wide Steam transfer' });
  await meter.waitFor();
  assert.equal(await meter.getAttribute('value'), '25');
  appManifest('1048576', 70, 100);
  await f.getByText('70 bytes / 100 bytes').waitFor();
  appManifest('4', 100, 100);
  await meter.waitFor({ state: 'detached' });
  await b('Stop watching').click();
  await f.locator('[data-mod="1976399102"]').click();
  await b('Get with Steam…').click();
  await dialog.getByText('One-time download with the Steam client console').click();
  assert.equal(await dialog.locator('code').textContent(), 'workshop_download_item 32470 1976399102');
  await b('Cancel').click();
  await f.getByText('Discover & import', { exact: true }).click();
  const input = f.getByLabel('Compatible local mod archive');
  await input.setInputFiles({ name: 'Field Kit.tar', mimeType: 'application/x-tar', buffer: tar() });
  await dialog.getByRole('button', { name: 'Install local archive' }).click();
  await f.getByText('Installed in this browser profile.', { exact: false }).waitFor();
  assert.equal(await f.locator('.wx-cat-nav [aria-pressed=true] span').innerText(), 'Browser imports');
  const frame = page.frames().find(fr => fr.url().startsWith('http://127.0.0.1:9031/'));
  async function bytes() {
    return frame.evaluate(async () => {
      const { openOverlay } = await import('/js/mods.js');
      const overlay = await openOverlay();
      const v = await overlay?.read('DATA\\KIT.TXT');
      return v ? new TextDecoder().decode(v) : null;
    });
  }
  assert.equal(await bytes(), 'private archive fixture');
  const names = () =>
    frame.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('mods');
      const out = [];
      for await (const n of dir.keys()) out.push(n);
      return out;
    });
  assert.equal((await names()).length, 1);
  await frame.evaluate(async () => {
    const root = await navigator.storage.getDirectory(),
      saves = await root.getDirectoryHandle('saves', { create: true });
    await saves.getFileHandle('keep', { create: true });
  });
  await b('Remove browser copy…').click();
  await b('Cancel').click();
  assert.equal((await names()).length, 1);
  await b('Remove browser copy…').click();
  await dialog.getByRole('button', { name: 'Remove browser copy', exact: true }).click();
  await f.getByText('Browser archive removed.', { exact: false }).waitFor();
  assert.equal(await bytes(), null);
  assert.deepEqual(await names(), []);
  assert(
    await frame.evaluate(
      async () => !!(await (await (await navigator.storage.getDirectory()).getDirectoryHandle('saves')).getFileHandle('keep'))
    )
  );
  await cat('All mods').click();
  await first.click();
  console.log(
    'PASS: category CRUD/filing, publisher mirror, scoped Steam handoff + manifest progress, actual OPFS install/read/remove, no save deletion.'
  );
};
