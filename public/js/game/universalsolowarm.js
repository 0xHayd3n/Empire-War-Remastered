import { activeLanguage } from '../language.js';
import { campaignLibrary, campaignOpening } from './universalcampaign.js';
import { mapStart } from './universalmaplist.js';
import { soloLibrary, storyProfiles, fieldProfiles, battlefieldEntries } from './solooperationlibrary.js';
import { galaxyChart, sectorView } from './universalgalaxychart.js';
import { overviewView } from './universalviewcamera.js';
import { chartPose } from './universalviewmotion.js';
import { planetArt, portraitBank } from './universalplanetart.js';
import { chartPasses, renderPass, rememberFrame, forgetFrame } from './universalopeningframe.js';

// Measure the first grid cell with the board's responsive CSS, not a guessed
// screen ratio. No dialog, gameplay renderer, or offscreen selector is mounted.
function measure(kind) {
  const grid = document.createElement('div'),
    cell = document.createElement('div');
  grid.className = 'uc-opening-size';
  grid.dataset.kind = kind;
  grid.append(cell);
  document.body.append(grid);
  const size = [cell.clientWidth, cell.clientHeight];
  grid.remove();
  return size;
}
async function selection(kind, current, language) {
  if (kind === 'conquest') {
    const data = await campaignLibrary(language),
      { initial } = campaignOpening(data, current);
    return initial && [data.profiles, initial.p, mapStart(initial).choice.variant.map];
  }
  const data = await soloLibrary(language);
  if (kind === 'story') {
    const g = data.stories.find(g => g.p.id === current) || data.stories[0];
    return g && [storyProfiles(data), g.p, g.choices[0].map];
  }
  const profiles = fieldProfiles(data);
  battlefieldEntries(data);
  return profiles.length && [profiles, profiles[0], 0];
}
export function soloWarmer(current, life) {
  const jobs = new Map(),
    art = portraitBank(() => {});
  function drop(job) {
    job.controller.abort();
    if (job.frame) forgetFrame(job.profiles, job.frame);
  }
  const clear = () => {
    for (const job of jobs.values()) drop(job);
    jobs.clear();
    art.close();
  };
  life.addEventListener('abort', clear, { once: true });
  async function prepare(kind, job, w, h, language) {
    const signal = job.controller.signal,
      spec = await selection(kind, current, language);
    signal.throwIfAborted();
    if (!spec || !w || !h) return;
    const [profiles, p, index] = spec,
      m = p.maps[index],
      chart = galaxyChart(profiles),
      worlds = m.worlds.map(([i]) => chart.world(p, i).placed),
      { view, backdrop, query } = chartPasses(chart, p, m, worlds, w, h);
    const keys = new Set(worlds.map(world => planetArt(p, world)?.[0]));
    // Include inactive planets already in the opening camera, not sheets for
    // distant worlds the player hasn't panned to. Missing source art stays an orb.
    if (kind !== 'fields') {
      const sector = sectorView(view.labels),
        { z, x, y } = chartPose(sector.zoom, 0.5 - sector.zoom * sector.u, 0.5 - sector.zoom * sector.v);
      const { labels } = overviewView(
        chart.catalog.map(r => r.planet),
        chart.reference.camera,
        w,
        h,
        chart.frame
      );
      labels.forEach(([u, v], i) => {
        const X = x + u * z,
          Y = y + v * z;
        if (X >= -0.03 && X <= 1.03 && Y >= -0.03 && Y <= 1.03) {
          const r = chart.catalog[i];
          keys.add(planetArt(r.profile, r.planet)?.[0]);
        }
      });
    }
    const [images, { plate, shot }] = await Promise.all([
      art.load([...keys]).then(() => art.keep(keys, Infinity)),
      (async () => {
        const plate = chart.sky.length ? await renderPass(backdrop, signal) : null;
        const portraitsOnly = kind === 'fields' && p.sheets && !p.overlay.ring && !m.routes.length;
        const shot = portraitsOnly ? null : await renderPass(query(plate?.bitmap), signal);
        return { plate, shot };
      })()
    ]);
    signal.throwIfAborted();
    job.profiles = profiles;
    job.frame = { p, index, chart, w, h, plate, shot, images };
    rememberFrame(profiles, job.frame);
  }
  return mode => {
    if (life.aborted) return;
    const kind = ['skirmish', 'instant'].includes(mode) ? 'fields' : mode;
    const [w, h] = measure(kind),
      language = activeLanguage,
      key = [language, w, h].join(':');
    const prev = jobs.get(kind);
    if (prev?.key === key) return prev.ready;
    if (prev) drop(prev);
    const job = { key, controller: new AbortController() };
    jobs.set(kind, job);
    job.ready = prepare(kind, job, w, h, language).catch(e => {
      if (jobs.get(kind) === job) jobs.delete(kind);
      if (!job.controller.signal.aborted) console.warn('Opening map preload:', e.message);
    });
    return job.ready;
  };
}
