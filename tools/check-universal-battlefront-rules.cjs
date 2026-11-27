// Launch through the mounted Universal host in an isolated profile, then exercise the running match rules.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const shuttles = process.argv.includes('--shuttles');
const { checkObjectives } = require('./check-battlefront-objectives.cjs');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.setDefaultTimeout(45000);
    await p.goto(process.env.BASE_URL || 'http://127.0.0.1:8590/');
    const f = p.frameLocator('#game'),
      s = f.getByRole('dialog', { name: 'Settings', exact: true });
    await f.getByRole('button', { name: 'System menu' }).click();
    await f.getByRole('button', { name: 'Settings', exact: true }).click();
    await s.getByRole('tab', { name: 'Gameplay', exact: true }).click();
    const inf = 'Tickets lost per infantry casualty',
      veh = 'Tickets lost per vehicle casualty',
      hero = 'Points per hero deployment',
      regen = 'Infantry healing away from friendly posts and bases';
    await s.getByLabel(inf).selectOption('3');
    await s.getByRole('button', { name: 'Restore standard skirmish rules' }).click();
    assert.equal(await s.getByLabel(inf).inputValue(), '1');
    for (const [k, v] of [
      [inf, 2],
      [veh, 3],
      [hero, 1000],
      [regen, 0],
      ['Player redeployment delay', 8],
      ['Bot reinforcement delay', 1.5],
      ['Ticket drain for holding a majority', 10],
      ['Time to neutralize a command post', 2],
      ['Time to capture a command post', 1.5],
      ['Squad deployment points', 2],
      ['Squad deployment wait after leader is hit', 12]
    ])
      await s.getByLabel(k).selectOption(String(v));
    if (shuttles) {
      await s.getByLabel('First shuttle wave delay').selectOption('10');
      await s.getByLabel('Time between shuttle waves').selectOption('20');
      await s.getByLabel('Infantry per shuttle').selectOption('6');
      await s.getByLabel('First shuttle wave delay').focus();
    } else
      await s.getByLabel('Time to neutralize a command post').evaluate(el => {
        el.focus();
        el.scrollIntoView({ block: 'center' });
      });
    assert(await s.evaluate(e => e.scrollWidth <= e.clientWidth));
    if (process.env.SWR_RULE_PHONE) await p.screenshot({ path: process.env.SWR_RULE_PHONE });
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    await p.setViewportSize({ width: 1280, height: 800 });
    for (const id of ['TITLE_PLAY', 'IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', 'IDC_SKIRMISH_GAMES_BUTTON'])
      await f.locator(`.title-menu [data-id="${id}"]`).click();
    const board = f.locator('.op-setup');
    await board.getByRole('searchbox').fill('Kuat Forces of Corruption land');
    await board.locator('[data-world="Kuat"][data-domain="land"][data-source="stock"]').first().click();
    await board.getByRole('tab', { name: 'Settings', exact: true }).click();
    const enable = board.getByLabel('Play this match in Battlefront mode');
    await enable.check();
    assert.match(await board.getByLabel(inf).locator('option:checked').textContent(), /Use default · 2/);
    await board.getByLabel(inf).selectOption('3');
    await board.getByRole('button', { name: 'Use my defaults for this match' }).click();
    assert.equal(await board.getByLabel(inf).inputValue(), '');
    await board.getByLabel(veh).selectOption('5');
    await board.getByLabel(hero).selectOption('500');
    await enable.uncheck();
    assert(!(await board.getByLabel(veh).isVisible()));
    await enable.check();
    assert.equal(await board.getByLabel(veh).inputValue(), '5');
    await board.getByLabel('Time to capture a command post').selectOption('0.5');
    await board.getByLabel('Squad deployment points').selectOption(shuttles ? '0' : '1');
    if (shuttles) {
      assert.match(await board.getByLabel('Infantry per shuttle').locator('option:checked').textContent(), /Use default · 6/);
      await board.getByLabel('Infantry per shuttle').selectOption('4');
      await board.getByLabel('Time between shuttle waves').focus();
      // Observe the first real wave clock at creation, before map/asset loading can advance it.
      await board.evaluate(async () => {
        const { ShuttleWaves } = await import('/js/game/shuttle.js');
        const clock = ShuttleWaves.prototype.clock;
        ShuttleWaves.prototype.clock = function () {
          const now = this.sh.world.time;
          clock.call(this);
          window.firstDelays = this.next.map(t => t - now);
          ShuttleWaves.prototype.clock = clock;
        };
      });
    } else await board.getByLabel('Squad deployment points').focus();
    if (process.env.SWR_RULE_BOARD) await p.screenshot({ path: process.env.SWR_RULE_BOARD });
    await board.locator('.op-go').click();
    const frame = p.frames().find(x => x.parentFrame() === p.mainFrame());
    await frame.waitForFunction(
      () => window.game?.shooter?.hooked && game.world.units.length && !document.querySelector('.battle-plate'),
      null,
      { timeout: 150000 }
    );
    if (shuttles) {
      assert(!(await frame.evaluate(() => game.shooter.spawnSpots().some(p => p.squad))));
      await checkShuttle(frame);
      assert.deepEqual(errors, []);
      console.log('PASS: mounted Kuat matched the first and repeat wave clocks, four-seat boarding screen, and overflow transports.');
      return;
    }
    await checkObjectives(frame);
    const seen = await frame.evaluate(async () => {
      const { preferredRules } = await import('/js/game/battlefrontrules.js');
      const g = game,
        w = g.world,
        s = g.shooter,
        me = s.me;
      const t = s.spawnSpots()[0] || w.units.find(u => u.side === me && !u.dead),
        x = t.x,
        y = t.y;
      let troop, car;
      s.spawning = true;
      try {
        const { db } = await import('/js/gamedata.js');
        const soldier = db.type('Imperial_Stormtrooper') || db.type('Stormtrooper');
        troop = (await w.spawn(soldier.name, x, y, 0, me)).members[0];
        car = (await w.spawn('T2B_Tank', x + 60, y, 0, me)).members[0];
      } finally {
        s.spawning = false;
      }
      s.possess(troop.squad, troop, false);
      const initial = s.heroAt;
      const beforeHP = troop.maxHealth / 2;
      troop.health = beforeHP;
      troop.lastHit = w.time - 6;
      const startX = troop.x,
        startY = troop.y;
      troop.x += 100000;
      troop.y += 100000;
      s.regen();
      const away = troop.health;
      const home = s.home(me) || w.points.find(p => p.reinforce && p.side === me);
      troop.x = home.x;
      troop.y = home.y;
      s.regen();
      const healed = troop.health > away;
      troop.x = startX;
      troop.y = startY;
      const pay = u => {
        const a = s.tickets[me];
        u.invulnUntil = 0;
        w.hurt(u, 1e9, null);
        return a - s.tickets[me];
      };
      const vehicleCost = pay(car),
        footCost = pay(troop);
      s.tick(0);
      const cooldown = s.readyAt - s.deadAt;
      const foe = w.team.findIndex(k => k !== w.team[me]);
      for (const p of w.points) {
        p.side = me;
        p.locked = false;
      }
      const ownDelay = s.respawnDelay(me),
        catchUp = s.respawnDelay(foe),
        bank = s.tickets[foe];
      s.bleedAt = w.time;
      s.tick(0);
      const drain = bank - s.tickets[foe],
        next = s.bleedAt - w.time;
      s.tick(0);
      const twice = bank - s.tickets[foe];
      // Check the original death ticket is not charged again by a later update.
      const own = s.tickets[me];
      w.hurt(troop, 1e9, null);
      const repeated = own - s.tickets[me];
      s.matchScore = 750;
      s.heroUsed();
      return {
        initial,
        cooldown,
        vehicleCost,
        footCost,
        away: away === beforeHP,
        healed,
        ownDelay,
        catchUp,
        drain,
        next,
        twice,
        repeated,
        nextHero: s.heroAt,
        profile: [preferredRules().vehicleCost, preferredRules().heroPoints],
        mode: !!globalThis.shooterMode
      };
    });
    const { cooldown, next, ...observed } = seen;
    assert(Math.abs(cooldown - 8) < 1e-8 && Math.abs(next - 10) < 1e-8, JSON.stringify({ cooldown, next }));
    assert.deepEqual(observed, {
      initial: 500,
      vehicleCost: 5,
      footCost: 2,
      away: true,
      healed: true,
      ownDelay: 15,
      catchUp: 6,
      drain: 1,
      twice: 1,
      repeated: 0,
      nextHero: 1250,
      profile: [3, 1000],
      mode: false
    });
    assert.deepEqual(errors, []);
    console.log(
      'PASS: mounted board used profile defaults and one-match rules; actual casualties, majority drain, player/bot delays, hero threshold and infantry healing matched the choices.'
    );
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});

