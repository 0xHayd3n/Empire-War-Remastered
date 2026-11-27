// Called from the mounted Teams test. The four Warlord seats intentionally
// share a search family, not a selectable faction, portrait, or default crest.
const assert = require('node:assert/strict');
module.exports = async function checkWarlords(page, board, seat) {
  const stage = board.locator('.op-command-stage'),
    search = stage.getByRole('searchbox'),
    apply = stage.locator('.op-ring-assign'),
    header = stage.locator('.op-family-current'),
    ready = model => board.locator(`.op-command-stage[data-ready="true"][data-model="${model}" i]`).waitFor();
  const cases = [
    ['Campaign garrisons', '1125571106', 'Warlords', 'Minor Warlords', 'Phase II Dark Trooper', 'PHASE_II_DARK_TROOPER.ALO'],
    ['Bliss Shargael', '1125571106', 'Imperial_Proteus', 'Minor Imperial Warlords', 'Vedder', 'IMPOFFICER_VEDDER.ALO'],
    ['Blitzer Harrsk', '1397421866', 'Warlords', 'Warlord', 'Stormtrooper', 'EI_STORMTROOPER.ALO'],
    ['Santhe Security Sergeant', '3387971722', 'Warlords', 'Warlord', 'Santhe Security Sergeant', 'NI_SANTHETROOPER.ALO']
  ];
  for (const [q, p, id, title, name, model] of cases) {
    const hasEmblem = id === 'Imperial_Proteus';
    await seat.click();
    await search.fill(q);
    assert.equal(await stage.getAttribute('data-total'), '1', q);
    await ready(model);
    assert.equal(await header.locator('strong').innerText(), title);
    assert.equal(await apply.getAttribute('data-commander'), name);
    assert.equal(await header.locator('.uc-crest').getAttribute('data-crest-kind'), hasEmblem ? 'emblem' : 'standard');
    assert.equal(await header.locator('.op-crest-credit').isVisible(), !hasEmblem);
    if (hasEmblem) {
      assert.match(await header.locator('img').getAttribute('data-crest-asset'), /Imperial cog/i);
      assert.match(await stage.locator('.op-ring-meta').innerText(), /Playable campaign regimes/);
    } else {
      assert.equal(await header.locator('.op-crest-credit').innerText(), 'Universal marker');
      assert.match(await stage.locator('.op-ring-meta').innerText(), /Field representative/);
    }
    if (q === 'Campaign garrisons') assert.match(await stage.locator('.op-ring-meta').innerText(), /Campaign garrisons/);
    if (process.env.SHOTS && (hasEmblem || p === '3387971722'))
      await stage.screenshot({ path: require('node:path').join(process.env.SHOTS, `warlord-${id}-${p}.png`) });
    await apply.click();
    assert.match(await seat.getAttribute('aria-label'), new RegExp(`${title} · ${name}`));
    // Start a fresh, unfiltered ring from the assigned seat. A shared native
    // name or a similarly named family must not restore another roster.
    await seat.click();
    assert.equal(await search.inputValue(), '');
    assert.equal(await apply.getAttribute('data-source'), p);
    assert.equal(await apply.getAttribute('data-faction'), id);
    await search.press('Escape');
    if (hasEmblem) await page.setViewportSize({ width: 1250, height: 800 });
  }
  await seat.click();
  await search.fill('Duron Veertag');
  assert.equal(await stage.getAttribute('data-total'), '0');
  await search.press('Escape');
  console.log(
    'Verified four Warlord seats, two campaign roles, three explicitly marked fallback crests, faction-colored Proteus cog and exact assignments.'
  );
};
