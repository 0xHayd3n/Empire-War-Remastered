import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { openGame } from './megfs.mjs';
import { rosterColor, rgbBytes } from '../public/js/game/commandgroups.js';
import { linkCommandHeraldry } from './command-heraldry.mjs';
import { linkCommandExhibits } from './command-exhibits.mjs';
import { assertPrivateLibrary, loadPack } from './universal-library.mjs';
import { languageId } from '../public/js/language.js';
import { thrawnRevision } from './universal-loader-table.mjs';
import { fallCustomRevision } from './universal-fall-layouts.mjs';
import { appearances, appearanceEligible, validPaint } from '../public/js/game/appearancechoices.js';
import { canonEligible, fractalEligible, envoyStart, equalFootingStart } from '../public/js/game/universaleligibility.js';
import { validValue, validLoss, rescueCampaign } from '../public/js/game/universalrules.js';
const digest = s => createHash('sha256').update(s).digest('hex');
function stockStamp(game, fieldsOnly = false) {
  const v = openGame(game),
    stats = new Map(),
    h = createHash('sha256');
  try {
    for (const [k, e] of v.index) {
      if (
        fieldsOnly
          ? !/^DATA\\(?:ART\\MAPS|CUSTOMMAPS)\\.+\.TED$/i.test(k)
          : !/^DATA\\(?:XML\\|TEXT\\|RESOURCES\\GUIDIALOG\\|ART\\(?:MODELS|TEXTURES)\\)/.test(k)
      )
        continue;
      const file = e.file || e.meg;
      if (!stats.has(file)) {
        const s = fs.statSync(file);
        stats.set(file, `${s.size}:${s.mtimeMs}`);
      }
      h.update(JSON.stringify([k, file, stats.get(file), e.off, e.size]));
    }
    return h.digest('hex');
  } finally {
    v.close();
  }
}
function build(args) {
  return new Promise((ok, no) => {
    const w = new Worker(
      new URL(
        args.solo ? './universal-solo-worker.mjs' : args.upgrade ? './universal-atlas-upgrade.mjs' : './universal-atlas-worker.mjs',
        import.meta.url
      ),
      {
        workerData: args,
        execArgv: []
      }
    );
    w.once('message', ok);
    w.once('error', no);
    w.once('exit', code => {
      if (code) no(Error('Atlas build failed'));
    });
  });
}
export function launchPlan(atlas, q) {
  const p = atlas.profiles.find(p => p.id === q.profile),
    r = p?.rows.find(r => r.id === q.row),
    v = r?.variants.find(v => v.id === q.target);
  if (!v || !['easy', 'medium', 'hard'].includes(q.difficulty)) throw Error('Invalid campaign selection.');
  const options = {};
  for (const k of ['treasury', 'politics'])
    if (q[k] != null) {
      if (!validValue(k, q[k]) || !atlas.profiles.some(p => p.donor?.values[k] === q[k])) throw Error('Unknown rule value.');
      if (q[k] !== p.defaults[k]) options[k] = q[k];
    }
  if (Object.hasOwn(q, 'payAsYouGo')) {
    if (
      r.scripted ||
      typeof p.payment?.native !== 'boolean' ||
      typeof q.payAsYouGo !== 'boolean' ||
      !atlas.profiles.some(x => x.payment?.declared && x.payment.native === q.payAsYouGo)
    )
      throw Error('Production payment unavailable.');
    if (q.payAsYouGo !== p.payment.native) options.payAsYouGo = q.payAsYouGo;
  }
  if (Object.hasOwn(q, 'transportLosses')) {
    const source = p.combat?.transport;
    if (
      r.scripted ||
      !source?.allowed.includes(v.id) ||
      !validLoss(q.transportLosses) ||
      !atlas.profiles.some(x => x.combat?.transport?.declared && x.combat.transport.native === q.transportLosses)
    )
      throw Error('Transport loss rule unavailable.');
    if (q.transportLosses !== source.native) options.transportLosses = q.transportLosses;
  }
  if (Object.hasOwn(q, 'heroRescue')) {
    if (
      q.heroRescue !== true ||
      q.expedition ||
      p.id !== 'stock' ||
      !p.combat?.rescue ||
      r.id !== rescueCampaign ||
      v.id !== rescueCampaign ||
      r.faction !== 'Rebel'
    )
      throw Error('Hero rescue unavailable.');
    options.heroRescue = true;
  }
  if (Object.hasOwn(q, 'recovery')) {
    if (q.recovery !== true || q.convoy || q.envoy || q.heroRescue || q.expedition || !equalFootingStart(p, r, v))
      throw Error('Derelict recovery unavailable.');
    options.recovery = true;
  }
  if (Object.hasOwn(q, 'convoy')) {
    if (q.convoy !== true || q.envoy || q.heroRescue || q.expedition || !equalFootingStart(p, r, v))
      throw Error('Freight charter unavailable.');
    options.convoy = true;
  }
  for (const key of ['mercenaries', 'fighterSupport'])
    if (Object.hasOwn(q, key)) {
      if (q[key] !== true || !equalFootingStart(p, r, v)) throw Error('Station services unavailable.');
      options[key] = true;
    }
  for (const [key, d] of Object.entries(appearances))
    if (Object.hasOwn(q, key)) {
      if (!appearanceEligible(d, p, r, v) || !validPaint(d, q[key])) throw Error('Starting appearance unavailable.');
      options[key] = q[key];
    }
  if (Object.hasOwn(q, 'flagship')) {
    if (q.flagship !== true || !equalFootingStart(p, r, v)) throw Error('Flagship commission unavailable.');
    options.flagship = true;
  }
  if (Object.hasOwn(q, 'fractal')) {
    if (q.fractal !== true || !fractalEligible(p, r, v)) throw Error('Native Fractalsponge order unavailable.');
    options.fractal = true;
  }
  if (Object.hasOwn(q, 'buildTime')) {
    if (
      r.scripted ||
      !p.buildTime ||
      ![1, 0.8].includes(q.buildTime) ||
      !atlas.profiles.some(x => x.buildTime?.declared && x.buildTime.native === q.buildTime)
    )
      throw Error('Construction time unavailable.');
    if (q.buildTime !== p.buildTime.native) options.buildTime = q.buildTime;
  }
  if (Object.hasOwn(q, 'canonUnits')) {
    if (q.canonUnits !== true || !canonEligible(p, r, v)) throw Error('Native Canon Units order unavailable.');
    options.canonUnits = true;
  }
  if (Object.hasOwn(q, 'envoy')) {
    if (q.envoy !== true || q.heroRescue || q.expedition || !envoyStart(p, r, v)) throw Error('Envoy mission unavailable.');
    options.envoy = true;
  }
  if (q.expedition) {
    if (!v.sites.length || p.id === '3417277973' || !atlas.profiles.some(p => p.donor?.hasSearch)) throw Error('Expedition unavailable.');
    options.expedition = true;
  }
  const setup = {
    mode: 'galactic',
    players: [],
    teamFactions: [],
    campaign: v.id,
    faction: r.faction,
    difficulty: q.difficulty,
    universalPath: 1,
    universalOptions: options
  };
  if (q.opening !== undefined) {
    if (!r.customOpening || !['learner', 'static', 'progressive'].includes(q.opening) || q.progressive !== undefined)
      throw Error('Custom opening unavailable.');
    if (q.opening !== 'static') setup.startingTechLevel = q.opening === 'learner' ? 5 : 4;
  }
  if (q.progressive != null) {
    if (typeof q.progressive !== 'boolean' || !r.eraProgression) throw Error('Era progression unavailable.');
    // The native FTGU popup sends reward parameter 4 for progressive, and no override for static.
    if (q.progressive) setup.startingTechLevel = 4;
  }
  if (q.settings && Object.keys(q.settings).length) {
    if (!r.limits.custom || !r.slots.length) throw Error('Starting conditions are fixed.');
    const st = { ...r.base, custom: true },
      l = r.limits,
      adj = p.facts[r.faction].adj;
    st.tech = Math.max(l.minTech - adj, Math.min(l.maxTech - adj, st.tech));
    st.maxTech = Math.max(st.tech, Math.min(l.maxTech - adj, st.maxTech));
    for (const [k, n] of Object.entries(q.settings)) {
      if (!r.slots.includes(k) || !Number.isSafeInteger(n)) throw Error('Invalid starting option.');
      if (
        k === 'credits'
          ? n < l.minCredits || n > l.maxCredits
          : k === 'autoResolve'
            ? ![0, 2].includes(n)
            : n + adj < l.minTech || n + adj > l.maxTech
      )
        throw Error('Starting option out of range.');
      st[k] = n;
    }
    st.maxTech = Math.max(st.maxTech, st.tech);
    setup.campaignSettings = st;
  }
  return { profile: p.id, revision: p.revision, setup };
}
// Without the parent install a lazy manifest (even with a warm preview atlas)
// is not playable. A fully materialized pack remains usable offline. Byte/hash
// verification still happens in readBytes before an asset is served.
export function completeOfflinePack(home, id) {
  const { entries } = loadPack(home, id);
  return [...entries.values()].every(e => !e || fs.statSync(e.file, { throwIfNoEntry: false })?.size === e.size);
}
export function atlasStore({ home, library, eras }) {
  assertPrivateLibrary(home, library);
  const directory = path.join(home, 'campaign-atlas-v1'),
    ticket = new Map(),
    sets = new Map(),
    allowedSheets = new Set();
  let stamp,
    queue = Promise.resolve();
  async function one(id, lang) {
    const folder = library.items.get(id)?.folder;
    if (id !== 'stock' && (!folder || !fs.existsSync(folder)) && !completeOfflinePack(home, id))
      throw Error('Local parent or a complete offline pack required.');
    stamp ??= stockStamp(library.game);
    const rev = id === 'stock' ? 'stock' : JSON.parse(fs.readFileSync(path.join(home, 'profiles', id + '.json'))).revision;
    // Only the two reviewed selector revisions gained maps. Warm profiles can
    // add rules and campaign eligibility without re-baking planetary art.
    const schema =
      id === '1125571106' && rev === thrawnRevision
        ? 'thrawn-custom-opening-1:'
        : id === '1976399102' && rev === fallCustomRevision
          ? 'fall-custom-layouts-1:'
          : 'planet-portraits-2:';
    const filename = path.join(directory, `${id}-${lang}-${digest(schema + stamp + ':' + rev)}.gz`);
    let cached;
    try {
      const p = JSON.parse(gunzipSync(fs.readFileSync(filename)));
      if (p.sheets.every(s => /^[a-f0-9]{64}$/.test(s) && fs.existsSync(path.join(home, 'planet-portraits-v1', s + '.png')))) cached = p;
    } catch {}
    if (cached && 'laneKit' in cached && 'payment' in cached && 'buildTime' in cached && 'combat' in cached && 'presence' in cached) return cached;
    const args = { game: library.game, home, folder: library.items.get(id)?.folder, id, language: lang };
    const p = cached
      ? {
          ...cached,
          ...(await build({ ...args, upgrade: true, facts: Object.fromEntries(Object.keys(cached.facts).map(f=>[f,true])), targets:cached.rows.flatMap(r=>r.variants.map(v=>v.id)), lanes: 'laneKit' in cached ? null : { looks: cached.looks, overlay: cached.overlay } }))
        }
      : await build(args);
    fs.mkdirSync(directory, { recursive: true });
    const tmp = filename + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(tmp, gzipSync(JSON.stringify(p)));
      fs.renameSync(tmp, filename);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    return p;
  }
  function get(lang) {
    lang = languageId(lang);
    if (lang === null) throw Error('Unsupported language.');
    if (!sets.has(lang)) {
      const job = queue.then(async () => {
        const profiles = [],
          unavailable = [];
        for (const e of eras()) {
          if (!e.ready) continue;
          try {
            const p = await one(e.id, lang);
            // Private indexes remain raw pack data. Colorize the served view,
            // including warm indexes; no art re-bake or Workshop change.
            for (const [id, fact] of Object.entries(p.facts)) {
              const color = rosterColor(p.id, id);
              if (color) Object.assign(fact, { color, ink: rgbBytes(color) });
            }
            profiles.push({ ...p, name: e.name });
          } catch (err) {
            console.warn('Campaign atlas:', e.name, err.message);
            unavailable.push(e.id);
          }
        }
        // An empty playable set can still describe the supported mods for discovery.
        for (const p of profiles) for (const s of p.sheets) allowedSheets.add(s);
        const atlas = { profiles, eras: eras(), unavailable, language: lang };
        return { atlas, bytes: gzipSync(JSON.stringify(atlas)) };
      });
      sets.set(lang, job);
      queue = job.catch(() => {});
      job.catch(() => sets.delete(lang));
    }
    return sets.get(lang);
  }
  // The tactical index is lazy and independent of the GC art cache. Browse all
  // ready packs without mounting a runtime or re-baking any portrait sheets.
  const soloJobs = new Map(), emblemFiles = new Map();
  let fieldStamp;
  function operations(language) {
    const lang = languageId(language);
    if (lang === null) throw Error('Unsupported language.');
    if (!soloJobs.has(lang)) {
      const job = get(lang).then(async ({ atlas }) => {
        fieldStamp ??= stockStamp(library.game, true);
        const solo = {},
          unavailable = [];
        for (const p of atlas.profiles) {
          const schema = p.id === '1976399102' ? 'solo-native-stature1' : 'solo-device-palette1';
          const file = path.join(directory, `${schema}-combat3-maneuver1-landaim2-${p.id}-${lang}-${digest(stamp + fieldStamp + p.revision)}.gz`);
          try {
            solo[p.id] = JSON.parse(gunzipSync(fs.readFileSync(file)));
            continue;
          } catch {}
          try {
            const row = await build({
              solo: true,
              game: library.game,
              home,
              id: p.id,
              folder: library.items.get(p.id)?.folder,
              language: lang
            });
            const tmp = file + '.' + randomUUID() + '.tmp';
            try {
              fs.writeFileSync(tmp, gzipSync(JSON.stringify(row)));
              fs.renameSync(tmp, file);
            } finally {
              fs.rmSync(tmp, { force: true });
            }
            solo[p.id] = row;
          } catch (e) {
            console.warn('Operation catalog:', p.name, e.message);
            unavailable.push(p.id);
          }
        }
        linkCommandExhibits(solo, atlas.profiles);
        linkCommandHeraldry(solo,atlas.profiles);
        const kits = new Map();
        for (const [id,row] of Object.entries(solo)) {
          kits.set(id,row.kits); delete row.kits;
          // The private revision-pinned pack cache holds the vectors. Publish
          // opaque content addresses, not full SVGs in battlefield discovery.
          for(const mark of Object.values(row.emblems || {})) if(mark.svg){
            const key=(mark.faceProfile || id)+'/'+digest(mark.svg); mark.hd='/api/universal/emblems/'+key+'.svg';
            if(!emblemFiles.has(key))emblemFiles.set(key,gzipSync(mark.svg));
            delete mark.svg;
          }
        }
        return { solo, kits, bytes: gzipSync(JSON.stringify({ solo, unavailable })) };
      });
      soloJobs.set(lang, job);
      job.catch(() => soloJobs.delete(lang));
    }
    return soloJobs.get(lang);
  }
  // One read-only art VFS for the last preview. No gameplay server, DOM, saves or campaign scripts are mounted.
  const arts = new Map();
  function drop(key){const entry=arts.get(key);if(entry){clearTimeout(entry.idle);entry.art.close();arts.delete(key);}}
  function closeArt(){for(const key of arts.keys())drop(key);}
  function picture(id, revision, name) {
    if (!/^Data\/Art\/(?:Models\/.+\.(?:alo|ala)|Textures\/.+\.(?:dds|tga)|Shaders\/.+\.fxo)$/i.test(name) || name.split(/[\\/]/).includes('..'))
      return null;
    const artKey=id+':'+revision;
    if (!arts.has(artKey)) {
      if (!eras().some(e => e.ready && e.id === id)) return null;
      const pack = id === 'stock' ? null : loadPack(home, id, library.items.get(id)?.folder);
      if ((pack?.revision || 'stock') !== revision) return null;
      if(arts.size>=8)drop(arts.keys().next().value);
      arts.set(artKey,{art:openGame(library.game, [], { packedLayer: pack?.entries })});
    }
    const entry=arts.get(artKey), art=entry.art;
    clearTimeout(entry.idle); entry.idle=setTimeout(()=>drop(artKey),60000); entry.idle.unref();
    const key = art.resolve(name);
    return key ? art.read(key) : null;
  }
  return {
    get,
    operations,
    emblem:key=>emblemFiles.get(key),
    async roster(id,revision,faction,domain,language){
      const p=(await get(language)).atlas.profiles.find(p=>p.id===id && p.revision===revision);
      if(!p || !['land','space'].includes(domain))return null;
      const kits=(await operations(language)).kits.get(id), kit=kits && Object.hasOwn(kits,faction) && kits[faction];
      const shade = rosterColor(id, faction);
      return kit?.[domain] ? { id, revision, faction, domain, label: kit.label, color: shade ? rgbBytes(shade).join(',') : kit.color, ...kit[domain] } : null;
    },
    picture,
    portrait(hash) {
      return /^[0-9a-f]{64}$/.test(hash) && allowedSheets.has(hash)
        ? fs.readFileSync(path.join(home, 'planet-portraits-v1', hash + '.png'))
        : null;
    },
    closeArt,
    async issue(q) {
      const a = (await get(q.language)).atlas;
      let plan;
      if (q.mode === 'story') {
        const { solo } = await operations(q.language),
          p = a.profiles.find(p => p.id === q.profile);
        const { soloStories } = await import('../public/js/game/solostories.js');
        const choice =
          p &&
          soloStories(p, solo[p.id])
            .flatMap(g => g.choices)
            .find(c => c.id === q.target && c.faction === q.faction && c.row === q.row && c.tech === q.tech);
        if (!choice || !['easy', 'medium', 'hard'].includes(q.difficulty)) throw Error('Story start unavailable.');
        plan = choice.native
          ? {
              profile: p.id,
              revision: p.revision,
              setup: {
                mode: 'galactic',
                campaign: choice.id,
                faction: choice.faction,
                difficulty: q.difficulty,
                players: [],
                teamFactions: []
              }
            }
          : launchPlan(a, {
              profile: p.id,
              row: choice.row,
              target: choice.id,
              difficulty: q.difficulty,
              settings: choice.tech == null ? {} : { tech: choice.tech }
            });
        plan.setup.menuFamily = 'story';
      } else plan = launchPlan(a, q);
      for (const [k, t] of ticket) if (Date.now() > t.expires) ticket.delete(k);
      if (ticket.size >= 64) throw Error('Too many pending starts.');
      const key = randomUUID();
      ticket.set(key, { ...plan, expires: Date.now() + 180000 });
      return { profile: plan.profile, ticket: key };
    },
    take(id, revision, key) {
      const p = ticket.get(key);
      if (!p || p.profile !== id || p.revision !== revision || p.expires < Date.now())
        throw Error('The campaign selection expired or the pack changed. Return to setup.');
      ticket.delete(key);
      return p.setup;
    }
  };
}
