// Called by check-play-matchmaking.cjs --battles. Each operation gets fresh browser contexts and a new real relay room.
const assert = require('node:assert/strict');
module.exports = async ({ client, stock, listings, until, ids }) => {
  const cases = [
    ['last-flight', 'strike', 'instant', false],
    ['orbital-foundry', 'establish', 'space', true],
    ['beachhead', 'establish', 'land', true],
    ['signal-lock', 'strike', 'control', false]
  ];
  assert(
    ids.every(id => cases.some(row => row[0] === id)),
    'Unknown operation ID'
  );
  // Even in identical stock runtimes, different *space* variants cannot match.
  const x = await client('Picket'),
    y = await client('Surveyor');
  try {
    await Promise.all([x, y].map(c => c.open(stock)));
    await Promise.all([x.choose('social', 'orbital-foundry'), y.choose('ranked', 'orbital-foundry')]);
    await Promise.all([x.search(), y.search()]);
    await until(async () => {
      const rows = await listings();
      return rows.length === 2 && new Set(rows.map(r => r.mode)).size === 2 && new Set(rows.map(r => r.mod)).size === 2;
    });
    await Promise.all([x, y].map(c => c.page.getByText(/No compatible commander yet/).waitFor()));
    await Promise.all([x.cancel(), y.cancel()]);
    await until(async () => !(await listings()).length);
    await y.choose('social', 'last-flight');
    await Promise.all([x.search(), y.search()]);
    const tickets = await until(async () => {
      const rows = await listings();
      return rows.length === 2 && rows;
    });
    assert.deepEqual(tickets.map(r => r.map).sort(), ['last-flight', 'orbital-foundry']);
    assert.notEqual(tickets[0].mod, tickets[1].mod);
    await Promise.all([x, y].map(c => c.page.getByText(/No compatible commander yet/).waitFor()));
    await Promise.all([x.cancel(), y.cancel()]);
    await until(async () => !(await listings()).length);
  } finally {
    await x.close();
    await y.close();
  }
  for (const [id, intent, type, fog] of cases.filter(([id]) => !ids.length || ids.includes(id))) {
    const a = await client('Aurek'),
      b = await client('Besh');
    try {
      await Promise.all([a, b].map(c => c.open(stock)));
      const ladder = ['last-flight', 'signal-lock'].includes(id) ? 'ranked' : 'social';
      await Promise.all([a, b].map(c => c.choose(ladder, id)));
      const poolAudit = await a.page.evaluate(async variant => {
        const { loadMap, mapHeader } = await import('/js/ted.js'),
          result = [];
        for (const file of game.mapRotation(variant)) {
          const m = await loadMap(file);
          result.push({
            file: m.file,
            domain: m.terrain ? 'land' : 'space',
            slots: mapHeader(file).players,
            points: m.objects.filter(o => o.type?.bool('Control_Point_Domination_Condition_Relevant')).length
          });
        }
        return result;
      }, id);
      assert(poolAudit.length > 0);
      for (const m of poolAudit) {
        assert.equal(m.domain, ['beachhead', 'signal-lock'].includes(id) ? 'land' : 'space', m.file);
        assert(m.slots >= 2 && (id !== 'signal-lock' || m.points > 0), m.file + ' must support the operation');
      }
      console.log('Read mounted rotation:', id, poolAudit.length, 'battlefields');
      await a.search();
      await until(async () => (await listings()).some(r => r.map === id));
      await b.search();
      const rows = c => c.page.getByRole('button', { name: /^Vote for / });
      await Promise.all([a, b].map(c => rows(c).first().waitFor()));
      const slate = await rows(a).evaluateAll(bs => bs.map(b => b.dataset.map));
      assert(slate.length >= 1 && slate.length <= 3 && new Set(slate).size === slate.length);
      assert.deepEqual(await rows(b).evaluateAll(bs => bs.map(b => b.dataset.map)), slate);
      const choice = slate.length - 1,
        votedMap = slate[choice];
      await rows(a).first().click();
      await rows(a).nth(choice).click();
      await rows(b).nth(choice).click();
      for (const c of [a, b]) await rows(c).nth(choice).locator('.mm-votes').filter({ hasText: /^2$/ }).waitFor();
      if (process.env.SWR_FLIGHT_SHOTS && id === 'orbital-foundry') {
        const path = require('node:path');
        await a.page.screenshot({ path: path.join(process.env.SWR_FLIGHT_SHOTS, 'match-ballot.png') });
        await b.page.setViewportSize({ width: 375, height: 667 });
        assert(await b.page.locator('.title-menu').evaluate(e => e.scrollWidth <= innerWidth));
        await b.page.screenshot({ path: path.join(process.env.SWR_FLIGHT_SHOTS, 'match-vote-phone.png') });
        await b.page.setViewportSize({ width: 1280, height: 800 });
      }
      for (const c of [a, b]) {
        await c.page.locator(`.staging-rules[data-variant="${id}"]`).waitFor();
        const title = await c.page.evaluate(async file => (await import('/js/ted.js')).mapTitle(file), votedMap);
        assert.equal(await c.page.locator('.staging-selection').textContent(), `Voted map: ${title}`);
        await c
          .ctl('IDC_INTERNET_CHAT_LIST')
          .getByText(/joined the game/)
          .waitFor();
        assert.equal(await c.page.getByRole('button', { name: 'Invite friends' }).count(), 0);
      }
      await b.ctl('IDC_INTERNET_START_GAME_BUTTON').click();
      await a.page.waitForFunction(() => document.querySelector('[data-id="IDC_ACCEPT_PLAYER_1"]')?.style.background?.includes('gradient'));
      await a.ctl('IDC_INTERNET_START_GAME_BUTTON').click();
      const reports = await Promise.all(
        [a, b].map(async c => {
          await c.page.waitForFunction(id => window.game?.setup?.variant === id && game.lock?.tick >= 2 && !!game.world, id, {
            timeout: 180000
          });
          return c.page.evaluate(() => {
            const { setup: s, world: w } = game;
            return {
              peer: s.net.me,
              tick: game.lock.tick,
              id: s.variant,
              ladder: s.ladder,
              scoreHook: typeof s.net.rankedFinish === 'function',
              type: s.type,
              seed: s.seed,
              map: s.mapFile,
              fog: w.fowOn ?? w.fog,
              skirmish: w.skirmish,
              armies: s.instant?.armies,
              forces: game.instant && [...game.instant.fleets.values()].map(f => f.units.length),
              cap: w.players?.[0]?.popCapFixed,
              credits: w.credits?.slice(0, 2) || w.players?.filter(p => p.human).map(p => p.credits),
              control: w.landControl,
              points: w.points?.filter(p => p.type?.bool?.('Control_Point_Domination_Condition_Relevant')).length,
              bases: w.sites?.filter(x => x.base).length,
              built: w.sites?.filter(x => x.base && x.structure).length
            };
          });
        })
      );
      assert.notEqual(reports[0].peer, reports[1].peer);
      for (const r of reports) {
        assert.equal(r.seed, reports[0].seed);
        assert.equal(r.map, votedMap, 'the actual launched world must use the elected file');
        assert.equal(r.type, type);
        assert.equal(r.id, id);
        assert.equal(r.ladder, ladder);
        assert.equal(r.scoreHook, ladder === 'ranked');
        assert.equal(r.fog, fog);
        if (id === 'last-flight') {
          assert.equal(r.skirmish, false);
          assert.deepEqual(
            r.armies.map(a => a.length),
            [3, 3]
          );
          assert.deepEqual(r.armies, reports[0].armies);
          assert.deepEqual(r.forces, reports[0].forces);
          assert(r.forces.every(n => n >= 3));
        }
        if (id === 'orbital-foundry') {
          assert.equal(r.skirmish, true);
          assert.equal(r.cap, 18);
          assert(r.credits.length === 2 && r.credits.every(n => n >= 3500));
        }
        if (id === 'beachhead') {
          assert.equal(r.control, false);
          assert(r.bases > 0);
          assert.equal(r.built, 0);
        }
        if (id === 'signal-lock') {
          assert.equal(r.control, true);
          assert(r.points > 0);
          assert(r.built > 0);
        }
      }
      if (ladder === 'ranked') {
        // Shorten only the end condition in these disposable games. Use the native victory path,
        // not direct writes to the rating ledger. Both clients receive the same terminal fixture.
        await Promise.all(
          [a, b].map(c =>
            c.page.evaluate(id => {
              if (id === 'last-flight') {
                const rules = game.instant.rules;
                for (const u of [...game.world.units, ...game.world.squads]) if (u.player?.team?.id === 1) u.dead = true;
                rules.wait = 0;
                rules.step(1);
              } else {
                for (const p of game.world.points) if (p.type?.bool?.('Control_Point_Domination_Condition_Relevant')) p.side = 0;
                game.dominationCheck(0);
                game.dominationStep(600);
              }
            }, id)
          )
        );
        for (const c of [a, b]) {
          await c.page.waitForFunction(() => localStorage.getItem('swr.ranked.ledger.v1') !== null);
          const result = await c.page.evaluate(async id => {
            const { lobbyRecord } = await import('/js/game/matchrank.js');
            return lobbyRecord(game.setup.net.session.relay, id);
          }, id);
          assert.equal(result.played, 1);
          assert.equal(result.rating, c === a ? 1016 : 984);
        }
        console.log('PASS native terminal fixture updated opposite device records once:', id);
      } else for (const c of [a, b]) assert.equal(await c.page.evaluate(() => localStorage.getItem('swr.ranked.ledger.v1')), null);
      console.log('PASS actual two-client battle', JSON.stringify(reports));
    } catch (e) {
      for (const c of [a, b])
        console.error(
          'Client:',
          await c.page
            .evaluate(() => ({
              loading: document.querySelector('#loading')?.innerText,
              log: window.loadLog?.slice(-4),
              status: document.querySelector('.op-status')?.textContent,
              engine: window.game?.constructor?.name
            }))
            .catch(() => null)
        );
      throw e;
    } finally {
      await a.close();
      await b.close();
    }
  }
};
