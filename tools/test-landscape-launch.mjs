import assert from 'node:assert/strict';
import test from 'node:test';
import { landscapeBinding } from '../public/js/game/landscape-binding.js';
import probe from './remaster/first-battlefield.cjs';

function fixture(selected = true) {
  const status = { state: 'idle', active: false }, life = new AbortController();
  let finish, fail, loads = 0, discarded = 0;
  const tick = landscapeBinding({ status, signal: life.signal, enabled: () => selected,
    load() { loads++; return new Promise((resolve, reject) => { finish = resolve; fail = reject; }); },
    update(_, on) { status.active = on; }, discard() { discarded++; } });
  return { tick, status, life, finish: () => finish(), fail: e => fail(e), select: v => { selected = v; },
    get loads() { return loads; }, get discarded() { return discarded; } };
}

test('cold launch waits for the one shared load and applies it before returning', async () => {
  const f = fixture();
  let revealed = false;
  const launch = f.tick.prepare({}).then(() => { revealed = true; assert.equal(f.status.active, true); });
  f.tick({});
  await Promise.resolve();
  assert.equal(revealed, false);
  assert.equal(f.status.state, 'loading');
  f.finish(); await launch;
  f.select(false); f.tick({}); assert.equal(f.status.active, false);
  f.select(true); f.tick({}); assert.equal(f.status.active, true);
  assert.equal(f.loads, 1);
});
test('original launch skips donors, but can still enable them in play', async () => {
  const f = fixture(false);
  assert.equal(f.tick.prepare({}), undefined); f.tick({}); assert.equal(f.loads, 0);
  f.select(true); f.tick({}); const pending = f.tick.prepare({});
  f.finish(); await pending; assert.equal(f.status.active, true); assert.equal(f.loads, 1);
});
test('failed verification settles cold launch on stock and never retries mid-battle', async () => {
  const f = fixture(), pending = f.tick.prepare({});
  f.fail(Error('changed donor')); await pending; f.tick({});
  assert.deepEqual(f.status, { state: 'unavailable', active: false, reason: 'changed donor' });
  assert.equal(f.loads, 1); assert.equal(f.discarded, 1);
});
test('a late load cannot activate a disposed battle or overrule a newer selection', async () => {
  for (const abort of [false, true]) {
    const f = fixture(), pending = f.tick.prepare({});
    if (abort) f.life.abort(); else f.select(false);
    f.finish(); await pending; f.tick({}); assert.equal(f.status.active, false);
  }
});
test('acceptance requires the right draw, shader, donor bindings and tier at reveal', () => {
  const opts = { planet: 'utapau', mode: 'remaster', backend: 'webgl', width: 512 },
    draw = { draw: 2, map: '_MP_LAND_UTAPAU.TED', state: 'ready', active: true, shader: true, donors: true, backend: 'webgl', width: 512 };
  probe.checkReveal(draw, opts);
  for (const v of [null, { ...draw, state: 'loading' }, { ...draw, shader: false }, { ...draw, donors: false }, { ...draw, width: 2048 }])
    assert.throws(() => probe.checkReveal(v, opts), /first visible battlefield/);
});
