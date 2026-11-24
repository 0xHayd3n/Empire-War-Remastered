import assert from 'node:assert/strict';
import { db, ObjType } from '../public/js/gamedata.js';
import { campaignChoices } from '../public/js/game/universalcampaign.js';
import { ruleChoices, rulePresets } from '../public/js/game/universalrulemenu.js';
import { beginUniversalRules, restoreUniversalRules } from '../public/js/game/universalrules.js';
import { creditCap } from '../public/js/game/galacticeconomy.js';
import { changeController, stepPolitics } from '../public/js/game/galacticpolitics.js';
import { payAsYouGo } from '../public/js/game/galacticproduction.js';
import { fallCustomLayouts, fallCustomRevision } from './universal-fall-layouts.mjs';
import { portableRules, productionPayment } from './universal-rule-catalog.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const type = (name, props = {}) => {
  const t = new ObjType('test', name);
  for (const [k, v] of Object.entries(props)) t.props.set(k.toLowerCase(), [String(v)]);
  return t;
};
db.constants = type('constants', { Credit_Cap_Per_Planet: 45, Political_Control_Change_Time_Seconds: 7 });
db.factions.set('BLUE', type('Blue', { Is_Playable: 'Yes' }));
const camp = (name, props) => type(name, { Locations: 'Home, Target', Campaign_Set: 'SameSet', Starting_Active_Player: 'Blue', ...props });
const camps = [
  camp('A'),
  camp('B'),
  camp('C', { Is_Multiplayer: 'Yes' }),
  camp('D', { Tutorial: 'Yes' }),
  camp('E', { Is_Listed: 'No' }),
  camp('F', { Starting_Active_Player: 'Ghost' })
];
assert.deepEqual(
  campaignChoices(new Map(camps.map(c => [c.name, c])), n => db.faction(n)).map(c => c.name),
  ['A', 'B']
);
assert.deepEqual(
  ruleChoices(
    [
      { name: 'One', values: { treasury: 95 } },
      { name: 'Two', values: { treasury: 95 } },
      { name: 'Three', values: { treasury: 45 } },
      { name: 'Bad', values: { treasury: -5 } }
    ],
    'treasury',
    45
  ),
  [[95, ['One', 'Two']]]
);
assert.deepEqual(
  rulePresets(
    [
      { name: 'Base', values: { treasury: 45, politics: 7 } },
      { name: 'A', values: { treasury: 45, politics: 90 } },
      { name: 'B', values: { treasury: 45, politics: 90 } },
      { name: 'Incomplete', values: { treasury: 66 } }
    ],
    { treasury: 45, politics: 7 }
  ).map(p => [p.label, p.options]),
  [['A / B', { politics: 90 }]]
);
const loader = camp('Sandbox_CustomLoader_Republic', {
  Locations: 'Menu',
  Starting_Active_Player: 'Empire',
  Underworld_Story_Name: 'Conquests/Custom/Story_Plots_Sandbox_Loader_Custom.xml'
});
const layouts = new Map(
  ['', '_Small', '_Medium', '_Large', '_Influencers'].map(s => {
    const family = 'Sandbox_Custom' + s,
      target = camp(family + '_Empire', {
        Is_Listed: 'No',
        Starting_Active_Player: 'Empire',
        Campaign_Set: family,
        Underworld_Story_Name: 'Conquests/Custom/Story_Plots_Sandbox_Custom_Container.xml'
      });
    return [target.name.toUpperCase(), target];
  })
);
const direct = (rev = fallCustomRevision) => fallCustomLayouts('1976399102', rev, loader, layouts);
assert.deepEqual(
  direct().map(x => x.c.name.toUpperCase()),
  [...layouts.keys()]
);
assert.deepEqual(direct('updated'), []);
const small = layouts.get('SANDBOX_CUSTOM_SMALL_EMPIRE');
small.props.set('starting_active_player', ['Rebel']);
assert.deepEqual(direct(), []);
small.props.set('starting_active_player', ['Empire']);
layouts.delete('SANDBOX_CUSTOM_LARGE_EMPIRE');
assert.deepEqual(direct(), []);
const pay = (raw, owned) =>
  productionPayment(
    { resolve: () => 'K', read: () => Buffer.from(`<GameConstants>${raw}</GameConstants>`) },
    { entries: new Map(owned ? [['K', {}]] : []) }
  );
