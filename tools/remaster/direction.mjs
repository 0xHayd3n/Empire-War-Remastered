// Reference photos are evidence, never donors. Only URLs, content hashes and editorial decisions enter git.
import fs from 'node:fs';
import {inspectPlaceViews} from './place-evidence.mjs';
import {checkOutskirtsBrief} from './outskirts.mjs';
import {climatePlan} from './climate.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('./directions/', import.meta.url));
export const directionPath = j => path.join(directory, j.id + '.json');
const roles = ['ground', 'foliage', 'landmark'];
const hex = s => /^[0-9a-f]{64}$/.test(s);
const prose = s => typeof s === 'string' && s.trim().length >= 12 && s.length <= 3000;
const slug = s => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(s);
const https = s => {
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
};
// A world is not required to grow anything. All three answers are first class.
export const foliageDispositions = ['replace', 'retain', 'absent'];
const citation = (d, list, what) => {
  if (!Array.isArray(list) || !list.length) throw Error('Foliage ' + what + ' needs an inspected view');
  if (list.some(h => !d.views.some(v => v.sha256 === h))) throw Error('Foliage ' + what + ' cites a view that is not on this board');
  return list;
};

/**
 * The reviewed class list under `foliage.review`. Growth forms, not species claims: what
 * silhouette a viewer can actually see, where the class stands and where it must not, how
 * instances vary, and whether the class replaces authored art, is retained as it already is,
 * or is deliberately absent. There is no count quota and no requirement that any class exist.
 */
