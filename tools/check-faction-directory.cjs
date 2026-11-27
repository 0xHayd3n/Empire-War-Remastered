// Exercise the real directory on the mounted Teams route. Shared faction
// names and crests must never collapse distinct commanders or change a seat.
const assert = require('node:assert/strict'),
  path = require('node:path');
module.exports = async function checkDirectory(page, board, stage) {
  const tile = stage.getByRole('button', { name: 'Faction directory', exact: true }),
    directory = stage.locator('.op-faction-browser'),
    query = stage.getByRole('searchbox'),
    apply = stage.locator('.op-ring-assign'),
    firstSeat = board.locator('.op-seat-card[data-seat="0"]'),
    original = await firstSeat.getAttribute('data-roster'),
    btns = directory.locator('button[data-roster]'),
    current = () => apply.evaluate(el => `${el.dataset.source}/${el.dataset.faction}`);
  assert.equal(await tile.innerText(), '');
  assert.equal(await tile.evaluate(b => getComputedStyle(b, '::after').content), 'none');
  assert.equal(await stage.locator('.op-family-step').count(), 0);
  assert.equal(await stage.locator('.op-faction-rail .uc-crest').count(), 1);
  const expected = await stage.evaluate(async () => {
    const { profiles } = await (await import('/js/game/solooperationlibrary.js')).soloLibrary(),
      { commandGroup } = await import('/js/game/commandgroups.js');
    return profiles
      .flatMap(p =>
        p.skirmishFactions.map(id => {
          const c = p.commanders[id],
            art = c.stage;
          return {
            key: `${p.id}/${id}`,
            group: commandGroup(p.id, id)?.name,
            faction: c.displayFaction || p.facts[id]?.label || id,
            name: art.kind === 'unit' ? art.label : c.name,
            shot: JSON.stringify([
              p.id,
              p.revision,
              art.profile || p.id,
              art.revision || p.revision,
              art.model,
              art.idle,
              (art.props || []).map(x => [x.model, x.bone])
            ]),
            mark: p.skirmishEmblems[id]?.hd || p.skirmishEmblems[id]?.art || null
          };
        })
      )
      .sort((a, b) => a.key.localeCompare(b.key));
  });
  const origSize = page.viewportSize();
  for (const [width, height] of [
    [1440, 900],
    [390, 844]
  ]) {
    await page.setViewportSize({ width, height });
    await tile.focus();
    await tile.press('Enter');
    await directory.waitFor();
    assert.deepEqual(
      await btns.evaluateAll(bs =>
        bs
          .map(b => ({
            key: b.dataset.roster,
            group: b.closest('section').getAttribute('aria-label'),
            faction: b.querySelector('.op-directory-faction').textContent,
            name: b.querySelector('.op-directory-name').textContent,
            shot: b.querySelector('.op-card-still').dataset.headshotKey,
            mark: b.querySelector('img.uc-crest')?.getAttribute('src') || null
          }))
          .sort((a, b) => a.key.localeCompare(b.key))
      ),
      expected
    );
    assert.equal(await directory.locator('section').count(), 9);
    assert.equal(await directory.getByText('All factions', { exact: true }).count(), 0);
    const compact = await directory.evaluate((el, perRow) => {
      const sizes = new Set(), categories = [];
      for (const section of el.querySelectorAll('.op-faction-section')) {
        const area = section.querySelector('.op-faction-options').getBoundingClientRect(),
          lines = new Map();
        const button = section.querySelector('.op-faction-group'),
          fan = [...button.querySelectorAll('[data-member]')];
        const head = button.getBoundingClientRect();
        if (Math.abs(head.left - area.left) > 1 || Math.abs(head.right - area.right) > 1)
          throw Error('Category header must span the full four-tile row');
        categories.push(section.getBoundingClientRect());
        if (fan.length < 2 || !getComputedStyle(button).backgroundImage.includes('linear-gradient')) throw Error('Missing group collage');
        for (const [i, mark] of fan.entries()) {
          if (!section.querySelector(`[data-roster="${mark.dataset.member}"]`)) throw Error('Crest belongs to another group');
          if (i && mark.getBoundingClientRect().left >= fan[i - 1].getBoundingClientRect().right)
            throw Error('Group crests should overlap');
        }
        for (const b of section.querySelectorAll('[data-roster]')) {
          const r = b.getBoundingClientRect(),
            name = b.querySelector('.op-directory-name'),
            label = b.querySelector('.op-directory-faction');
          sizes.add(`${r.width}×${r.height}`);
          if (
            [name, label].some(
              e =>
                getComputedStyle(e).textAlign !== 'center' ||
                e.scrollWidth > e.clientWidth + 1 ||
                e.getBoundingClientRect().bottom > r.bottom + 1
            )
          )
            throw Error('Clipped/off-centre text: ' + b.dataset.roster);
          const row = lines.get(r.top) || { left: r.left, count: 0 };
          row.right = r.right;
          row.count++;
          lines.set(r.top, row);
        }
        const rows = [...lines.values()];
        for (const [i, row] of rows.entries()) {
          if (row.count > 4 || (i < rows.length - 1 && row.count !== 4)) throw Error('Expected four tiles per full row');
          if (Math.abs(row.left + row.right - (area.left + area.right)) > 2) throw Error('Uncentred commander row');
        }
      }
      for (let i = 0; i < categories.length; i += perRow) {
        const row = categories.slice(i, i + perRow);
        if (row.length === 2 && (row[0].top !== row[1].top || row[0].right >= row[1].left)) throw Error('Expected side-by-side categories');
        if (categories[i + perRow] && categories[i + perRow].top <= Math.max(...row.map(r => r.bottom))) throw Error('Next category row overlaps its predecessor');
      }
      return [...sizes];
    }, width === 1440 ? 2 : 1);
    assert.deepEqual(compact, [width === 1440 ? '88×90' : '80×82']);
    assert.equal(await directory.locator('[aria-current="true"]').getAttribute('data-roster'), original);
    assert.equal(await directory.locator('canvas').count(), 0);
    const layout = await stage.evaluate(el => {
      const rect = s => el.querySelector(s).getBoundingClientRect(),
        s = rect('.op-search'),
        t = rect('.op-faction-toggle'),
        d = rect('.op-faction-browser'),
        art = rect('.op-directory-art'),
        name = rect('.op-directory-name'),
        faction = rect('.op-directory-faction'),
        logo = rect('.op-directory-art .uc-crest'),
        pic = rect('.op-directory-art .op-card-still');
      return (
        t.right <= s.left &&
        Math.abs(t.y - s.y) < 2 &&
        t.width >= 40 &&
        t.bottom <= d.y + 1 &&
        d.right <= innerWidth &&
        art.bottom <= name.top + 1 &&
        name.bottom <= faction.top + 1 &&
        logo.right > pic.left &&
        logo.left < pic.right &&
        getComputedStyle(el, '::after').backdropFilter.includes('blur') &&
        el.querySelector('.op-ring-arena').inert
      );
    });
    assert(layout, 'icon must lead Search, with stacked crest/render, name and faction in the gallery');
    if (width === 1440) {
      // Scroll the actual grid, not a preload helper. Every transparent image
      // must belong to its own revision. A crest-only/opaque/blank fallback fails.
      const audit = await directory.evaluate(async panel => {
        const rows = [...panel.querySelectorAll('button[data-roster]')],
          hashes = new Set(),
          urls = new Set(),
          cv = document.createElement('canvas');
        cv.width = 90;
        cv.height = 60;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        for (const b of rows) {
          const img = b.querySelector('.op-card-still');
          b.scrollIntoView({ block: 'nearest' });
          const end = performance.now() + 30000;
          while (!img.src || !img.naturalWidth) {
            if (performance.now() > end) throw Error('Missing 3D still for ' + b.dataset.roster);
            await new Promise(r => setTimeout(r, 30));
          }
          await img.decode();
          if (!img.src.startsWith('blob:')) throw Error('Not a local model render');
          urls.add(img.src);
          ctx.clearRect(0, 0, 90, 60);
          ctx.drawImage(img, 0, 0, 90, 60);
          const d = ctx.getImageData(0, 0, 90, 60).data;
          let ink = 0,
            clear = 0,
            hash = 2166136261;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] > 200) ink++;
            if (!d[i + 3]) clear++;
            for (let k = 0; k < 4; k++) hash = Math.imul(hash ^ d[i + k], 16777619);
          }
          if (ink < 90 || !clear) throw Error('Empty or opaque bust ' + b.dataset.roster);
          hashes.add(hash);
        }
        panel.querySelector('.op-faction-list').scrollTop = 0;
        return { keys: rows.length, pixels: hashes.size, urls: urls.size };
      });
      assert.deepEqual(audit, { keys: 75, pixels: 75, urls: 75 });
      assert.equal(
        await directory.locator(`[data-roster="${original}"] .op-card-still`).getAttribute('src'),
        await firstSeat.locator('.op-card-still').getAttribute('src'),
        'gallery and assigned player share the exact rendered PNG'
      );
    }
    if (process.env.SHOTS) {
      await page.screenshot({ path: path.join(process.env.SHOTS, `commander-directory-${width}.png`) });
    }
    await query.fill('Nute Gunray');
    assert.equal(await directory.locator('button[data-roster]:visible').count(), 1);
    assert.equal(await directory.locator('button[data-roster]:visible').getAttribute('data-roster'), '1976399102/Trade_Federation');
    await query.fill('nobody by that name');
    assert(await directory.getByText('No matching commanders or factions.').isVisible());
    await query.press('Escape');
    assert.equal(await directory.isVisible(), false);
    assert.equal(await query.inputValue(), '');
    assert(await tile.evaluate(b => b === document.activeElement));
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `directory-icon-${width}.png`) });
  }
  await query.fill('does not match a commander');
  await tile.click();
  await query.fill('commerce');
  await query.press('Escape');
  assert.equal(await query.inputValue(), 'does not match a commander');
  assert(await stage.getByText('No matching commanders.').isVisible());
  await tile.click();
  await query.fill('Galactic Empire');
  assert.equal(await directory.locator('button[data-roster]:visible').count(), 4);
  await query.fill('Galactic Empire Remake');
  await query.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await current(), '1770851727/Empire');
  assert.equal(await stage.locator('.op-ring-bio h3').innerText(), 'Darth Vader');
  assert.equal(await stage.getAttribute('data-total'), '4');
  assert.equal(await firstSeat.getAttribute('data-roster'), original);
  await tile.click();
  await directory.locator('[data-group="Separatist coalition"]').click();
  assert.equal(await stage.getAttribute('data-total'), '7');
  // The existing clickable group caption clears a group scope; no extra tag.
  await stage.locator('.op-group-link').click();
  assert.equal(await stage.getAttribute('data-total'), '75');
  await tile.click();
  await directory.locator('[data-roster="1976399102/Commerce_Guild"]').click();
  assert.equal(await current(), '1976399102/Commerce_Guild');
  assert.equal(await firstSeat.getAttribute('data-roster'), original);
  assert.equal(await query.inputValue(), 'Commerce Guild');
  await query.fill('');
  assert.equal(await stage.getAttribute('data-total'), '75', 'clearing a scoped search restores the ring without an All factions tag');
  await page.setViewportSize(origSize);
  console.log(
    '75 exact directory cards in nine groups, 75 distinct model renders, shared seat cache, icon-only toolbar, name/faction layout, keyboard, cancel and preview-only picks OK.'
  );
};
