import { activeLanguage } from '../language.js';
import { campaignLibrary } from './universalcampaign.js';
import { galaxyChart } from './universalgalaxychart.js';
import { battlefieldPlanet } from './battlefieldplanet.js';
import { planetArt } from './universalplanetart.js';
import { soloStories } from './solostories.js';

const cache = new Map();
export function soloLibrary(lang = activeLanguage) {
  if (!cache.has(lang))
    cache.set(
      lang,
      Promise.all([
        campaignLibrary(lang),
        fetch('/api/universal/atlas/operations?language=' + lang).then(r => {
          if (!r.ok) throw Error('Operation catalog unavailable');
          return r.json();
        })
      ])
        .then(([atlas, { solo, unavailable }]) => {
          const stories = [],
            fields = [],
            charts = [],
            profiles = [];
          for (const base of atlas.profiles) {
            const s = solo[base.id];
            if (!s) continue;
            const p = {
              ...base,
              planets: base.planets.slice(),
              maps: base.maps.slice(),
              skirmishFactions: s.skirmishFactions || [],
              availability: s.availability || {}, skirmishEmblems:s.emblems || {}, commanders:s.commanders || {}, portraits:s.portraits || {}
            };
            profiles.push(p);
            const index = new Map(p.planets.map((w, i) => [w[0].toUpperCase(), i]));
            // The existing portrait baker keys on the resolved model within this
            // pack. A battlefield-only world may share a model with a GC world.
            const modelKey = s =>
              String(s || '')
                .trim()
                .toLowerCase()
                .replace(/\.alo$/, '');
            const cells = new Map(base.planets.filter(w => w[5] && w[9]).map(w => [modelKey(w[5]), w[9]]));
            const worlds = [];
            for (const world of s.worlds) {
              const key = world.id.toUpperCase();
              if (!index.has(key)) {
                index.set(key, p.planets.length);
                p.planets.push([
                  world.id,
                  world.name,
                  ...[0, 1, 2].map(i => world.xyz[i] || 0),
                  world.model,
                  1,
                  0,
                  false,
                  cells.get(modelKey(world.model)) || null
                ]);
              }
              const i = index.get(key);
              if (world.land || world.space) worlds.push([i, '']);
              for (const domain of ['land', 'space'])
                if (world[domain]) {
                  const [file, title, authored] = world[domain];
                  fields.push({ p, i, world, domain, file, title, authored, art: planetArt(p, p.planets[i]) });
                }
            }
            const scenery = base.maps.find(m => m.scenery.length)?.scenery || [];
            for (const g of soloStories(p, s)) {
              for (const c of g.choices)
                if (c.native) {
                  const worlds = c.native.worlds.map(([id, o]) => [index.get(id.toUpperCase()), o]).filter(([i]) => i !== undefined);
                  const local = new Map(worlds.map(([i], j) => [p.planets[i][0].toUpperCase(), j]));
                  const routes = c.native.routes
                    .map(([a, b]) => [local.get(a.toUpperCase()), local.get(b.toUpperCase()), 0])
                    .filter(([a, b]) => a !== undefined && b !== undefined && p.looks.length);
                  c.map = p.maps.push({ worlds, routes, scenery }) - 1;
                }
              stories.push(g);
            }
            if (worlds.length) charts.push({ ...p, maps: [{ worlds, routes: [], scenery }] });
          }
          // The reviewed stage exhibit is final. Never replace an affiliated
          // figure with a second copy of a strategic namesake from another pack.
          for (const p of profiles) for (const c of Object.values(p.commanders)) {
            if (c.stage?.portrait) c.portrait = { ...c.stage.portrait, mod: c.stage.mod || p.name };
            else if (c.person) {
              const source = p.portraits[c.name] ? p : profiles.find(other => other.portraits[c.name]);
              if (source) c.portrait = { ...source.portraits[c.name], mod: source.name };
            }
          }
          return { stories, fields, profiles, charts, unavailable: [...atlas.unavailable, ...unavailable] };
        })
        .catch(e => {
          cache.delete(lang);
          throw e;
        })
    );
  return cache.get(lang);
}

// Stable identities let opening stills follow the exact installed catalog, including native stories.
export const storyProfiles = data => (data.storyProfiles ||= data.profiles.filter(p => p.maps.some(m => m.worlds.length)));
export const fieldProfiles = data => (data.fieldProfiles ||= [battlefieldChart(data)].filter(Boolean));

// Sort/index once for both tactical selectors. Resolve chart IDs before copying field rows.
export function battlefieldEntries(data) {
  fieldProfiles(data);
  return (data.entries ||= data.fields
    .flatMap(f => [f, ...(f.world.variants?.[f.domain] || []).map(([file, title, authored]) => ({ ...f, file, title, authored }))])
    .map(f => ({ ...f,
      key: [f.world.name, f.domain, f.p.name].join(' ').toLocaleLowerCase(),
      variantKey: JSON.stringify([f.p.id, f.domain, f.file.toUpperCase()]),
      listTitle: f.authored ? f.file.replace(/^_?(mod_)?(land|space)_(planet_)?/i, '').replace(/\.ted$/i, '').replaceAll('_', ' ') : f.title
    }))
    .sort((a,b) => a.world.name.localeCompare(b.world.name) || a.domain.localeCompare(b.domain) || a.p.name.localeCompare(b.p.name)));
}

// Compose a presentation-only map of distinct physical worlds. Each actionable
// card still owns its exact profile, world, domain and TED. No merged game DB.
export function battlefieldChart({ charts, fields }) {
  if (!charts.length) return null;
  const chart = galaxyChart(charts),
    byProfile = new Map(charts.map(p => [p.id, p])),
    planets = [],
    sheets = [],
    sheetIndex = new Map(),
    seen = new Map();
  for (const f of fields) {
    const id = (f.chartId = battlefieldPlanet(f.world.name)),
      w = chart.world(byProfile.get(f.p.id), f.i);
    // Both Awakening packs park the tutorial loader far outside the real chart.
    if (w.uncharted || (f.world.id === 'Tutorial_Planet' && Math.hypot(...f.world.xyz.slice(0, 2)) > 9000)) continue;
    // Prefer the ordinary planet over an authored scenario alias; take its
    // registered position from the reference chart when it has that planet.
    const score =
      Number(id.replace(/[\s_-]/g, '') === f.world.id.toLowerCase().replace(/[\s_-]/g, '')) * 2 + Number(f.p.id === chart.reference.id);
    const prior = seen.get(id);
    if (!prior || score > prior.score) seen.set(id, { score, w, f, art: f.art || prior?.art });
    else prior.art ||= f.art;
  }
  for (const [id, { w, f, art }] of seen) {
    const planet = w.placed.slice();
    planet[0] = id;
    planet[1] = f.world.name;
    planet[9] = null;
    if (art) {
      const [sheet, tile] = art;
      if (!sheetIndex.has(sheet)) {
        sheetIndex.set(sheet, sheets.length);
        sheets.push(sheet);
      }
      planet[9] = [sheetIndex.get(sheet), tile];
    }
    planets.push(planet);
  }
  const worlds = planets.map((_, i) => [i, '']),
    scenery = chart.sky.map(s => planets.push(s) - 1);
  return {
    ...chart.reference,
    overlay: { ...chart.reference.overlay, ring: null },
    planets,
    sheets,
    maps: [{ worlds, routes: [], scenery }]
  };
}