async function checkShuttle(frame) {
  const delays = await frame.evaluate(() => window.firstDelays);
  assert(delays.length >= 2 && delays.every(t => Math.abs(t - 10) < 1e-6), JSON.stringify(delays));
  await frame.waitForFunction(
    () => {
      const s = game.shooter;
      return s.waves.launchIn(s.me) >= 5 && s.from && s.cards().some(c => !c.vehicle && !c.hero && !c.heroSpawn && c.unit);
    },
    null,
    { timeout: 120000 }
  );
  const start = await frame.evaluate(async () => {
    const s = game.shooter,
      W = s.waves,
      side = s.me,
      now = s.world.time;
    const c = s.cards().find(c => !c.vehicle && !c.hero && !c.heroSpawn && c.unit);
    s.chooseClass(c);
    await s.submitDeploy();
    if (!W.room?.F) throw Error('Did not board a shuttle at the selected post');
    const F = W.room.F,
      extras = [];
    // Fill the cabin with the deployed class and ensure at least one more infantry transport is needed.
    for (let i = 0; i < 7; i++) extras.push(W.add({ side, who: 'bot', unit: c.unit, company: c.company }));
    window.boardingCheck = { F, extras };
    return { next: W.next[side], now, aboard: F.load.length };
  });
  assert(start.next > start.now && start.aboard === 4);
  await frame.waitForFunction(() => /TROOPS 4 \/ 4/.test(game.shooter.waves.room?.bay?.screenKey), null, { timeout: 90000 });
  await frame.waitForFunction(() => boardingCheck.F.launched, null, { timeout: 120000 });
  const result = await frame.evaluate(async () => {
    const W = game.shooter.waves,
      { F, extras } = boardingCheck,
      flights = [...W.flights.values()].filter(f => f.load.some(e => extras.includes(e)));
    const { preferredRules } = await import('/js/game/battlefrontrules.js');
    return {
      next: W.next[F.side],
      left: W.launchIn(F.side),
      profile: preferredRules().shuttleSeats,
      flights: flights.length,
      sizes: flights.map(f => f.load.length),
      delivered: flights.flatMap(f => f.load).filter(e => extras.includes(e)).length
    };
  });
  assert(Math.abs(result.next - start.next - 20) < 1e-6 && result.left <= 20 && result.left > 0, JSON.stringify(result));
  assert(result.profile === 6 && result.flights >= 2 && result.sizes.every(n => n <= 4) && result.delivered === 7, JSON.stringify(result));
}
