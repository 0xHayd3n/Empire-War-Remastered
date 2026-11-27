// Four armored sections per side. These are real unit types in a stock Instant
// battle; only this showcase starts with a damaged tank already burning out.
export function combinedArmies(varied = false) {
  if (varied) {
    // Keep one vehicle per section so the original spawn footprint still fits.
    const section = (vehicles, regular, special, leader) =>
      vehicles.flatMap((v, i) => [v, ...Array(6).fill(regular), special, special, special, i === 3 ? leader : regular]);
    return [
      section(['AT_ST_Walker', 'AT_AT_Walker', 'AT_ST_Walker', 'AT_AA_Walker'], 'Stormtrooper', 'Scout_Trooper', 'Darth_Vader'),
      section(['T4B_Tank', 'T2B_Tank', 'T2B_Tank', 'T4B_Tank'], 'Rebel_Trooper', 'Plex_Soldier', 'Han_Solo')
    ];
  }
  return [
    ['AT_ST_Walker', 'Stormtrooper'],
    ['T2B_Tank', 'Rebel_Trooper']
  ].map(([tank, foot]) => Array.from({ length: 4 }, () => [tank, ...Array(10).fill(foot)]).flat());
}
export function combinedStarts(world, starts) {
  const a = starts[0][0],
    b = starts[1][0],
    angle = Math.atan2(b.y - a.y, b.x - a.x),
    dx = Math.cos(angle),
    dy = Math.sin(angle),
    used = new Set();
  return [0, 1].map(side =>
    Array.from({ length: 44 }, (_, i) => {
      const lane = Math.floor(i / 11),
        slot = i % 11,
        sign = side ? 1 : -1;
      const across = (lane - 1.5) * 100 + (slot ? (((slot - 1) % 5) - 2) * 20 : 0);
      const along = side * 120 + (slot ? sign * (40 + Math.floor((slot - 1) / 5) * 24) : 0);
      const at = world.nearestOpen(a.x + along * dx - across * dy, a.y + along * dy + across * dx, slot ? 1 : 2, used) || starts[side][0];
      used.add(Math.round(at.y / 20) * world.n + Math.round(at.x / 20));
      return at;
    })
  );
}
