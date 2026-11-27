// Read-only index of the mounted profile. Read the TED header, never parse a tactical world.
import { parentPort, workerData } from 'node:worker_threads';
import { openGame } from './megfs.mjs';
import { loadPack } from './universal-library.mjs';
import { commandImages } from './universal-card-images.mjs';
import { stageArt } from './skirmish-stage-art.mjs';
import { skirmishCommanders } from './skirmish-commanders.mjs';
import { skirmishEmblems } from './skirmish-emblems.mjs';
import { db, loadGameData } from '../public/js/gamedata.js';
import { loadCampaignData, startingGalaxy } from '../public/js/game/galaxy.js';
import { tacticalRosters } from './skirmish-rosters.mjs';
import { tacticalAuxiliaries } from './tactical-auxiliaries.mjs';
import { parseMapHeader } from '../public/js/ted.js';
const { home, folder, id, game, language } = workerData;
const pack = id === 'stock' ? null : loadPack(home, id, folder),
  v = openGame(game, [], { packedLayer: pack?.entries, language });
const text = (t, k) => db.text.get(t?.str(k).trim().toUpperCase()) || '';
const stem = s =>
  String(s || '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
try {
  globalThis.fetch = async input => {
    const u = new URL(String(input), 'http://local');
    if (u.pathname === '/api/find')
      return Response.json([...v.index.keys()].filter(k => new RegExp(u.searchParams.get('q'), 'i').test(k)).sort());
    const b = v.read(v.resolve(decodeURIComponent(u.pathname.replace(/^\/asset\//, ''))));
    return new Response(b, { status: b ? 200 : 404 });
  };
  await loadGameData(undefined, { language });
  const data = await loadCampaignData();
  const maps = new Map(),
    official = { land: new Map(), space: new Map() },
    sites = { land: new Map(), space: new Map() };
  for (const k of [...v.index.keys()].sort()) {
    const hit = /^DATA\\(ART\\MAPS|CUSTOMMAPS)\\([^\\]+\.TED)$/i.exec(k);
    if (!hit || maps.has(hit[2])) continue;
    const b = v.readPart(k, 0, 4096),
      h = b?.length >= 8 && parseMapHeader(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    if (!h || ![1, 2].includes(h.kind)) continue;
    const domain = h.kind === 1 ? 'land' : 'space',
      file = hit[2];
    const entry = {
      file,
      title:
        db.text.get(h.textId.trim().toUpperCase()) ||
        file
          .replace(/^_MP_(LAND|SPACE)_/i, '')
          .replace(/\.ted$/i, '')
          .replaceAll('_', ' '),
      domain
    };
    maps.set(file, entry);
    if (h.players < 2 || h.f3 < 0 || ![0, 1].includes(h.custom) || (hit[1] === 'CUSTOMMAPS' && !h.custom)) continue;
    const put = (map, k) => {
      if (!k) return;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(entry);
    };
    put(official[domain], stem(file.replace(/^_MP_(LAND|SPACE)_/i, '').replace(/\.ted$/i, '')));
    put(sites[domain], stem(h.planet));
  }
  const worlds = [];
  for (const t of db.types.values()) {
    if (t.tag.toLowerCase() !== 'planet' || t.bool('In_Background') || !t.behaviors().has('PLANET')) continue;
    const name = text(t, 'Text_ID') || t.name.replaceAll('_', ' '),
      row = { id: t.name, name, model: t.str('Galactic_Model_Name'), xyz: t.list('Galactic_Position').map(Number) };
    // Some overhauls implement their campaign-size/regime picker as PLANET
    // objects. They inherit real fallback TEDs; those do not make a battlefield.
    // Keep the record for story coordinates, but give it no tactical bindings.
    const selector = /^TEXT_LOADING_/i.test(t.str('Text_ID').trim());
    const utility =
      /(?:^|_)(?:dummy|placeholder)(?:_|$)/i.test(t.name) ||
      /^(?:Tutorial_Planet|Test_(?:Land|SFX|Space)|Mini_Galaxy_[NJ]\d+|InstantAction|BattleLand|Survivaland)$/i.test(t.name);
    if (selector || utility) {
      worlds.push(row);
      continue;
    }
    for (const domain of ['land', 'space']) {
      const ids = [stem(t.name), stem(name)];
      const mp = [...new Set([official[domain], sites[domain]].flatMap(index => ids.flatMap(k => index.get(k) || [])))];
      const ref = t.str(domain === 'land' ? 'Land_Tactical_Map' : 'Space_Tactical_Map').trim(),
        a = maps.get(ref.toUpperCase());
      const choices = mp.map(m => [m.file, m.title, false]);
      if (a?.domain === domain && !mp.includes(a)) choices.push([ref, `${name} · Planet battlefield`, true]);
      if (choices.length) {
        row[domain] = choices[0]; // Instant Battle retains its original field per world/domain.
        if (choices.length > 1) (row.variants ||= {})[domain] = choices.slice(1);
      }
    }
    worlds.push(row);
  }
  // The FoC native campaign button opens this explicit, usually unlisted entry.
  // Never enumerate internal mission stages merely because they contain story scripts.
  const native = [];
  const c = data.campaigns.get('FULL_STORY_CAMPAIGN_UNDERWORLD');
  if (
    c &&
    !c.bool('Tutorial') &&
    !c.bool('Is_Multiplayer') &&
    c.list('Locations').length &&
    db.faction(c.str('Starting_Active_Player'))?.bool('Is_Playable')
  ) {
    const g = startingGalaxy(data, c),
      nodes = g.planets.filter(p => !p.background);
    native.push({
      id: c.name,
      title: text(c, 'Text_ID') || c.name,
      description: text(c, 'Description_Text'),
      faction: g.active,
      credits: g.players.find(p => p.faction.toUpperCase() === g.active.toUpperCase())?.credits,
      worlds: nodes.map(p => [p.name, p.owner]),
      routes: g.routes
        .filter(r => !g.planets[r.a].background && !g.planets[r.b].background)
        .map(r => [g.planets[r.a].name, g.planets[r.b].name])
    });
  }
  const {kits,availability}=tacticalRosters(v, data.campaigns.values(), tacticalAuxiliaries(id,v));
  const skirmishFactions=Object.keys(availability);
  const image=commandImages(v);
  const directory=skirmishCommanders(image,id,skirmishFactions);
  stageArt(v,id,directory,db,image);
  parentPort.postMessage({worlds,native,kits,availability,skirmishFactions,emblems:skirmishEmblems(image,db,id,skirmishFactions),...directory});
} finally {
  v.close();
}
