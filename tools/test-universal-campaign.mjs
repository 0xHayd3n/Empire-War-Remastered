import assert from 'node:assert/strict';
import { db, ObjType } from '../public/js/gamedata.js';
import { campaignChoices, ruleChoices } from '../public/js/game/universalcampaign.js';
import { beginUniversalRules, restoreUniversalRules } from '../public/js/game/universalrules.js';
import { creditCap } from '../public/js/game/galacticeconomy.js';
import { changeController, stepPolitics } from '../public/js/game/galacticpolitics.js';
import { portableRules } from './universal-rule-catalog.mjs';
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
