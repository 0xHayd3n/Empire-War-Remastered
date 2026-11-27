// Creator workflow. No runtime registration, Steam writes, subscriptions, or persistent settings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { readLibrary } from './workshop-library.mjs';
import {
  scope,
  installedScopes,
  openScope,
  intakeCache,
  catalog,
  resolver,
  referencePairs,
  survey,
  makeQueue,
  fingerprint
} from './remaster/survey.mjs';
import { learn, annotate } from './remaster/decisions.mjs';
import { recordDirection, requireDirection, directionPath } from './remaster/direction.mjs';
const planetFor = (j, a) => a.planet || (/^YAVIN$/i.test(j.planet) ? 'Yavin 4' : j.planet);
async function referenceBoard(j, a, home) {
  const planet = planetFor(j, a);
  if (!planet) throw Error('Unknown planet: supply --planet, not a guessed biome');
  if(!a.refresh && fs.existsSync(directionPath(j))){const d=requireDirection(j);if(d.planet.toLowerCase()===planet.toLowerCase()&&d.views.every(v=>v.subject)){const board=(await import('./remaster/place-board.mjs')).placeBoard(d,home);if(board){console.log('Inspected place references (hash-verified, no network):',board);return {paths:{board},source:'same-job-inspected-photos'};}}}
  const { collectReferences } = await import('./remaster/references.mjs');
  const placeSlugs=a.places?.split(',').map(x=>x.trim());
  const r = await collectReferences(j, planet, path.join(home, 'references'),{placeSlugs});
  const report = path.join(home, 'references', 'by-job', j.id + '.json');
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, JSON.stringify(r, null, 2) + '\n');
  console.log('Inspect images:', r.paths.board, '\nReport:', report);
  return r;
}
import { fileURLToPath } from 'node:url';
import { groundFamily, families } from '../public/js/game/endor-landscape.js';
const HELP = `Map remaster workbench (from the Universal checkout)
  node tools/map-remaster.mjs catalog [--scope all|foc|eaw|ID[,ID...]]
  node tools/map-remaster.mjs plan --scope foc --match TATOOINE [--limit 12]
  node tools/map-remaster.mjs plan --scope all --match _MP_LAND_     (group shared material work across mounts)
  node tools/map-remaster.mjs prep --job <id> [--world <board search>] [--places location-slug,location-slug] (one fresh stock battle + private research packet)
  node tools/map-remaster.mjs references --job <id> [--planet "Yavin 4"] [--refresh --places location-slug,location-slug] (reopen verified places or search new location candidates)
  node tools/map-remaster.mjs donors --job <id> --query "worn compact forest earth" (official Poly Haven 2K candidates; inspect, never auto-approve)
  node tools/map-remaster.mjs verify --job <id> [--workers 1|2] [--packet <prep/packet.json>] (registered checkers; fresh matrix, not visual approval)
  node tools/map-remaster.mjs fit --job <id> --report <composed mounted report> (references beside matched release views)
  node tools/map-remaster.mjs brief --job <id> --report <reference report> --review <inspected direction.json>
  node tools/map-remaster.mjs capture --job <64-hex id> [--world <board search>] [--backend webgl|webgpu]
  node tools/map-remaster.mjs trial --job <id> --slot <TED index> --donor <library family> [--world ...] [--backend ...]
  node tools/map-remaster.mjs batch --plan <plan.json> [--limit 3] [--backend webgpu|webgl] (sample highest-reach surfaces)
  node tools/map-remaster.mjs learn --report <mounted report.json> --decision candidate|avoid --note "What the shots establish"
Scopes: comma-separated installed Workshop IDs, first wins. 'all' scans both stock editions, installed primaries and enabled saved orders; no permutation guessing. Scan reads installed files; capture checks the actual mounted winners.
Catalog includes space/mission/custom maps; plans target land. Limit is per scope; omitted = all matches. Jobs, queues and private captures: OS temp/universal-map-remaster-v1. Nothing is published.`;
const opts = {
  plan: { type: 'string' },
  packet: {type:'string'}, workers:{type:'string'},
  planet: { type: 'string' },
  refresh: {type:'boolean'}, places:{type:'string'},
  review: { type: 'string' },
  query: { type: 'string' },
  report: { type: 'string' },
  decision: { type: 'string' },
  note: { type: 'string' },
  scope: { type: 'string', default: 'foc' },
  match: { type: 'string', default: '' },
  limit: { type: 'string' },
  job: { type: 'string' },
  world: { type: 'string' },
  backend: { type: 'string', default: 'webgpu' },
  slot: { type: 'string' },
  donor: { type: 'string' },
  help: { type: 'boolean' }
};
async function main() {
  const { values: a, positionals: p } = parseArgs({ options: opts, allowPositionals: true });
  const cmd = p[0];
  if (!cmd || a.help) {
    console.log(HELP);
    return;
  }
  if (!['catalog', 'plan', 'prep', 'verify', 'references', 'brief', 'donors', 'fit', 'capture', 'trial', 'batch', 'learn'].includes(cmd) || p.length !== 1)
    throw Error(HELP);
  const home = path.join(os.tmpdir(), 'universal-map-remaster-v1'),
    made = new Set(),
    json = (file, data) => {
      const f = path.join(home, file),
        dir = path.dirname(f),
        text = JSON.stringify(data, null, 2) + '\n';
      if (!made.has(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        made.add(dir);
      }
      const tmp = f + '.' + randomUUID();
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, f);
    };
  const reviewed = fileURLToPath(new URL('./remaster/materials/', import.meta.url));
  const pins = [
    ...JSON.parse(fs.readFileSync(new URL('../public/art/endor-terrain/materials.json', import.meta.url))),
    JSON.parse(fs.readFileSync(new URL('../public/art/endor-terrain/paving.json', import.meta.url)))
  ];
  if (cmd === 'learn') {
    const r = JSON.parse(fs.readFileSync(a.report, 'utf8'));
    if (!/^[0-9a-f]{64}$/.test(r.job)) throw Error('Invalid job');
    const j = JSON.parse(fs.readFileSync(path.join(home, 'jobs', r.job + '.json'))),
      n = learn(j, r, a.decision, a.note);
    if (a.decision === 'candidate') requireDirection(j);
    if (!pins.some(p => fingerprint(p) === fingerprint(n.donor))) throw Error('Donor has changed since the trial');
    fs.mkdirSync(reviewed, { recursive: true });
    const file = path.join(reviewed, fingerprint(n) + '.json');
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(n, null, 2) + '\n', { flag: 'wx' });
    console.log('Recorded a material review, not a published map:', file);
    return;
  }
  const notes = fs.existsSync(reviewed)
    ? fs
        .readdirSync(reviewed)
        .filter(n => n.endsWith('.json'))
        .map(n => JSON.parse(fs.readFileSync(path.join(reviewed, n))))
    : [];
  if (cmd === 'batch') {
    const p = JSON.parse(fs.readFileSync(a.plan, 'utf8')),
      limit = Number(a.limit ?? 3);
    if (!Array.isArray(p.queue) || !Number.isSafeInteger(limit) || limit < 1 || !['webgpu', 'webgl'].includes(a.backend))
      throw Error('Give a plan, positive limit and valid backend');
    const results = [],
      seen = new Set(),
      { capture } = await import('./remaster/capture.cjs'),
      { prepare } = await import('./remaster/prep.mjs');
    for (const r of p.queue) {
      if (results.length >= limit) break;
      for (const id of r.jobs || [r.sample]) {
        if (seen.has(id) || !/^[a-f0-9]{64}$/.test(id)) continue;
        const job = JSON.parse(fs.readFileSync(path.join(home, 'jobs', id + '.json')));
        if (job.id !== id || fingerprint(job.identity) !== id) throw Error('Stale batch job');
        if (job.identity.order.length > 1 || !job.headerEligible) continue;
        const s = job.slots.filter(s => s.pair === r.pair && s.vertices && !s.hole).sort((a, b) => b.vertices - a.vertices)[0];
        if (!s) continue;
        seen.add(id);
        try {
          const scout=await prepare(job,home,()=>capture(job,{backend:a.backend,trial:null,focus:s.index,inventory:true},home),()=>referenceBoard(job,a,home));
          results.push({
            id,
            pair: r.pair,
            state: 'baseline-only',
            evidence:scout.stock,
            referenceBoard:scout.references,
            workPacket:scout.board,
            direction: fs.existsSync(directionPath(job)) ? 'reviewed' : 'needs-inspection'
          });
        } catch (e) {
          results.push({ id, pair: r.pair, state: 'blocked', reason: e.message });
        }
        break;
      }
    }
    const file = 'batch-' + randomUUID() + '.json';
    json(file, { backend: a.backend, results });
    console.log(path.join(home, file));
    if (!results.length || results.some(r => r.state === 'blocked')) process.exitCode = 1;
    return;
  }
  if (['prep', 'verify', 'references', 'brief', 'donors', 'fit', 'capture', 'trial'].includes(cmd)) {
    if (!/^[a-f0-9]{64}$/.test(a.job) || !['webgl', 'webgpu'].includes(a.backend))
      throw Error('Give a valid --job from plan and --backend webgl|webgpu');
    const job = JSON.parse(fs.readFileSync(path.join(home, 'jobs', a.job + '.json'), 'utf8'));
    if (job.id !== a.job || fingerprint(job.identity) !== a.job) throw Error('Wrong job identity');
    if (cmd === 'verify') {
      const { verify }=await import('./remaster/verify.mjs');
      const r=await verify(job,home,{workers:Number(a.workers??1),packet:a.packet});
      console.log(`Inspect three fitted boards (${r.seconds}s):`,r.dir);return;
    }
    if (cmd === 'prep') {
      const { prepare } = await import('./remaster/prep.mjs');
      const { capture } = await import('./remaster/capture.cjs');
      const r=await prepare(job,home,()=>capture(job,{world:a.world,backend:a.backend,trial:null,inventory:true},home),()=>referenceBoard(job,a,home));
      console.log(`Scouting only (${r.seconds}s):`,r.board);return;
    }
    if (cmd === 'references') {
      await referenceBoard(job, a, home);
      return;
    }
    if (cmd === 'donors') {
      const { donorBoard } = await import('./remaster/polyhaven.mjs');
      const r = await donorBoard(job, requireDirection(job), a.query, home, { role: 'ground' });
      console.log('Inspect Poly Haven candidates:', r.board);
      return;
    }
    if (cmd === 'fit') {
      const { fitBoard } = await import('./remaster/fit.mjs');
      console.log('Inspect composed landscape:', await fitBoard(job, a.report, home));
      return;
    }
    if (cmd === 'brief') {
      if (!a.review || !a.report) throw Error('Give --review <direction.json> and --report <reference report>');
      recordDirection(job, JSON.parse(fs.readFileSync(a.review)), JSON.parse(fs.readFileSync(a.report)), home);
      console.log('Recorded art direction (not release approval):', directionPath(job));
      return;
    }
    if (cmd === 'trial' && !fs.existsSync(directionPath(job))) await referenceBoard(job, a, home);
    if (cmd === 'trial') requireDirection(job);
    if (cmd === 'trial' && (!/^\d{1,3}$/.test(a.slot) || !families.includes(a.donor)))
      throw Error('Trial needs a terrain --slot and a licensed --donor (' + families.join(', ') + ')');
    const { capture } = await import('./remaster/capture.cjs');
    await capture(job, { world: a.world, backend: a.backend, trial: cmd === 'trial' ? { slot: +a.slot, donor: a.donor } : null }, home);
    return;
  }
  const lib = readLibrary(),
    scopes = a.scope === 'all' ? installedScopes(lib) : [a.scope],
    limit = a.limit === undefined ? Infinity : Number(a.limit);
  if (!(limit === Infinity || (Number.isSafeInteger(limit) && limit > 0))) throw Error('Limit must be a positive integer');
  const started = Date.now(),
    jobs = [],
    byScope = [],
    failures = [],
    known = new Map(),
    cache = intakeCache(),
    looseIndex = new Map(),
    views = new Map(),
    // A plan mounts stock eaw/foc to seed reuse candidates, then mounts them again as scopes. Keep
    // one mount per scope key and release it when that scope is done instead of mounting twice.
    view = key => {
      if (!views.has(key)) views.set(key, openScope(lib, scope(lib, key), { looseIndex }));
      return views.get(key);
    },
    release = key => {
      views.get(key)?.close();
      views.delete(key);
    };
  if (cmd === 'plan')
    for (const edition of ['eaw', 'foc']) {
      try {
        for (const [k, f] of referencePairs(view(edition), edition, groundFamily, families)) known.set(k, f);
      } catch (e) {
        release(edition);
        throw e;
      }
    }
  for (const key of scopes) {
    try {
      const s = scope(lib, key);
      const v = view(key),
        maps = catalog(v, cache),
        matches = maps.filter(m => m.domain === 'land' && m.key.includes(a.match.toUpperCase())),
        take = matches.slice(0, limit),
        entry = {
          scope: s,
          land: maps.filter(m => m.domain === 'land').length,
          space: maps.filter(m => m.domain === 'space').length,
          other: maps.filter(m => m.domain === 'unknown').length,
          matching: matches.length
        };
      if (cmd === 'catalog') entry.maps = maps;
      else {
        const resolve = resolver(v, cache),
          ids = [];
        for (const m of take) {
          try {
            const job = annotate(survey(v, m, s, resolve, known, cache), notes, pins);
            job.direction = fs.existsSync(directionPath(job)) ? 'reviewed' : 'needs-reference-board';
            json('jobs/' + job.id + '.json', job);
            ids.push(job.id);
            jobs.push(job);
          } catch (e) {
            failures.push({ scope: key, path: m.key, error: e.message });
          }
        }
        entry.jobs = ids;
        entry.remaining = matches.length - take.length;
      }
      byScope.push(entry);
      console.log(
        key,
        `${entry.land} land / ${entry.space} space / ${entry.other} other`,
        cmd === 'plan' ? `· ${entry.jobs.length} planned; ${entry.remaining} not selected` : ''
      );
    } catch (e) {
      failures.push({ scope: key, error: e.message });
    } finally {
      release(key);
    }
  }
  for (const key of [...views.keys()]) release(key);
  const batch = fingerprint([cmd, a.scope, a.match.toUpperCase(), a.limit || null]).slice(0, 12),
    file = `${cmd}-${batch}.json`,
    rows = makeQueue(jobs),
    report = { format: 1, seconds: (Date.now() - started) / 1000, scopes: byScope, failures, ...(cmd === 'plan' ? { queue: rows } : {}) };
  json(file, report);
  console.log(`${path.join(home, file)} (${report.seconds.toFixed(1)}s)`);
  if (cmd === 'plan') {
    console.log(
      `${jobs.length} jobs · ${rows.length} distinct painted material pairs · ${rows.filter(r => r.suggestion).length} Endor reuse candidates (not approvals)`
    );
    for (const j of jobs.slice(0, 5)) console.log(j.id, j.scope.key, j.file);
  }
  if (failures.length) {
    console.error('Blocked:', failures.length, 'See report.', failures[0]);
    process.exitCode = 1;
  }
}
main().catch(e => {
  console.error(e.message, e.details?.report || '');
  process.exitCode = 1;
});
