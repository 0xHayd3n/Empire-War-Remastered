// Stock integration test. Exercise the actual launch callbacks, not a staged payload.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const mode of ['instant', 'skirmish'])
      for (const domain of ['land', 'space']) {
        if (process.env.CASE && !process.env.CASE.includes(mode + '-' + domain)) continue;
        const page = await browser.newPage({ viewport: { width: 1080, height: 768 }, reducedMotion: 'reduce' });
        page.on('pageerror', e => console.error('page:', e.message));
        page.on('console', m => {
          if (m.type() === 'error' && !/Failed to load resource|WebGL|favicon/.test(m.text())) console.error(m.text().slice(0, 750));
        });
        await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
        const f = page.frameLocator('#game');
        await f.locator('[data-id="TITLE_PLAY"]').click({ timeout: 90000 });
        await f.locator(`[data-id="${mode === 'instant' ? 'IDC_INSTANT_BATTLE_BUTTON' : 'IDC_SKIRMISH_GAMES_BUTTON'}"]`).click();
        const board = f.locator('.op-setup');
        await board.getByRole('searchbox').fill(`Abregado Forces of Corruption ${domain}`);
        const leaf = board.locator(`[data-world="Abregado_Rae"][data-domain="${domain}"][data-source="stock"]`),
          expected = await leaf.getAttribute('data-file');
        await leaf.click();
        if (mode === 'skirmish') {
          await board.getByRole('tab', { name: 'Teams' }).click();
          await board.getByRole('button', { name: 'Add ally' }).click();
          await board.getByRole('button', { name: 'Add opponent' }).click();
          for (const [seat, faction] of [
            ['You', 'Empire'],
            ['Ally 1', 'Underworld'],
            ['Opponent 1', 'Rebel'],
            ['Opponent 2', 'Empire']
          ]) {
            await board.getByRole('button', { name: new RegExp(`^${seat} faction:`) }).click();
            await board.locator('.op-command-stage input').fill(({Empire:'Emperor Palpatine',Rebel:'Mon Mothma',Underworld:'Tyber Zann'})[faction]+' Forces of Corruption');
            await board.locator(`[data-source="stock"][data-faction="${faction}"]`).click();
          }
          await board.getByRole('combobox', { name: 'Ally 1 difficulty' }).selectOption('easy');
          await board.getByRole('combobox', { name: 'Opponent 2 difficulty' }).selectOption('hard');
        }
        await board.evaluate(async (board, domain) => {
          board.querySelector('.op-go').addEventListener('click', () => {
            window.battleStart = performance.now();
            const observer = new MutationObserver(records => {
              if (!records.some(r => [...r.removedNodes].some(n => n.classList?.contains('battle-plate')))) return;
              window.playableAt = performance.now();
              observer.disconnect();
            });
            observer.observe(document.body, { childList:true });
          }, { once:true, capture:true });
          const land = domain === 'land';
          const proto = land ? (await import('/js/game/landgame.js')).LandGame.prototype : (await import('/js/game/render.js')).Renderer.prototype;
          const method = land ? 'frame' : 'render', original = proto[method];
          proto[method] = function (...args) {
            const live = land ? !this.warming && this === window.game : this === window.game?.renderer;
            const result = original.apply(this,args);
            if (live && !window.firstBattleDraw) {
              window.firstBattleDraw = { covered:!!document.querySelector('.battle-plate') };
              proto[method] = original;
            }
            return result;
          };
        },domain);
        await board.locator('.op-go').click();
        // Find the profile frame after the host consumes the launch navigation.
        const until = Date.now() + 120000;
        let result;
        while (!result && Date.now() < until) {
          const frame = page.frames().find(fr => fr.url().includes('play.html'));
          if (frame)
            result = await frame
              .evaluate(async () => {
                const g = window.game,
                  w = g?.world,
                  s = g?.setup;
                if (
                  !s?.planetBattle ||
                  !w ||
                  !g.map ||
                  !window.firstBattleDraw || !window.playableAt ||
                  document.querySelector('.battle-plate')
                )
                  return null;
                const { snapshot } = await import('/js/game/savegame.js');
                const snap = snapshot(g, 'test');
                const units =
                  s.mode === 'land'
                    ? s.players.map((_, i) => w.units.filter(u => u.side === i && !u.dead && !u.structure).length)
                    : s.players.map((_, i) => w.units.filter(u => u.player?.id === i && !u.dead).length);
                return {
                  coveredAtDraw: window.firstBattleDraw.covered,
                  startToPlayableMs: Math.round(window.playableAt - window.battleStart),
                  stages: window.loadLog.filter(([t]) => t >= window.battleStart - 0.5 && t <= window.playableAt + 0.5).map(([t, stage]) => [Math.round(t - window.battleStart), stage]),
                  teams: s.players.map(p => p.team),
                  skills: s.players.map(p => p.difficulty || ''),
                  factions: s.players.map((_, i) => (s.mode === 'land' ? w.factions[i] : w.players[i].factionName)),
                  savedFactions: snap.setup.players.map(p => p.skirmishFaction || snap.setup.teamFactions[p.team]),
                  allyBuilds: s.instant
                    ? []
                    : (s.mode === 'land'
                        ? w.units.filter(u => u.structure && w.ally(2, u.side)).flatMap(u => w.productionFor(u, 2))
                        : w.buildOptions(w.teams[0].station, w.players[2])
                      )
                        .filter(t => t.list('Affiliation').includes('Underworld'))
                        .map(t => t.name)
                        .slice(0, 4),
                  mode: s.mode,
                  planet: s.planetBattle.id,
                  map: s.mapFile,
                  units,
                  instant: !!s.instant,
                  family: snap.summary.family,
                  savePlanet: snap.setup.planetBattle,
                  ground: snap.setup.instant?.groundArmies,
                  bases: s.mode === 'land' ? w.sites.filter(x => x.base && x.structure).length : w.teams.filter(t => t.station).length
                };
              })
              .catch(e => {
                if (!/context was destroyed|detached|closed/.test(e.message)) throw e;
              });
          if (!result) await page.waitForTimeout(300);
        }
        if (process.env.LOAD_TIMINGS) console.log(JSON.stringify({mode, domain, ms:result?.startToPlayableMs, stages:result?.stages}));
        else console.log(mode, domain, result);
        assert.ok(result, 'battle did not start');
        assert(result.coveredAtDraw, 'briefing was removed before first live battlefield draw');
        assert(await page.locator('.battle-plate').isHidden() && !(await page.locator('#game').evaluate(e => e.inert)));
        assert.equal(result.mode, domain);
        assert.equal(result.planet, 'Abregado_Rae');
        assert.equal(result.family, mode);
        assert.equal(result.instant, mode === 'instant');
        assert.ok(result.units.every(n => n > 0));
        assert.equal(result.map, expected);
        assert.equal(result.savePlanet.id, result.planet);
        if (mode === 'skirmish') {
          assert.ok(result.bases >= 2);
          assert.deepEqual(result.teams, [0, 1, 0, 1]);
          assert.deepEqual(result.skills, ['', 'medium', 'easy', 'hard']);
          assert.deepEqual(result.factions, ['Empire', 'Rebel', 'Underworld', 'Empire']);
          assert.deepEqual(result.savedFactions, result.factions);
          assert(result.allyBuilds.length, 'ally station/base must offer its own units');
        }
        if (mode === 'instant' && domain === 'land') {
          assert.ok(result.ground.every(a => a.length));
          assert.equal(result.bases, 0);
        }
        await page.close();
      }
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
