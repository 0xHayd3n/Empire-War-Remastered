import assert from 'node:assert/strict';
import { battleDestination, campaignDestination, periodChoices, showMessage, showSplash, splashProgress, whileLoading } from '../public/js/splash.js';

import { battleBriefing } from '../public/js/game/battlebriefing.js';

const station = { tag:'Planet', name:'Port', str:k=>({Text_ID:'TEXT_PORT',Describe_History:'TEXT_HISTORY',Describe_Weather:'Storms',Describe_Tactical:'Hold the station.'})[k] };
const db = { type:k=>k?.toUpperCase()==='PORT' ? station : undefined, text:new Map([['TEXT_PORT','Port'],['TEXT_HISTORY','A shipbuilding world.']]) };
const site = {map:{planet:'Port Yards',textId:'TEXT_NONE'}, mapFile:'_MP_SPACE_PORT.TED'};
const copy = battleBriefing(db,site);
assert.equal(copy.title,'Port'); assert.equal(copy.site,'Port Yards');
assert.equal(copy.description,'A shipbuilding world.');
assert.equal(battleBriefing(db,{...site,map:{planet:'Another Site'}}).description,'');
assert.equal(battleBriefing(db,{map:{planet:'Port'},mapFile:'_MP_LAND_PORT.TED'}).description,copy.description);
for (const [history, expected] of [['TEXT_MISSING',''], ['none',''], ['   ',''], ['Cold moon.','Cold moon.']]) {
  const fixture = {...db,type:()=>({...station,str:k=>k==='Describe_History'?history:station.str(k)})};
  assert.equal(battleBriefing(fixture,site).description,expected);
}
const reused = { ...db, text: new Map([...db.text, ['TEXT_PLANET_OTHER_INFO_HIS','Unrelated world.'], ['TEXT_PLANET_PORT_INFO_HIS','Home of the shipyards.']]),
  type: key => key?.toUpperCase() === 'OTHER' ? {...station,name:'Other'} : {...station,str:k=>({Describe_History:'TEXT_PLANET_OTHER_INFO_HIS',Encyclopedia_Text:'TEXT_BONUS TEXT_PLANET_PORT_INFO_HIS'})[k] || station.str(k)} };
const corrected = battleBriefing(reused,{map:{planet:'Port',textId:'[RE]Frontline: North'}});
assert.equal(corrected.site,'Frontline: North');
assert.equal(corrected.description,'Home of the shipyards.');
assert.equal(battleBriefing(db,{map:{planet:'Port Repair Yards'},mapFile:'Arena_02.TED'}).planet,station);
assert.equal(battleBriefing(db,{map:{planet:'Unknown Repair Yards'},mapFile:'Arena_02.TED'}).planet,null);
assert.equal(battleBriefing(db,{...site,map:{},campaign:{planetType:'port'}}).description,copy.description);

// These checks do not need the game archives, a WebGL context, a timer or a running session.
const nodes = Object.fromEntries(['splash', 'briefTitle', 'briefSection', 'briefStage', 'briefMeter', 'loading', 'loadText'].map(id => {
  const classes = new Set();
  return [id, { dataset: {}, classList: { add: k => classes.add(k), remove: k => classes.delete(k), contains: k => classes.has(k) }, removeAttribute(k) { delete this[k]; } }];
}));
globalThis.document = { getElementById: id => nodes[id] };
const hidden = () => nodes.splash.classList.contains('hidden');
assert.deepEqual(campaignDestination('Example_Era_3', 'Frontier'), { kind: 'era', title: 'Frontier · Era 3' });
assert.deepEqual(campaignDestination('Map_7_BBY', 'Frontier at 7 BBY'), { kind: 'era', title: 'Frontier at 7 BBY' });
assert.equal(campaignDestination('Map_2', 'Frontier').kind, 'galaxy');
assert.equal(battleDestination({ mapFile: 'Maps\\Fleet_Station.TED' }), 'Fleet Station');
const choices = (...names) => names.map(name => ({ type: { name } }));
assert.equal(periodChoices(choices('Progressive_Start_2', 'Progressive_Start_3')), true);
assert.equal(periodChoices(choices('Hero_2', 'Era_3')), false);
assert.equal(periodChoices([]), false);
let release;
const older = whileLoading('conquest', 'Frontier', () => new Promise(resolve => { release = resolve; }));
const finish = showSplash('era', 'Era 3');
release();
await older;
assert.equal(hidden(), false);
assert.equal(nodes.briefTitle.textContent, 'Era 3');
splashProgress('Reading the map', 0.3);
assert.equal(nodes.briefMeter.value, 0.3);
splashProgress('Opening the command bar');
assert.equal(nodes.briefMeter.value, undefined);
finish();
assert.equal(hidden(), true);
await assert.rejects(whileLoading('save', '', () => { throw Error('unreadable'); }), /unreadable/);
assert.equal(hidden(), true);
showSplash('menu');
showMessage('No game data');
assert.equal(hidden(), true);
assert.equal(nodes.loading.classList.contains('hidden'), false);
assert.equal(nodes.loadText.textContent, 'No game data');
console.log('Briefings: destination labels, period choices, stale release, progress and error recovery OK');