export function validateFoliageReview(d, { allowUnreviewed = false } = {}) {
  const review = d.foliage?.review;
  if (!review || review.status === 'unreviewed') {
    if (allowUnreviewed) return null;
    throw Error(
      'Foliage needs a reviewed class list: growth form and silhouette per class, where each is placed or excluded, its variation, and a replace/retain/absent choice; a world with no vegetation records the observed absence'
    );
  }
  if (!foliageDispositions.includes(review.disposition))
    throw Error('Foliage review needs replace, retain or absent for this world, not ' + JSON.stringify(review.disposition));
  if (!prose(review.basis)) throw Error('Record what the inspected views establish for foliage and what stays inference');
  if (!Array.isArray(review.forms)) throw Error('Foliage review needs a forms list, empty only for a world with no vegetation');
  if (!review.zones || !Array.isArray(review.zones.place) || !Array.isArray(review.zones.exclude))
    throw Error('Foliage review needs the zones where it is placed and the zones where it is excluded');
  if (!review.zones.exclude.length)
    throw Error('Every foliage review names where vegetation must not appear (deliberate absence included)');
  if (!review.variation || !prose(review.variation.decision) || !Array.isArray(review.variation.limits) || !review.variation.limits.length)
    throw Error('Foliage review needs a decision and limits for variation between instances and places');
  if (review.variation.limits.some(l => !prose(l))) throw Error('Each variation limit states an observable range');
  citation(d, review.variation.evidence, 'variation');

  const ids = new Set();
  for (const f of review.forms) {
    if (!slug(f?.id)) throw Error('Foliage class needs a short lowercase id: ' + JSON.stringify(f?.id));
    if (ids.has(f.id)) throw Error('Duplicate foliage class id: ' + f.id);
    ids.add(f.id);
    if (!prose(f.form)) throw Error('Foliage class ' + f.id + ' needs its observed growth form, not a species claim');
    if (!prose(f.silhouette)) throw Error('Foliage class ' + f.id + ' needs the silhouette a player would read');
    if (!prose(f.variation)) throw Error('Foliage class ' + f.id + ' needs its own variation within the class');
    if (!foliageDispositions.includes(f.disposition)) throw Error('Foliage class ' + f.id + ' needs replace, retain or absent');
    if (!prose(f.reason))
      throw Error('Foliage class ' + f.id + ' needs the reason for its disposition, including the rejected alternative');
    if (f.analogue !== undefined && !prose(f.analogue))
      throw Error('Foliage class ' + f.id + ' names a licensed analogue in prose, never as a species claim');
    citation(d, f.evidence, 'class ' + f.id);
  }
  const shapes = review.forms.map(f => f.silhouette.trim().toLowerCase()),
    walks = review.forms.map(f => f.variation.trim().toLowerCase());
  if (new Set(shapes).size !== shapes.length) throw Error('Two foliage classes share one silhouette; name the difference a player sees');
  if (new Set(walks).size !== walks.length)
    throw Error('Two foliage classes share one variation sentence; state how each varies, not one generic shrub');

  if (review.disposition === 'absent') {
    if (review.zones.place.length) throw Error('A world recorded as having no vegetation cannot also place classes');
    if (review.forms.some(f => f.disposition !== 'absent'))
      throw Error('A world recorded as having no vegetation cannot replace or retain a class');
  } else if (!review.forms.some(f => f.disposition !== 'absent'))
    throw Error('Foliage review replaces, retains or records absence; it cannot only reject');

  for (const z of review.zones.place) {
    if (!prose(z?.where)) throw Error('Each placed zone names the visible place it belongs to');
    if (!Array.isArray(z.forms) || !z.forms.length || z.forms.some(id => !ids.has(id)))
      throw Error('Each placed zone names the reviewed foliage classes it holds');
    citation(d, z.evidence, 'placed zone');
  }
  for (const z of review.zones.exclude) {
    if (!prose(z?.where)) throw Error('Each excluded zone names the visible place it stays clear of');
    if (!prose(z?.reason)) throw Error('Each excluded zone says what the views show there instead');
    if (z.forms !== undefined && (!Array.isArray(z.forms) || z.forms.some(id => !ids.has(id))))
      throw Error('An excluded zone may only narrow reviewed foliage classes');
    citation(d, z.evidence, 'excluded zone');
  }

  const placed = new Set(review.zones.place.flatMap(z => z.forms));
  for (const f of review.forms)
    if (placed.has(f.id) === (f.disposition === 'absent')) throw Error('Place each living class and exclude absent classes: ' + f.id);
  // Multiple distinct relevant views, not one plate decorated with more citations.
  const cited = new Set([
    ...(d.foliage.evidence || []),
    ...review.forms.flatMap(f => f.evidence),
    ...review.zones.place.flatMap(z => z.evidence),
    ...review.zones.exclude.flatMap(z => z.evidence),
    ...review.variation.evidence
  ]);
  const needed = review.disposition === 'replace' ? 3 : 2;
  if (cited.size < needed)
    throw Error(
      'A ' +
        review.disposition +
        ' foliage review needs at least ' +
        needed +
        ' distinct relevant inspected views; a single plate cannot separate crown, understory and ground'
    );
  return review;
}

export function validateDirection(job, d, options = {}) {
  if (
    !hex(job.id) ||
    d.job !== job.id ||
    !d.planet?.trim() ||
    !Array.isArray(d.views) ||
    new Set(d.views.map(v => v.sha256)).size < 5 ||
    new Set(d.views.map(v => v.image)).size < 5
  )
    throw Error('Need five distinct inspected environment views for this exact job');
  for (const v of d.views) {
    if (!hex(v.sha256) || !https(v.page) || !https(v.image) || !prose(v.visible))
      throw Error('Each inspected view needs source page, direct image, SHA-256 and a visible cue');
  }
  for (const k of roles) {
    const s = d[k];
    if (!prose(s?.decision) || !prose(s?.reject) || !s.evidence?.length || s.evidence.some(h => !d.views.some(v => v.sha256 === h)))
      throw Error('Missing observed ' + k + ' decision, alternative rejected, or image citation');
  }
  const cited = new Set();
  for (const k of ['natural', 'built', 'transition']) {
    const z = d.landUse?.[k];
    if (!prose(z?.decision) || !Array.isArray(z.evidence) || !z.evidence.length || z.evidence.some(h => !d.views.some(v => v.sha256 === h)))
      throw Error('Need observed ' + k + ' ground use or explicit observed absence');
    for (const h of z.evidence) cited.add(h);
  }
  if (cited.size < 5) throw Error('Five relevant views must inform land use, not just decorate the board');
  if (!prose(d.uncertain)) throw Error('Record what the images do not establish');
  validateFoliageReview(d, { allowUnreviewed: !!options.allowUnreviewedFoliage });
  if(!(options.allowUnreviewedFoliage && d.foliage.review?.status==='unreviewed') && (d.outskirts || !options.allowUnreviewedOutskirts))checkOutskirtsBrief(d);
  return d;
}

