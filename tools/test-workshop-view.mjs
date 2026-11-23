import assert from 'node:assert/strict';
import { workshopPage } from './workshop-view.mjs';
import { steamTitles } from './workshop-titles.mjs';

const items = new Map(['10', '20', '30'].map(id => [id, { id, name: `Workshop ${id}` }]));
const cards = [
  { saved: true, name: 'Fleet', primary: '10', order: ['20', '10'], disabled: ['30'] },
  { saved: true, name: 'Variant', primary: '10', order: ['10'], disabled: [] }
];
const view = query => workshopPage({ game: true, items, cards, skipped: 0 }, new URL('http://127.0.0.1/' + query), null);
const rows = html => [...html.matchAll(/<li class="mod" data-id="(\d+)"/g)].map(m => m[1]);
assert.deepEqual(rows(view('')).sort(), ['10', '20', '30']);
assert.deepEqual(rows(view('?collection=0')), ['20', '10', '30']);
assert.match(view('?collection=0'), /class="state off">Off</);
assert.deepEqual(rows(view('?collection=1')), ['10']);
assert.equal((view('?collection=1').match(/class="tile" /g) || []).length, 2);
assert.match(view('?collection=1'), /class="tile" href="\/\?collection=1" aria-current="page"/);
assert.doesNotMatch(view('?collection=1'), /theme-control|class="brand"/);
assert.match(view('?collection=1'), /aria-label="Next collection: Fleet" href="\/\?collection=0"/);
items.get('10').theme = ['music', '10.mp3'];
assert.match(view('?collection=1'), /<audio [^>]*src="\/theme\/10" autoplay loop>/);
assert.doesNotMatch(view('?all=1'), /<audio/);
delete items.get('10').theme;
items.get('10').wordmark = ['art','10-wordmark.png'];
assert.match(view('?collection=1'), /<h1><img class="hero-mark" src="\/wordmark\/10" alt="Variant"><\/h1>/);
assert.match(view('?collection=1'), /class="tile-mark" src="\/wordmark\/10" alt="Fleet"/);
delete items.get('10').wordmark;
assert.match(view('?collection=1'), /aria-current="page"[^>]*>[^]*?Variant/);
assert.match(view('?collection=1'), /class="quick" method="post" action="\/play\/1"><button aria-label="Launch Variant"/);
assert.match(view('?collection=1'), /<details class="members"><summary aria-label="Show or hide members of Variant"/);
assert.match(view('?collection=1'), /<details class="order"><summary>Enabled mods/);
assert.deepEqual(rows(view('?all=1')).sort(), ['10','20','30']);
const busy = workshopPage({ game:true, items, cards }, new URL('http://127.0.0.1/?collection=1'), { n:0, url:'http://127.0.0.1:8378/play.html' });
assert.match(busy, /aria-label="Launch Variant" disabled/);
assert.match(busy, /aria-label="Open game Fleet"/);
assert.ok(busy.includes('href="http://127.0.0.1:8378/viewer.html">Model viewer</a>'));
assert.doesNotMatch(view(''), /viewer\.html/);
assert.deepEqual(rows(view('?q=20')), ['20']);
assert.doesNotMatch(view('?q=%3Cscript%3E'), /<script>/);
await steamTitles(items, async (url, options) => {
  assert.equal(options.method, 'POST');
  assert.equal(options.body.get('itemcount'), '3');
  return { ok: true, json: async () => ({response: {publishedfiledetails: [
    { result: 1, publishedfileid: '20', consumer_app_id: 32470, title: 'Addon <II>' },
    { result: 1, publishedfileid: '30', consumer_app_id: 1, title: 'Another game' }
  ]}}) };
});
assert.match(view('?q=addon'), /Addon &lt;II&gt;/);
assert.equal(items.get('30').name, 'Workshop 30');
console.log('All items, per-profile rank/off state, search and optional titles passed');
