// Check the visual policy through the served catalog, not an ID-only mock.
import assert from 'node:assert/strict';
const base = process.env.FRAME_URL || 'http://127.0.0.1:8591';
const { solo, unavailable } = await (await fetch(base + '/api/universal/atlas/operations')).json();
assert.deepEqual(unavailable, []);
const all = Object.entries(solo).flatMap(([p, s]) => Object.entries(s.commanders).map(([id, c]) => ({ p, id, c, m: s.emblems[id] })));
const unpaint = svg => svg.replace(/#[0-9a-f]{6}/gi, '#ink');
const faces = new Map(await Promise.all(all.filter(r=>r.m?.hd).map(async ({m})=>[m.hd,await (await fetch(base+m.hd)).text()])));
const native = (p, id) => solo[p].emblems[id],
  cw = '3387971722',
  rr = '3417277973',
  remake = '1770851727';
function shared(family, face, shape, only = () => true) {
  const rs = all.filter(r => r.c.family === family && only(r));
  assert(rs.length, family);
  for (const r of rs) {
    assert(r.m?.hd, `${r.p}/${r.id} missing ${family}`);
    assert.equal(unpaint(faces.get(r.m.hd)), unpaint(faces.get(face.hd)), family + ' shared stencil');
    if (shape.reference) assert.equal(r.m.reference, shape.reference);
    else assert.deepEqual(r.m.outline, shape.outline, family + ' body');
  }
  return rs.length;
}
for (const [family, ref] of Object.entries({
  'InterGalactic Banking Clan': 'banking',
  'Techno Union': 'techno',
  Confederacy: 'confederacy',
  'Rakatan Remnants': 'rakata',
  'Corporate Sector Authority': 'csa',
  'Hapes Consortium': 'hapes'
})) {
  const subset = r => ref !== 'hapes' || r.p !== rr,
    first = all.find(r => r.c.family === family && subset(r));
  assert.equal(first?.m?.reference, ref, family + ' must use supplied reference');
  shared(family, first.m, { reference: ref }, subset);
  assert.equal((await fetch(base + first.m.hd)).status, 200);
}
assert.equal(shared('Galactic Republic', native(cw, 'Empire'), native(cw, 'Empire')), 6);
for (const p of [rr, '1976399102']) assert.equal(solo[p].commanders.Sector_Forces.displayFaction, 'Republic-Aligned Sector Forces');
assert.equal(shared('Black Sun', native(cw, 'Underworld'), native(cw, 'Underworld')), 3);
// A single stencil may now have several HD faces: the ink is per seat.
const { profiles } = await (await fetch(base + '/api/universal/atlas')).json();
const empires = all.filter(
  r => r.c.family === 'Galactic Empire' || (r.p === '1125571106' && ['Zsinj_Empire', 'Imperial_Proteus'].includes(r.id))
);
assert.equal(empires.length, 6);
const huts = all.filter(r => r.c.family === 'Hutt Cartel');
assert.equal(huts.length, 7);
for (const r of [...empires, ...huts]) {
  const color = profiles.find(p => p.id === r.p).facts[r.id].color.toLowerCase();
  assert.equal(r.m.faceColor, color);
  const svg = await (await fetch(base + r.m.hd)).text();
  assert(svg.includes(`fill="${color}"`), r.p + '/' + r.id + ' wrong flat paint');
  if (empires.includes(r)) assert.equal(r.m.reference, 'imperial');
  else {
    assert.equal(r.m.faceProfile, remake);
    assert.deepEqual(r.m.outline, native(rr, 'Hutt_Cartels').outline);
  }
}
assert(!native('1125571106', 'Eriadu_Authority').reference && !native('1125571106', 'Greater_Maldrood').reference);
assert.equal(unpaint(faces.get(native(remake,'Mandalorians').hd)),unpaint(faces.get(native('1976399102','Mandalorians').hd)));
assert.notEqual(native(remake, 'Mandalorians').hd, native(rr, 'Underworld').hd);
assert(native(remake, 'Cartels').hd.includes('/' + remake + '/'));
assert.equal(native(remake, 'Cartels').outlineSource, 'P_ALLIED_HUTTS.TGA');
assert.equal(solo[remake].commanders.Hutts.family, 'Invaders');
// Point-in-evenodd shape: dark ink survives, pale carrier stays punched out.
function filled(mark, x, y) {
  const { body, w, h } = mark.outline;
  x = (x * 8192) / Math.max(w, h);
  y = (y * 8192) / Math.max(w, h);
  let inside = false;
  for (const a of body) {
    for (let k = 0, j = a.length - 2; k < a.length; j = k, k += 2) {
      const [ax, ay] = [a[k], a[k + 1]],
        [bx, by] = [a[j], a[j + 1]];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
  }
  return inside;
}
// Fractions of the winning source crop, not screen pixels. In each pair the
// second list must be actual through-holes rather than merely lower relief.
for (const [p, id, keep, cut] of [
  [
    '1125571106',
    'Pentastar',
    [
      [0.5, 0.5],
      [0.1, 0.5]
    ],
    [
      [0.235, 0.5],
      [0.15, 0.5]
    ]
  ],
  [
    '1125571106',
    'Corellia',
    [
      [0.5, 0.5],
      [0.5, 0.02]
    ],
    [
      [0.5, 0.175],
      [0.5, 0.095]
    ]
  ],
  [
    '1125571106',
    'EmpireoftheHand',
    [
      [0.5, 0.55],
      [0.44, 0.11]
    ],
    [
      [0.5, 0.08],
      [0.75, 0.5]
    ]
  ],
  [
    '1125571106',
    'SsiRuuvi_Imperium',
    [
      [0.5, 0.32],
      [0.28, 0.5]
    ],
    [
      [0.5, 0.5],
      [0.5, 0.025],
      [0.24, 0.25]
    ]
  ],
  [
    remake,
    'Sith',
    [
      [0.5, 0.5],
      [0.64, 0.13]
    ],
    [
      [0.2, 0.5],
      [0.8, 0.5]
    ]
  ]
]) {
  const m = native(p, id);
  assert(!m.master && !m.reference, id + ' projector must use the cutout');
  for (const [points, value] of [
    [keep, true],
    [cut, false]
  ])
    for (const [x, y] of points)
      assert.equal(filled(m, x * m.outline.w, y * m.outline.h), value, `${id} ${value ? 'missing ink' : 'filled hole'} at ${x},${y}`);
}
for (const [id, yes, no] of [
  [
    'Sith_Warlords',
    [
      [64, 64],
      [23, 62],
      [105, 62]
    ],
    [
      [64, 20],
      [35, 38]
    ]
  ],
  [
    'Rebel',
    [
      [64, 64],
      [45, 38],
      [6, 40]
    ],
    [
      [64, 20],
      [29, 52]
    ]
  ],
  [
    'Hapes_Consortium',
    [
      [64, 64],
      [65, 38]
    ],
    [
      [40, 45],
      [22, 42]
    ]
  ]
]) {
  const m = native(rr, id);
  assert(!m.reference && m.hd.includes('/' + rr + '/'));
  for (const [x, y] of yes) assert(filled(m, x, y), `${id}: missing device at ${x},${y}`);
  for (const [x, y] of no) assert(!filled(m, x, y), `${id}: projected neutral field at ${x},${y}`);
}
console.log(
  `${all.length} exact seats; shared and exceptional faction marks, mixed-source Hutts, both sector forces, and negative space OK`
);
