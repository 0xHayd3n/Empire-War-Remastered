import assert from 'node:assert/strict';
import { launchPlan } from './universal-atlas.mjs';
import { constructionTime } from './universal-rule-catalog.mjs';
import { beginUniversalRules, restoreUniversalRules } from '../public/js/game/universalrules.js';
import { fractalStart, thrawnRevision, equalFooting } from '../public/js/game/universaleligibility.js';
const catalog = (xml, own = true) =>
    constructionTime({ resolve: () => 'K', read: () => Buffer.from(`<C>${xml}</C>`) }, { entries: new Map(own ? [['K', {}]] : []) }),
  tag = x => `<Production_Speed_Factor>${x}</Production_Speed_Factor>`;
assert.deepEqual(catalog(tag(1) + tag(0.8)), { native: 0.8, declared: true });
assert.deepEqual(catalog(tag(1), false), { native: 1, declared: false });
assert.deepEqual(catalog(''), { native: 1, declared: false });
assert.equal(catalog(tag(0)), null);
const profile = (id, faction, name, more) => ({
  id,
  defaults: {},
  rows: [{ id: name, faction, variants: [{ id: name, sites: [] }] }],
  ...more
});
const p = profile('stock', 'Rebel', equalFooting, { combat: { rescue: true }, buildTime: { native: 1, declared: true } }),
  donor = { id: 'donor', buildTime: { native: 0.8, declared: true } },
  launch = (p, opt, other = [donor]) =>
    launchPlan({ profiles: [p, ...other] }, { profile: p.id, row: p.rows[0].id, target: p.rows[0].id, difficulty: 'medium', ...opt }).setup
      .universalOptions;
assert.equal(launch(p, {})?.convoy, undefined);
assert(launch(p, { convoy: true }).convoy);
for (const q of [
  { convoy: 0 },
  { convoy: true, expedition: true },
  { convoy: true, envoy: true },
  { convoy: true, heroRescue: true },
  { buildTime: '0.8' },
  { buildTime: 0 }
])
  assert.throws(() => launch(p, q));
assert.equal(launch(p, { buildTime: 0.8 }).buildTime, 0.8);
assert.equal(launch(p, { buildTime: 1 })?.buildTime, undefined);
assert.throws(() => launch(p, { buildTime: 0.8 }, []));
p.rows[0].scripted = true;
assert.throws(() => launch(p, { buildTime: 0.8 }));
assert.throws(() => launch(p, { convoy: true }));
for (const f of ['Empire', 'Greater_Maldrood']) {
  const n = fractalStart(f),
    tr = profile('1125571106', f, n, { revision: thrawnRevision });
  assert(launch(tr, { fractal: true }).fractal);
  const g = { active: f, campaign: { name: n } };
  beginUniversalRules(g, { fractal: true });
  assert.deepEqual(restoreUniversalRules(g.universalRules), { fractal: { state: 'request' } });
  tr.revision = 'different';
  assert.throws(() => launch(tr, { fractal: true }));
}
assert.throws(() => launch(p, { fractal: true }));
assert.equal(restoreUniversalRules({ buildTime: -1 }), null);
assert.deepEqual(restoreUniversalRules({ buildTime: 0.8 }), { buildTime: 0.8 });
console.log('PASS: charter exclusivity, native roster factions/revisions and sourced construction time / unchanged defaults');
