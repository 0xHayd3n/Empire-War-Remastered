import assert from 'node:assert/strict';
import { saveLivery } from '../public/js/game/liveries.js';
import { readyPaint, launchPaint, applySetupLiveries, liveriesForSides } from '../public/js/game/liverytransport.js';
const local = { pattern: 'split', colors: ['#ff0000', '#001122', '#334455', '#aa00ff'] };
const guest = { ...local, pattern: 'chevron' };
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
saveLivery('Empire', '', 'Host paint', local);
const s = { kind: 'human' };
readyPaint(s, { faction: 'Empire', on: true, livery: guest, peer: 0 }, 'Empire');
assert.deepEqual(launchPaint(s, 'Empire', false), guest);
assert.deepEqual(launchPaint(s, 'Empire', true), local);
assert.equal(launchPaint(s, 'Rebel', false), null);
assert.equal(launchPaint({ ...s, kind: 'medium' }, 'Empire', true), null);
readyPaint(s, { faction: 'Rebel', on: true, livery: guest }, 'Empire');
assert.equal(launchPaint(s, 'Empire', false), null, 'a ready message for the previous faction cannot repaint the new one');
readyPaint(s, { faction: 'Empire', on: true, livery: { colors: ['x'], pattern: 'split' } }, 'Empire');
assert.equal(s.livery, null);
const setup = {
  teamFactions: ['Empire'],
  players: [
    { human: true, team: 0 },
    { human: false, team: 0, livery: guest }
  ]
};
applySetupLiveries(setup);
assert.deepEqual(liveriesForSides(setup.players), [local, null]);
for (const network of [{ net: { me: 1 } }, { shooterNet: { me: 0 } }, { spectate: true }]) {
  const cfg = {
    ...network,
    teamFactions: ['Empire'],
    players: [
      { human: true, team: 0, livery: guest },
      { human: true, team: 0 },
      { human: false, team: 0, livery: guest }
    ]
  };
  applySetupLiveries(cfg);
  assert.deepEqual(
    liveriesForSides(cfg.players),
    [guest, null, null],
    'never consult local paint for a network seat (including stock) or bot'
  );
}
console.log('Livery transport: ready/start snapshot, faction changes, host/guest/AI/stock/observer isolation OK');
