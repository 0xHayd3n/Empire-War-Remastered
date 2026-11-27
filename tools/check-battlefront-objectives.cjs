// Called after the mounted solo skirmish board launches Kuat in check-universal-battlefront-rules.cjs.
const assert = require('node:assert/strict');
exports.checkObjectives = async frame => {
  const result = await frame.evaluate(async () => {
    const s = game.shooter,
      w = game.world,
      me = s.me;
    const { preferredRules } = await import('/js/game/battlefrontrules.js');
    const { db } = await import('/js/gamedata.js');
    const soldier = db.type('Imperial_Stormtrooper') || db.type('Stormtrooper');
    const post = w.points.find(p => p.reinforce && !p.locked && !p.ground?.structure);
    if (!post) throw Error('Kuat has no unlocked command post');
    // Two isolated groups of actual infantry for the deployment board's leader picker.
    s.spawning = true;
    try {
      for (const dx of [-700, 700]) await w.spawn(soldier.name, post.x + dx, post.y, 0, me);
    } finally {
      s.spawning = false;
    }
    s.organize();
    const teams = s.teams.filter(t => t.side === me && !t.lead.dead && !t.lead.inside);
    if (teams.length < 2) throw Error('Need two friendly squads to exercise the cap: ' + teams.length);
    for (const t of teams) {
      const st = s.bots.get(t.lead);
      if (st) st.until = w.time - 1;
      t.lead.lastHit = w.time - 13;
    }
    const options = s.spawnSpots(),
      spots = options.filter(p => p.squad);
    const leader = spots[0].squad.lead;
    s.openDeploy();
    s.setCfg('shuttle', false);
    s.chooseClass(s.cards().find(c => !c.vehicle && !c.hero && !c.heroSpawn && c.unit));
    s.chooseSpawn(spots[0]);
    leader.lastHit = w.time - 11;
    // Submit before the next HUD refresh: the deploy action itself must drop the now-unsafe selection.
    await s.submitDeploy();
    const unavailable = !s.spawnSpots().some(p => p.squad?.lead === leader) && s.from !== spots[0];
    leader.lastHit = w.time - 12;
    const back = s.spawnSpots().find(p => p.squad?.lead === leader);
    if (!back) throw Error('Squad did not return after twelve seconds');
    s.chooseSpawn(back);
    const selected = s.from === back && s.state !== 'alive';
    const destination = { x: back.x, y: back.y };
    await s.submitDeploy();
    const deployed = s.state === 'alive' && Math.hypot(s.body.x - destination.x, s.body.y - destination.y) < 200;
    const fixed = options.filter(p => !p.squad).length;
    // Set up an enemy-held point with a single friendly attacker. Let the native pointLead,
    // updatePoints, ownership and capture callbacks run; don't replace those handlers or map time.
    const before = w.time,
      authored = post.seconds;
    w.time = Math.max(w.time, db.constants.num('Land_Capture_Allowed_Countdown_Seconds', 0));
    for (const u of w.units) {
      if (u.captures && Math.hypot(u.x - post.x, u.y - post.y) <= post.radius) u.x += post.radius * 3;
    }
    leader.x = post.x;
    leader.y = post.y;
    const foe = w.team.findIndex(k => k !== w.team[me]);
    Object.assign(post, { side: foe, taker: -1, progress: 0 });
    const tick = seconds => {
      w.updatePoints(seconds);
      return post.progress;
    };
    const first = tick(authored);
    // Break off the attack: the half-neutralized post falls back to a quarter-neutralized post.
    leader.x += post.radius * 3;
    const unwind = tick(authored / 2);
    leader.x = post.x;
    tick(authored * 1.5);
    const neutral = post.side;
    const second = tick(authored / 4);
    tick(authored / 4);
    const captured = post.side === me && s.points().includes(post);
    w.time = before;
    const prefs = preferredRules();
    return {
      first,
      unwind,
      neutral,
      second,
      captured,
      unchanged: post.seconds === authored,
      fixed,
      squads: spots.length,
      unavailable,
      selected,
      deployed,
      profile: [prefs.squadSpawnMax, prefs.postCaptureTime]
    };
  });
  const { fixed, ...seen } = result;
  assert(fixed > 0, 'ordinary posts and home remain available');
  assert.deepEqual(seen, {
    first: 0.5,
    unwind: 0.25,
    neutral: -1,
    second: 0.5,
    captured: true,
    unchanged: true,
    squads: 1,
    unavailable: true,
    selected: true,
    deployed: true,
    profile: [2, 1.5]
  });
  console.log(
    'PASS: live Kuat post neutralized and changed hands on separate clocks; deployment board rejected a recently hit leader and allowed the squad again after 12 s.'
  );
};