/**
 * A direction briefed before the class schema keeps loading: it is marked unreviewed rather
 * than silently gaining classes nobody inspected. Re-brief it to clear the mark.
 */
export function normalizeDirection(d) {
  if (d?.foliage?.review && typeof d.foliage.review === 'object') return d;
  if (!d?.foliage || typeof d.foliage !== 'object') return d;
  return {
    ...d,
    foliage: {
      ...d.foliage,
      review: {
        status: 'unreviewed',
        disposition: 'retain',
        basis:
          'Briefed before the foliage class schema. Only the prose decision and the rejected alternative were recorded, so the authored planting stands until a class review is inspected and briefed.'
      }
    }
  };
}

export function requireDirection(job) {
  const file = directionPath(job);
  if (!fs.existsSync(file))
    throw Error(
      'No reviewed planet direction. Run references --job ' + job.id + ', inspect the board, then brief --job <id> --review <review.json>'
    );
  return validateDirection(job, normalizeDirection(JSON.parse(fs.readFileSync(file))), { allowUnreviewedFoliage: true, allowUnreviewedOutskirts:true });
}

export function recordDirection(job, d, report, home) {
  validateDirection(job, d);
  inspectPlaceViews(d);
  climatePlan(job,d);
  if (
    report.job?.id !== job.id ||
    !['planet-reference-candidates', 'planet-reference-failure'].includes(report.kind) ||
    report.planet.name.toLowerCase() !== d.planet.toLowerCase()
  )
    throw Error('Wrong reference board/planet for this job');
  const views = d.views.map(v => {
    const c = report.candidates?.find(c => c.sha256 === v.sha256 && c.pageUrl === v.page && c.directUrl === v.image);
    if (!c && !v.localFile) throw Error('Cite a board image or supply a locally inspected primary-source photo');
    const f = c ? path.resolve(report.paths.dir, c.file) : v.localFile;
    const bytes = fs.readFileSync(f);
    if (createHash('sha256').update(bytes).digest('hex') !== v.sha256) throw Error('Reference image changed: ' + v.image);
    const cache = path.join(home, 'references', 'reviewed-images');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, v.sha256), bytes);
    const { page, image, sha256, visible } = v;
    return { page, image, sha256, visible, subject:v.subject, people:v.people, settingCue:v.settingCue, ...(v.people==='incidental-native'?{nativeContext:v.nativeContext}:{}) };
  });
  const pick = k => ({ decision: d[k].decision, reject: d[k].reject, evidence: d[k].evidence });
  const safe = {
    job: job.id,
    planet: d.planet,
    views,
    ground: pick('ground'),
    // Classes, zones and variation are editorial decisions; they carry hashes only, never bytes.
    foliage: { ...pick('foliage'), review: JSON.parse(JSON.stringify(d.foliage.review)) },
    landmark: pick('landmark'),
    landUse: d.landUse,
    outskirts:d.outskirts,
    climate:d.climate,
    uncertain: d.uncertain
  };
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(directionPath(job), JSON.stringify(safe, null, 2) + '\n');
  return safe;
}
