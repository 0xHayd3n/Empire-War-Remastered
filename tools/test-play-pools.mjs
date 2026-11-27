import assert from 'node:assert/strict';
import test from 'node:test';
import { ballotSlate, playlistPool } from '../public/js/game/mappool.js';

// Retail metadata parsed read-only from the installed Data/maps.meg.
const HEADERS = {
  '_MP_SPACE_GEONOSIS.TED': { kind: 2, players: 2, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_KESSEL.TED': { kind: 2, players: 2, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_BESPIN.TED': { kind: 2, players: 2, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_KUAT.TED': { kind: 2, players: 4, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_CORUSCANT.TED': { kind: 2, players: 6, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_KASHYYYK.TED': { kind: 2, players: 6, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_THEMAW.TED': { kind: 2, players: 6, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_ENDOR.TED': { kind: 2, players: 2, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_POLUS.TED': { kind: 2, players: 2, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_HOTH.TED': { kind: 2, players: 8, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_YAVIN.TED': { kind: 2, players: 8, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_ALDERAAN.TED': { kind: 2, players: 6, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_FELUCIA.TED': { kind: 2, players: 6, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_NABOO.TED': { kind: 2, players: 4, f3: 0, custom: 0, tag: '' },
  '_MP_LAND_ALDERAAN.TED': { kind: 1, players: 2, f3: 0, custom: 0, tag: '' },
  '_MP_LAND_POLUS.TED': { kind: 1, players: 2, f3: 0, custom: 0, tag: '' },
  '_MP_LAND_SHOLA.TED': { kind: 1, players: 2, f3: 0, custom: 0, tag: '' },
  '_MP_LAND_RYLOTH.TED': { kind: 1, players: 3, f3: 0, custom: 0, tag: '' },
  '_MP_LAND_DATHOMIR.TED': { kind: 1, players: 4, f3: 0, custom: 0, tag: '' },
  '_MP_LAND_UTAPAU.TED': { kind: 1, players: 6, f3: 0, custom: 0, tag: '' },
  '_MP_LAND_BOTHAWUI.TED': { kind: 1, players: 2, f3: 0, custom: 0, tag: 'CONTROL' },
  '_MP_LAND_SALEUCAMI.TED': { kind: 1, players: 2, f3: 0, custom: 0, tag: 'CONTROL' },
  '_MP_LAND_FELUCIA.TED': { kind: 1, players: 3, f3: 0, custom: 0, tag: 'CONTROL' },
  '_MP_LAND_BESPIN.TED': { kind: 1, players: 4, f3: 0, custom: 0, tag: 'CONTROL' },
  '_MP_LAND_KAMINO.TED': { kind: 1, players: 4, f3: 0, custom: 0, tag: 'CONTROL' },
  '_MP_LAND_NABOO.TED': { kind: 1, players: 4, f3: 0, custom: 0, tag: 'CONTROL' },
  '_MP_LAND_TATOOINE.TED': { kind: 1, players: 4, f3: 0, custom: 0, tag: 'CONTROL' },
  '_MP_LAND_YAVIN.TED': { kind: 1, players: 4, f3: 0, custom: 0, tag: 'CONTROL' },
  '_MP_LAND_ENDOR.TED': { kind: 1, players: 6, f3: 0, custom: 0, tag: 'CONTROL' },
  '_MP_SPACE_ONE_PLAYER.TED': { kind: 2, players: 1, f3: 0, custom: 0, tag: '' },
  '_MP_SPACE_DISABLED.TED': { kind: 2, players: 4, f3: -1, custom: 0, tag: '' }
};

const SPACE = Object.keys(HEADERS).filter(n => n.startsWith('_MP_SPACE_'));
const LAND = Object.keys(HEADERS).filter(n => n.startsWith('_MP_LAND_'));
const header = name => HEADERS[name] || HEADERS[String(name).toUpperCase()] || null;

const EXPECTED = {
  'orbital-foundry': [
    '_MP_SPACE_GEONOSIS.TED',
    '_MP_SPACE_KESSEL.TED',
    '_MP_SPACE_BESPIN.TED',
    '_MP_SPACE_KUAT.TED',
    '_MP_SPACE_CORUSCANT.TED',
    '_MP_SPACE_KASHYYYK.TED',
    '_MP_SPACE_THEMAW.TED'
  ],
  beachhead: [
    '_MP_LAND_ALDERAAN.TED',
    '_MP_LAND_POLUS.TED',
    '_MP_LAND_SHOLA.TED',
    '_MP_LAND_RYLOTH.TED',
    '_MP_LAND_DATHOMIR.TED',
    '_MP_LAND_UTAPAU.TED'
  ],
  'last-flight': [
    '_MP_SPACE_ENDOR.TED',
    '_MP_SPACE_POLUS.TED',
    '_MP_SPACE_HOTH.TED',
    '_MP_SPACE_YAVIN.TED',
    '_MP_SPACE_ALDERAAN.TED',
    '_MP_SPACE_FELUCIA.TED',
    '_MP_SPACE_NABOO.TED'
  ],
  'signal-lock': [
    '_MP_LAND_BOTHAWUI.TED',
    '_MP_LAND_SALEUCAMI.TED',
    '_MP_LAND_FELUCIA.TED',
    '_MP_LAND_BESPIN.TED',
    '_MP_LAND_KAMINO.TED',
    '_MP_LAND_NABOO.TED',
    '_MP_LAND_TATOOINE.TED',
    '_MP_LAND_YAVIN.TED',
    '_MP_LAND_ENDOR.TED'
  ]
};

const full = variant => playlistPool(variant, { maps: SPACE, landMaps: LAND, mapHeader: header });

test('each mode has its own real stock rotation', () => {
  for (const [variant, expected] of Object.entries(EXPECTED)) {
    assert.deepEqual(full(variant), expected, variant);
    assert.ok(expected.length >= 6 && expected.length <= 9, variant + ' cap');
  }
  assert.notDeepEqual(full('orbital-foundry'), full('last-flight'));
  assert.notDeepEqual(full('beachhead'), full('signal-lock'));
});

test('returned maps are mounted, unique and eligible for the mode', () => {
  for (const variant of Object.keys(EXPECTED)) {
    const pool = full(variant);
    assert.equal(new Set(pool.map(n => n.toUpperCase())).size, pool.length, variant);
    for (const name of pool) {
      assert.ok(SPACE.includes(name) || LAND.includes(name), name + ' mounted');
      const h = header(name);
      assert.ok(h.players >= 2, name + ' players');
      assert.ok(h.kind === (variant === 'beachhead' || variant === 'signal-lock' ? 1 : 2), name + ' kind');
      if (variant === 'signal-lock') assert.match(h.tag, /CONTROL/, name);
    }
  }
});

test('mounted subset never invents missing stock names', () => {
  const pool = playlistPool('last-flight', {
    maps: ['_MP_SPACE_ENDOR.TED', '_MP_SPACE_POLUS.TED'],
    landMaps: LAND,
    mapHeader: header
  });
  assert.deepEqual(pool, ['_MP_SPACE_ENDOR.TED', '_MP_SPACE_POLUS.TED']);

  const orbital = playlistPool('orbital-foundry', {
    maps: ['_MP_SPACE_ENDOR.TED', '_MP_SPACE_KESSEL.TED'],
    mapHeader: header
  });
  assert.deepEqual(orbital, ['_MP_SPACE_KESSEL.TED', '_MP_SPACE_ENDOR.TED']);
  assert.ok(orbital.every(n => n === '_MP_SPACE_KESSEL.TED' || n === '_MP_SPACE_ENDOR.TED'));
});

test('Signal Lock requires CONTROL metadata while Beachhead stays off it', () => {
  const signal = full('signal-lock');
  assert.ok(!signal.includes('_MP_LAND_ALDERAAN.TED'));
  assert.ok(signal.includes('_MP_LAND_BOTHAWUI.TED'));
  assert.ok(signal.every(n => /CONTROL/.test(header(n).tag)));

  const beach = full('beachhead');
  assert.ok(!beach.includes('_MP_LAND_BOTHAWUI.TED'));
  assert.ok(beach.every(n => !/CONTROL/.test(header(n).tag)));
});

test('one-player and disabled maps are excluded', () => {
  const pool = full('orbital-foundry');
  assert.ok(!pool.includes('_MP_SPACE_ONE_PLAYER.TED'));
  assert.ok(!pool.includes('_MP_SPACE_DISABLED.TED'));
  const all = playlistPool('orbital-foundry', {
    maps: ['_MP_SPACE_ONE_PLAYER.TED', '_MP_SPACE_DISABLED.TED'],
    mapHeader: header
  });
  assert.deepEqual(all, []);
});

test('mod-supplied correct space maps fill the fallback pool', () => {
  const mods = Array.from({ length: 12 }, (_, i) => `MOD_SPACE_${i}.TED`);
  const modHeaders = { ...HEADERS };
  mods.forEach((name, i) => (modHeaders[name] = { kind: 2, players: i % 2 ? 2 : 3, f3: 0, custom: 1, tag: '' }));
  modHeaders['BAD_SPACE.TED'] = { kind: 1, players: 2, f3: 0, custom: 1, tag: '' };
  const lookup = name => modHeaders[name] || null;
  const pool = playlistPool('orbital-foundry', { maps: [...mods, 'BAD_SPACE.TED'], mapHeader: lookup });
  assert.equal(pool.length, 6, 'fills the stock minimum, not the cap');
  assert.ok(
    pool.every(n => n.startsWith('MOD_SPACE_')),
    'only eligible mod maps'
  );
  assert.ok(!pool.includes('BAD_SPACE.TED'));
  assert.ok(
    pool.every(n => modHeaders[n].players === 2),
    '2p maps first'
  );
});

test('mounted mods cannot dilute a complete stock rotation', () => {
  const mods = ['MOD_SPACE_X.TED', 'MOD_SPACE_Y.TED'];
  const lookup = name => HEADERS[name] || (mods.includes(name) ? { kind: 2, players: 2, f3: 0, custom: 1, tag: '' } : null);
  for (const variant of ['orbital-foundry', 'last-flight']) {
    const pool = playlistPool(variant, { maps: [...SPACE, ...mods], landMaps: LAND, mapHeader: lookup });
    assert.deepEqual(pool, EXPECTED[variant], variant + ' keeps stock');
  }
});

test('duplicates collapse, including case variants, preserving the mounted spelling', () => {
  const pool = playlistPool('last-flight', {
    maps: ['_MP_SPACE_ENDOR.TED', '_MP_SPACE_ENdor.TED', '_MP_SPACE_ENDOR.TED', '_MP_SPACE_POLUS.TED', '_MP_SPACE_POLUS.TED'],
    mapHeader: header
  });
  assert.deepEqual(pool, ['_MP_SPACE_ENDOR.TED', '_MP_SPACE_POLUS.TED']);
});

test('zero and one map inputs stay honest', () => {
  assert.deepEqual(playlistPool('orbital-foundry', { maps: [], landMaps: [], mapHeader: header }), []);
  assert.deepEqual(playlistPool('orbital-foundry', { mapHeader: header }), []);
  assert.deepEqual(playlistPool('orbital-foundry', null), []);
  assert.deepEqual(playlistPool('not-a-mode', { maps: SPACE, landMaps: LAND, mapHeader: header }), []);
  assert.deepEqual(playlistPool('orbital-foundry', { maps: ['_MP_SPACE_KESSEL.TED'], mapHeader: header }), ['_MP_SPACE_KESSEL.TED']);
  assert.deepEqual(playlistPool('orbital-foundry', { maps: ['_MP_SPACE_KESSEL.TED'] }), []);
});

test('ballot slates are deterministic, distinct and room-rotated', () => {
  const pool = EXPECTED['signal-lock'];
  assert.deepEqual(ballotSlate(pool, 'room-42'), ballotSlate(pool, 'room-42'));
  const slate = ballotSlate(pool, 'room-42');
  assert.equal(slate.length, 3);
  assert.equal(new Set(slate).size, 3);
  assert.ok(slate.every(n => pool.includes(n)));

  const seen = new Set();
  for (let i = 0; i < 25; i++) seen.add(JSON.stringify(ballotSlate(pool, 'lobby-' + i)));
  assert.ok(seen.size >= 3, 'different rooms rotate maps');

  assert.deepEqual(ballotSlate([], 'room'), []);
  assert.deepEqual(ballotSlate(['ONE.TED'], 'room'), ['ONE.TED']);
  assert.deepEqual(ballotSlate(['A.TED', 'a.TED', 'B.TED'], 'room').length, 2);
});

test('room order is a fair, reproducible tie-break for small pools', () => {
  const pool = ['A.TED', 'B.TED', 'C.TED'];
  const orders = new Set();
  for (let i = 0; i < 20; i++) orders.add(ballotSlate(pool, 'tie-' + i).join('>'));
  assert.ok(orders.size > 1, 'ordering varies by room');
  for (const order of orders) assert.equal(new Set(order.split('>')).size, 3);
});