const tag = v => `<Pay_As_You_Go>${v}</Pay_As_You_Go>`;
assert.deepEqual(pay(tag('true') + tag('No'), true), { native: false, declared: true });
assert.deepEqual(pay(tag('1'), false), { native: true, declared: false });
assert.deepEqual(pay('', true), { native: true, declared: false });
assert.equal(pay(tag('maybe'), true), null);
const upfront = { active: 'Blue' };
beginUniversalRules(upfront, { payAsYouGo: false });
assert.deepEqual(restoreUniversalRules(upfront.universalRules), { payAsYouGo: false });
assert.equal(payAsYouGo(upfront, 'Blue'), false);
assert.equal(payAsYouGo({ active: 'Blue' }, 'Blue'), true);
assert.equal(restoreUniversalRules({ payAsYouGo: 0 }), null);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-rules-'));
try {
  const file = path.join(tmp, 'test.xml');
  fs.writeFileSync(
    file,
    '<GameConstants><Credit_Cap_Per_Planet>12000</Credit_Cap_Per_Planet><Political_Control_Change_Time_Seconds>NaN</Political_Control_Change_Time_Seconds><Other>90000</Other></GameConstants>'
  );
  const entries = new Map([
    ['DATA\\XML\\GAMECONSTANTS.XML', { ensure() {}, file, size: fs.statSync(file).size }],
    ['X\\GOVERNMENTSTARFORGESEARCH.LUA', {}]
  ]);
  assert.deepEqual(portableRules({ entries, mounted: { workshop: '3417277973' } }), { values: { treasury: 12000 }, hasSearch: true });
  entries.set('X\\GOVERNMENTSTARFORGESEARCH.LUA', null);
  assert(!portableRules({ entries, mounted: { workshop: '3417277973' } }).hasSearch);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const gal = () => ({
  active: 'Blue',
  players: [{ faction: 'Blue', credits: 0 }],
  planets: ['Blue', 'Ally', 'Red', 'Red', 'Red', 'Red'].map((owner, index) => ({
    index,
    name: 'P' + index,
    type: type('P' + index),
    owner,
    selectable: true
  })),
  links: [[{ to: 1 }, { to: 2 }, { to: 3 }], [{ to: 0 }], [{ to: 4 }], [], [], []],
  time: 2
});
const g = gal(),
  base = gal();
beginUniversalRules(base, {});
assert(!Object.hasOwn(base, 'universalRules'));
assert.equal(creditCap(base, 'Blue'), 45);
beginUniversalRules(g, { expedition: true, treasury: 130000, politics: 160 }, ['Ally']);
assert.deepEqual(g.universalRules.expedition.sites, ['P2', 'P3', 'P4']);
assert.equal(creditCap(g, 'Blue'), 130000);
for (const world of [g, base]) {
  const p = world.planets[0];
  p.politicalChecked = 2;
  p.politicalTarget = 1;
  p.politicalValue = 0;
  p.politicalRate = 1;
  stepPolitics({ ...world, planets: [p] }, 1);
  assert.equal(p.politicalValue, 1 / (world === base ? 7 : 160));
}
changeController(g.planets[2], 'Blue', g);
changeController(g.planets[2], 'Red', g);
changeController(g.planets[2], 'Blue', g);
assert.deepEqual(g.universalRules.expedition.found, ['P2']);
assert.equal(g.players[0].credits, 0);
const restored = restoreUniversalRules(JSON.parse(JSON.stringify(g.universalRules)));
assert.notEqual(restored.expedition.found, g.universalRules.expedition.found);
g.universalRules = restored;
changeController(g.planets[3], 'Blue', g);
changeController(g.planets[4], 'Blue', g);
assert.equal(g.players[0].credits, 3000);
changeController(g.planets[4], 'Red', g);
changeController(g.planets[4], 'Blue', g);
assert.equal(g.players[0].credits, 3000);
assert.equal(
  restoreUniversalRules({ politics: Infinity, treasury: '123', expedition: { owner: 'Blue', sites: ['P2', 'P2'], found: [] } }),
  null
);
console.log(
  'PASS: exact single-player rows, local donor values, campaign-only rules, default economy and politics, targets, recapture and once-only grant across restore'
);
