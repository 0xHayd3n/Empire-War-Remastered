// Runs the existing mounted evidence gates; never promotes a binding. Keep each attempt isolated.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fitBoard } from './fit.mjs';
import { needsClearInterval } from './climate.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  read = f => JSON.parse(fs.readFileSync(f));
const routes = new Set(['geonosis', 'hoth', 'tatooine', 'naboo', 'utapau']);
export async function verify(job, home, { workers = 1, packet } = {}) {
  if (![1, 2].includes(workers)) throw Error('Use one or two local workers');
  const planet = job.file.match(/^_MP_LAND_([A-Z]+)\.TED$/i)?.[1]?.toLowerCase();
  if (!routes.has(planet)) throw Error('No verification matrix for this binding; register its real launch and controls first');
  const recipe = (await import(`../../public/js/${planet}-recipe.js`))[planet + 'Recipe'];
  if (job.id !== recipe.job) throw Error('Unregistered mount or changed map identity');
  const startPacket = packet && read(packet);
  if (
    startPacket &&
    (startPacket.kind !== 'scouting-only' ||
      startPacket.state !== 'needs-inspection' ||
      startPacket.job !== job.id ||
      !Number.isFinite(Date.parse(startPacket.startedAt)) ||
      Date.parse(startPacket.startedAt) > Date.now())
  )
    throw Error('Not a matching prep packet');
  const parent = path.join(home, 'verify', job.id);
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'run-'));
  const t = performance.now(),
    log = {
      kind: 'verification-matrix',
      job: job.id,
      stamp: recipe.stamp,
      workers,
      startedAt: new Date().toISOString(),
      state: 'incomplete',
      tasks: {},
      boards: {}
    };
  const save = () => {
    const f = path.join(dir, 'matrix.json');
    fs.writeFileSync(f + '.tmp', JSON.stringify(log, null, 2) + '\n');
    fs.renameSync(f + '.tmp', f);
  };
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(REMASTER_|YAVIN_|LOOK_BACKEND$)/i.test(k)) delete env[k];
  async function run(name, options) {
    const begin = performance.now(),
      file = path.join(dir, name + '.log'),
      fd = fs.openSync(file, 'w');
    console.log('Checking', name);
    log.tasks[name] = { state: 'running', file };
    save();
    try {
      await new Promise((resolve, reject) => {
        const c = spawn(process.execPath, ['tools/check-yavin-remaster.cjs'], {
          cwd: root,
          env: { ...env, REMASTER_MAP: planet, REMASTER_RUN_DIR: dir, ...options },
          stdio: ['ignore', fd, fd]
        });
        c.once('error', reject);
        c.once('close', code => (code === 0 ? resolve() : reject(Error(`${name} failed (${code}): ${file}`))));
      });
      log.tasks[name].state = 'passed';
    } catch (e) {
      log.tasks[name].state = 'blocked';
      throw e;
    } finally {
      fs.closeSync(fd);
      log.tasks[name].seconds = +((performance.now() - begin) / 1000).toFixed(2);
      save();
    }
  }
  const base = path.join(dir, `universal-${planet}-remaster`);
  const work = ['webgl-low', 'webgpu', 'webgl'].map(tier => async () => {
    const opts = { LOOK_BACKEND: tier === 'webgpu' ? 'webgpu' : 'webgl', YAVIN_LOW: tier === 'webgl-low' ? '1' : '0' };
    await run(tier, opts);
    const f = path.join(base, tier, 'report.json'),
      r = read(f);
    if (
      r.kind !== 'composed-landscape' ||
      r.job !== job.id ||
      r.backend !== opts.LOOK_BACKEND ||
      r.stats?.width !== (tier === 'webgl-low' ? 512 : 2048) ||
      r.terrainSources?.stamp !== recipe.stamp
    )
      throw Error(`Wrong capture in ${tier}`);
    if (needsClearInterval(r.climateAudit?.states || []))
      await run(tier + '-clear', { ...opts, REMASTER_CHECK: 'climate', REMASTER_WEATHER: 'clear' });
    log.boards[tier] = await fitBoard(job, f, home);
    save();
  });
  for (const [name, flag] of [
    ['original', 'YAVIN_ORIGINAL'],
    ['fallback', 'YAVIN_FAIL']
  ])
    work.push(async () => {
      await run(name, { [flag]: '1' });
      const r = read(path.join(base, 'webgpu-' + name, 'report.json'));
      if (r.job !== job.id || r.stats?.active || (name === 'fallback' && r.stats?.state !== 'unavailable'))
        throw Error('Wrong stock control: ' + name);
    });
  console.log('Private verification:', dir);
  save();
  const failures = [];
  const worker = async () => {
    while (!failures.length && work.length) {
      try {
        await work.shift()();
      } catch (e) {
        failures.push(e.message);
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  log.state = failures.length ? 'blocked' : 'needs-visual-review';
  log.failures = failures;
  log.seconds = +((performance.now() - t) / 1000).toFixed(2);
  if (startPacket) {
    log.prepPacket = path.resolve(packet);
    log.sincePrepSeconds = (Date.now() - Date.parse(startPacket.startedAt)) / 1000;
  }
  save();
  if (failures.length) throw Error(`${failures.join('; ')}. Incomplete matrix: ${dir}`);
  return { dir, ...log };
}
