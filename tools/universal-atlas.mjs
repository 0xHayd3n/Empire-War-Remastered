import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { openGame } from './megfs.mjs';
import { assertPrivateLibrary, loadPack } from './universal-library.mjs';
import { languageId } from '../public/js/language.js';
import { validValue } from '../public/js/game/universalrules.js';
const digest = s => createHash('sha256').update(s).digest('hex');
function stockStamp(game) {
  const v = openGame(game),
    stats = new Map(),
    h = createHash('sha256');
  try {
    for (const [k, e] of v.index) {
      if (!/^DATA\\(?:XML\\|TEXT\\|RESOURCES\\GUIDIALOG\\|ART\\(?:MODELS|TEXTURES)\\)/.test(k)) continue;
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
    const w = new Worker(new URL('./universal-atlas-worker.mjs', import.meta.url), { workerData: args, execArgv: [] });
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
export function atlasStore({ home, library, eras }) {
  assertPrivateLibrary(home, library);
  const directory = path.join(home, 'campaign-atlas-v1'),
    ticket = new Map(),
    sets = new Map(),
    allowedSheets = new Set();
  let stamp,
    queue = Promise.resolve();
  async function one(id, lang) {
    stamp ??= stockStamp(library.game);
    const rev = id === 'stock' ? 'stock' : JSON.parse(fs.readFileSync(path.join(home, 'profiles', id + '.json'))).revision;
    const filename = path.join(directory, `${id}-${lang}-${digest('planet-portraits-2:' + stamp + ':' + rev)}.gz`);
    try {
      const p = JSON.parse(gunzipSync(fs.readFileSync(filename)));
      if (p.sheets.every(s => /^[a-f0-9]{64}$/.test(s) && fs.existsSync(path.join(home, 'planet-portraits-v1', s + '.png')))) return p;
    } catch {}
    const p = await build({ game: library.game, home, folder: library.items.get(id)?.folder, id, language: lang });
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
            profiles.push({ ...(await one(e.id, lang)), name: e.name });
          } catch (err) {
            console.warn('Campaign atlas:', e.name, err.message);
            unavailable.push(e.id);
          }
        }
        if (!profiles.length) throw Error('No campaign catalogs available.');
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
  // One read-only art VFS for the last preview. No gameplay server, DOM, saves or campaign scripts are mounted.
  let art, artKey, idle;
  function closeArt() {
    art?.close();
    art = null;
    artKey = null;
    clearTimeout(idle);
  }
  function picture(id, revision, name) {
    if (!/^Data\/Art\/(?:Models\/.+\.alo|Textures\/.+\.(?:dds|tga)|Shaders\/.+\.fxo)$/i.test(name) || name.split(/[\\/]/).includes('..'))
      return null;
    if (artKey !== id + ':' + revision) {
      if (!eras().some(e => e.ready && e.id === id)) return null;
      const pack = id === 'stock' ? null : loadPack(home, id, library.items.get(id)?.folder);
      if ((pack?.revision || 'stock') !== revision) return null;
      closeArt();
      art = openGame(library.game, [], { packedLayer: pack?.entries });
      artKey = id + ':' + revision;
    }
    clearTimeout(idle);
    idle = setTimeout(closeArt, 60000);
    idle.unref();
    const key = art.resolve(name);
    return key ? art.read(key) : null;
  }
  return {
    get,
    picture,
    portrait(hash) {
      return /^[0-9a-f]{64}$/.test(hash) && allowedSheets.has(hash)
        ? fs.readFileSync(path.join(home, 'planet-portraits-v1', hash + '.png'))
        : null;
    },
    closeArt,
    async issue(q) {
      const a = (await get(q.language)).atlas,
        plan = launchPlan(a, q);
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
