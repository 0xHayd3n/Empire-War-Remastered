// Private, offline release-review board. A non-zero pixel difference never establishes likeness.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {inspectPlaceViews} from './place-evidence.mjs';
import {verifyClimate} from './climate.mjs';
import {scanRepeat} from './scan-repeat.mjs';
import { requireDirection } from './direction.mjs';
import {checkOutskirtsAudit} from './outskirts.mjs';
import {checkFoliageAudit} from './foliage-audit.mjs';
import {checkComposition} from './composition-audit.mjs';
import surfaceProbes from './ground-evidence.cjs';
import reveal from './first-battlefield.cjs';
import { completeTerrain, checkMountedTerrain } from './terrain-policy.mjs';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const digest = b => createHash('sha256').update(b).digest('hex');
export function checkSurfaceEvidence(job, r) {
  const a = r.surfaceAudit,
    mode = job.water?.mode ?? 0;
  if (
    !a ||
    a.waterMode !== mode ||
    !r.views[a.edgeView] ||
    typeof a.hasSheet !== 'boolean' ||
    !Array.isArray(a.edge?.rect) ||
    a.edge.rect.length !== 4 ||
    !a.edge.rect.every(Number.isInteger) ||
    a.edge.rect[2] <= 0 ||
    a.edge.rect[3] <= 0 ||
    !Number.isFinite(a.edge.fraction) ||
    !Number.isFinite(a.edge.limit) ||
    a.edge.fraction < 0 ||
    a.edge.limit <= 0 ||
    a.edge.limit >= 1 ||
    a.edge.fraction > a.edge.limit
  )
    throw Error('Missing or failed visible-edge audit; a dark full-frame average is not a diagnosis');
  if (!Array.isArray(a.surfaceViews) || new Set(a.surfaceViews).size < 2 || a.surfaceViews.some(v => !r.views[v]))
    throw Error('Need two views across a ground transition');
  if (mode === 0 && a.hasSheet) throw Error('Dry map drew a liquid sheet');
  if (
    mode === 1 &&
    a.hasSheet &&
    !(
      a.lake?.changed > 0 &&
      Number.isFinite(a.lake.black) &&
      a.lake.black >= 0 &&
      a.lake.black / a.lake.changed < 0.03 &&
      Number.isFinite(a.lake.island?.fraction) &&
      a.lake.island.fraction < 0.03
    )
  )
    throw Error('Need matched water-on/bed-only ROI evidence');
  if (mode === 1 && !a.hasSheet && job.slots?.some(s => s.submerged)) throw Error('No sheet over surveyed liquid');
  if (
    !a.retainedReason &&
    (!(a.heightRange?.length >= 2 && a.heightRange.every(h => Number.isFinite(h) && h > 0)) ||
      !Object.keys(a.donors || {}).length ||
      Object.values(a.donors).some(
        d => !(d.heightSpan > 1 && d.normalCorrelation?.length === 2 && d.normalCorrelation.every(k => Number.isFinite(k) && k >= -0.12))
      ))
  )
    throw Error('Missing measured relief or misregistered baked normals');
  return a;
}
export async function fitBoard(job, reportFile, home) {
  const d = requireDirection(job),
    r = JSON.parse(fs.readFileSync(reportFile)),
    dir = path.dirname(path.resolve(reportFile));
  if (
    r.job !== job.id ||
    r.kind !== 'composed-landscape' ||
    !r.stats?.active ||
    !r.views?.squad ||
    !r.views?.command ||
    Object.keys(r.views).length < 3
  )
    throw Error('Need a matching mounted composed-landscape report with squad, command and a second region; not a donor trial');
  reveal.checkReveal(r.firstBattlefield, { file: job.file, mode: 'remaster', backend: r.backend, width: r.stats.width });
  // Keep the previously accepted exact Yavin binding playable; do not grandfather a planet or a mod winner.
  if(job.id!=='d96aa07683839825c24b8653663e554a88948f6d4e2ff1a198d77b426f1bb03e'||d.views.some(v=>v.subject))inspectPlaceViews(d);
  const a = checkSurfaceEvidence(job, r),
    terrain = completeTerrain(job, d);
  checkMountedTerrain(terrain, r);
  const repeats=terrain.donors.map(scanRepeat), variation=terrain.composition.variation;
  const climate = job.id==='d96aa07683839825c24b8653663e554a88948f6d4e2ff1a198d77b426f1bb03e'&&!d.climate ? [] : await verifyClimate(job,d,r,dir);
  const patches=checkComposition(terrain.composition,r), foliage=checkFoliageAudit(d,r);
  if (r.stats.replaced > 0 && r.stats.replaced < r.stats.slots) {
    const { mixedProbeFile } = surfaceProbes;
    const file = mixedProbeFile();
    if (!fs.existsSync(file))
      throw Error('Missing current shared-edge shader check. Run MIXED_SURFACES=1 node tools/check-terrain-shade.cjs');
    const p = JSON.parse(fs.readFileSync(file));
    if (!p.edge?.length || !p.edge.every(([a, b]) => Math.abs(a - b) <= 1) || !(p.baked[0] > 0 && p.baked[1] > p.baked[0]))
      throw Error('Failed mixed-ground shader probe');
  }
  const image = f => `<img loading="lazy" src="${esc(pathToFileURL(f).href)}" alt="">`;
  const refs = d.views.map(v => {
    const f = path.join(home, 'references', 'reviewed-images', v.sha256);
    if (!fs.existsSync(f) || digest(fs.readFileSync(f)) !== v.sha256) throw Error('Rehydrate inspected photos with brief first');
    return `<figure>${image(f)}<figcaption>${esc(v.subject||'Environment')} · ${esc(v.visible)} ${esc(v.settingCue||'')} <a href="${esc(v.page)}">Source</a></figcaption></figure>`;
  });
  const pairs = Object.entries(r.views).map(([view, v]) => {
    if (!/^[a-z][a-z0-9-]{0,40}$/i.test(view) || !Number.isFinite(v.rollback) || v.rollback > 40)
      throw Error('Missing rollback check for ' + view);
    return (
      `<h3>${esc(view)}</h3><section>` +
      (terrain.composition.regions.some(a=>a.view===view)?['original','previous','remaster','restored']:['original','remaster','restored'])
        .map(k => {
          const f = path.join(dir, view + '-' + k + '.png');
          if (!fs.existsSync(f)) throw Error('Missing composed shot ' + f);
          return `<figure>${image(f)}<figcaption>${k}</figcaption></figure>`;
        })
        .join('') +
      '</section>'
    );
  });
  const plantBoard=(foliage.controls||[]).map(c=>{const files=['','-off'].map(s=>path.join(dir,c.stem+s+'.png'));if(files.some(f=>!fs.existsSync(f)))throw Error('Missing mounted foliage control: '+c.stem);return `<p>${esc(c.role)} · distance ${esc(c.d)} · class on / off</p><section>${files.map(f=>`<figure>${image(f)}</figure>`).join('')}</section>`;});
  const outskirts=checkOutskirtsAudit(d,r), rimBoard=outskirts.samples.map(s=>{
    const f=path.join(dir,`outskirts-${s.view}-${s.band}.png`);if(!fs.existsSync(f))throw Error('Missing HUD-on outskirts view: '+f);
    return `<figure>${image(f)}<figcaption>${esc(s.view)} · ${esc(s.band)}</figcaption></figure>`;});
  const climateSets=climate.length?[{folder:dir,states:r.climateAudit.states}]:[];
  if(climateSets.length && climate.length>r.climateAudit.states.length*d.climate.pairs.length){
    const folder=path.join(dir,'climate-clear');climateSets.push({folder,states:JSON.parse(fs.readFileSync(path.join(folder,'report.json'))).climateAudit.states});
  }
  const climateBoard=climateSets.flatMap(({folder,states})=>states.map((s,i)=>`<h3>${esc(s.name)} · ${esc(s.weather)}, level ${esc(s.level)}</h3><section>`+Object.keys(s.views).map(v=>`<figure>${image(path.join(folder,`climate-${i}-${v}-lit.png`))}<figcaption>${esc(v)}${s.views[v].control?` · <a href="${esc(pathToFileURL(path.join(folder,`climate-${i}-${v}-control.png`)).href)}">fixed diffuse control</a>`:''}</figcaption></figure>`).join('')+'</section>')).join('');
  const output = path.join(dir, 'planet-fit.html');
  fs.writeFileSync(
    output,
    `<!doctype html><meta charset=utf-8><title>${esc(d.planet)} · planet fit</title><style>body{font:16px system-ui;background:#202322;color:#eee;margin:24px}a{color:#a9d8e8}section{display:flex;gap:8px;flex-wrap:wrap}figure{margin:0;flex:1;min-width:240px}img{width:100%}figcaption{font-size:14px}</style><h1>${esc(d.planet)} · reference fit</h1><p>Review required, not automatic approval. If the treeline, ground transitions or landmarks contradict the reference, revise the recipe even if all technical checks pass.</p><p>Surface check: ${a.hasSheet ? 'sheet present' : 'no liquid sheet'} · visible-edge dark island ${(100 * a.edge.fraction).toFixed(2)}% · ${a.heightRange?.map(n => n.toFixed(2)).join(' / ') || 'retained'} local displacement range (world units).</p><section>${refs.join('')}</section>` +
      ['ground', 'foliage', 'landmark'].map(k => `<p><b>${k}:</b> ${esc(d[k].decision)} ${esc(d[k].reject)}</p>`).join('') +
      `<p>Unknown: ${esc(d.uncertain)}</p><h2>Verified Poly Haven terrain</h2><ul>${terrain.donors
        .map(
          row =>
            `<li><a href="https://polyhaven.com/a/${esc(row.asset)}">${esc(row.asset)}</a> · TED ${Object.keys(terrain.slots)
              .filter(k => terrain.slots[k].family === row.id)
              .join(', ')} · ${row.tileMeters} m · ${row.regular ? 'aligned' : 'organic'}</li>`
        )
        .join('')}</ul>` +
      (climate.length?`<h2>Ground color under authored light and weather</h2><p>${esc(d.climate.substrate)} ${esc(d.climate.lighting)} ${esc(d.climate.exceptions)}</p>`+climateBoard:'')+
      `<h2>Material variation</h2><p>${esc(variation?.process||'Inspect ground at squad and command height.')} ${esc(variation?.preserve||'')} ${esc(variation?.uniformReason||'')}</p><ul>`+repeats.map(d=>`<li>${esc(d.id)} · ${d.aligned?'intentional alignment':'organic'} · largest scan-repeat correlation ${Math.max(...d.corr.map(Math.abs)).toFixed(2)} · retained grain RMS ${d.grain.toFixed(2)}×</li>`).join('')+'</ul>'+patches.filter(p=>p.variation).map(p=>`<p>${esc(p.name)} · within-substrate p10–90 width ${(100*p.variation.span).toFixed(0)} percentage points, upper neighbor step ${(100*p.variation.step).toFixed(0)}. Inspect the gameplay shots for rows, quilting or grit disappearing in the pan.</p>`).join('')+
      `<h2>Patch and blend review</h2><p>${esc(terrain.composition.design)}</p>`+patches.map(p=>`<p>${esc(p.name)} · neighboring family changes ${(100*p.prior.adjacency.fraction).toFixed(1)}% → ${(100*p.modern.adjacency.fraction).toFixed(1)}% · small-patch vertex share ${(100*p.prior.patches.smallVertexFraction).toFixed(1)}% → ${(100*p.modern.patches.smallVertexFraction).toFixed(1)}%. Compare the previous layout and the remaster below; reject a featureless wash even if it scores well.</p>`).join('') + '<h2>Foliage evidence and zoom</h2>'+d.foliage.review.forms.map(f=>`<p><b>${esc(f.id)}</b> · ${esc(f.disposition)} · ${esc(f.silhouette)} ${esc(f.variation)}</p>`).join('')+plantBoard.join('')+`<h2>Outskirts</h2><p>${esc(d.outskirts.skyline)} ${esc(d.outskirts.join)} ${esc(d.outskirts.reject)}</p><section>${rimBoard.join('')}</section>`+pairs.join('')
  );
  return output;
}
