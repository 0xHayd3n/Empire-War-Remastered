// Check actual in-game paint, not just the color input. Start in the Universal
// window for both cases; the optional Awakening story remounts its own profile.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const mode of ['story', 'instant']) {
      const page = await browser.newPage({ reducedMotion: 'reduce' });
      try {
        await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
        const f = page.frameLocator('#game'),
          board = f.locator('.op-setup');
        for (const id of [
          'TITLE_PLAY',
          'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES',
          mode === 'story' ? 'IDC_NEW_CAMPAIGN_BUTTON' : 'IDC_INSTANT_BATTLE_BUTTON'
        ])
          await f.locator(`[data-id="${id}"]`).click({ timeout: 90000 });
        let remote = false;
        if (mode === 'story') {
          await board.locator('[data-story][data-source="stock"]').first().waitFor({ timeout: 90000 });
          const aor = board.locator('[data-story][data-source="1397421866"]').first();
          remote = !!(await aor.count());
          if (remote) await aor.click();
          await board.getByRole('tab', { name: 'Faction' }).click();
          await board.getByRole('radio', { disabled: false }).first().check();
        } else {
          await board.getByRole('searchbox').fill('Abregado Forces of Corruption land');
          await board.locator('[data-world="Abregado_Rae"][data-domain="land"][data-source="stock"]').first().click();
        }
        await board.locator('.op-go:enabled').click();
        const host = page.frames().find(x => x.parentFrame() === page.mainFrame());
        await host.waitForFunction(
          m =>
            (m === 'story'
              ? window.game?.galaxy?.campaign
              : window.game?.setup?.instant?.domain === 'land' && window.game.world?.units?.length) &&
            document.querySelector('#loading.hidden'),
          mode,
          { timeout: 150000 }
        );
        const result = await host.evaluate(async mode => {
          const { db, factionColor } = await import('/js/gamedata.js'),
            g = window.game;
          const hex = floats =>
            '#' +
            floats
              .slice(0, 3)
              .map(n =>
                Math.round(n * 255)
                  .toString(16)
                  .padStart(2, '0')
              )
              .join('');
          if (mode === 'story') {
            const { unitTeamColor } = await import('/js/game/teamcolor.js');
            const { Color } = await import('/vendor/three/build/three.module.js');
            const paint = new Color(factionColor('Rebel'));
            return {
              profile: db.universalProfile,
              campaign: g.galaxy.campaign.name,
              relative: g.relativeColors(),
              map: ['Empire', 'Rebel'].map(f => hex(g.factionColor(f))),
              usesRoster: unitTeamColor(false, null, 'Rebel', paint) === paint,
              keepsMarkings: unitTeamColor(false, { str: () => '0,0,255' }, 'Rebel', paint).getHexString() === '0000ff'
            };
          }
          return {
            profile: db.universalProfile,
            field: g.setup.mapFile,
            factions: g.setup.teamFactions,
            native: g.setup.teamFactions.map(factionColor),
            units: g.world.colors.map(c => '#' + c.getHexString())
          };
        }, mode);
        if (mode === 'story') {
          assert.equal(result.profile, remote ? '1397421866' : 'stock');
          assert.equal(result.relative, false);
          assert(result.usesRoster && result.keepsMarkings);
          assert.deepEqual(result.map, remote ? ['#7abb4e', '#fc807e'] : ['#4bb765', '#ee5056']);
        } else {
          assert.equal(result.field, '_Land_Planet_AbregadoRae_02.ted');
          assert.deepEqual(result.units, result.native);
          assert.equal(new Set(result.units).size, 2);
        }
        console.log(mode, result);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
