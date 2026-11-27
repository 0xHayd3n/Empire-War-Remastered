import { db } from '../gamedata.js';

// Only the planet board can request adaptation of an authored campaign TED.
// Validate the reference again when restoring a solo save, against this mount.
export function authoredBattle(setup) {
  const p = setup.planetBattle;
  if (!p?.authored || !['land', 'space'].includes(setup.mode)) return false;
  const field = setup.mode === 'land' ? 'Land_Tactical_Map' : 'Space_Tactical_Map';
  const file = db.type(p.id)?.str(field).trim();
  return !!file && file.toUpperCase() === String(setup.mapFile).toUpperCase();
}

export function groundForces(faction) {
  return (db.faction(faction)?.list('Land_Skirmish_AI_Default_Forces') || []).filter(n => {
    const t = db.type(n);
    return t && (t.list('Company_Units').length || t.str('Land_Model_Name'));
  });
}

export function battleAnchor(map, i) {
  const name = i ? 'DEFENDING FORCES POSITION' : 'ATTACKER ENTRY POSITION';
  const at = map.objects.find(o => o.type.name.toUpperCase().replaceAll('_', ' ') === name);
  if (at) return at.pos;
  const lo = map.playMin || map.min,
    hi = map.playMax || map.max;
  return [lo[0] + (hi[0] - lo[0]) * (i ? 0.76 : 0.24), (lo[1] + hi[1]) / 2, 0];
}

// Planet maps use invasion markers, not multiplayer team markers. Add two
// standalone starting positions to the parsed instance, never to the source TED.
export function stagePlanetSkirmish(map, setup) {
  if (!authoredBattle(setup) || setup.instant) return;
  for (let i = 0; i < 2; i++) {
    const pos = battleAnchor(map, i),
      prefix = `Team_0${i}_`,
      land = setup.mode === 'land';
    const markers = land
      ? [
          ['Command Center', 0],
          ['Barracks', 150],
          ['Reinforcement_Point_Plus2_Cap', -150],
          ['Spawn_Point_Marker', -90]
        ]
      : [
          ['Space_Station', 0],
          ['Spawn_Point_Marker', 450]
        ];
    for (const [role, dx] of markers) {
      const type = db.type(prefix + role);
      if (!type || map.objects.some(o => o.type === type)) continue;
      const x = Math.max(map.playMin[0], Math.min(map.playMax[0], pos[0] + (i ? -dx : dx)));
      map.objects.push({ type, id: -1, owner: -1, pos: [x, pos[1], pos[2] || 0], rot: [0, 0, i ? 180 : 0], scale: 1 });
    }
  }
}

export function landInstantWinner(world) {
  const live = new Set(
    world.squads
      .filter(q => q.side >= 0 && q.side < world.playerSides && !q.structure && q.members.some(u => !u.dead))
      .map(q => world.team[q.side])
  );
  return live.size <= 1 ? ([...live][0] ?? -1) : undefined;
}
