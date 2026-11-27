// Private file-backed research inputs. Offer bytes and citations, never somebody else's reasons or approvals.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const directions = fileURLToPath(new URL('./directions/', import.meta.url)),
  physical = new Set(['www.nps.gov', 'www.blm.gov', 'www.antarctica.gov.au']);
export function placeInputs(job, reference, home) {
  const photos = [],
    seen = new Set(),
    cache = path.join(home, 'references', 'reviewed-images');
  function add(type, page, image, hash, localFile) {
    if (
      !/^[0-9a-f]{64}$/.test(hash) ||
      seen.has(hash) ||
      new URL(page).protocol !== 'https:' ||
      new URL(image).protocol !== 'https:' ||
      !fs.existsSync(localFile)
    )
      return;
    if (createHash('sha256').update(fs.readFileSync(localFile)).digest('hex') !== hash) return;
    photos.push({ type, page, image, sha256: hash, localFile });
    seen.add(hash);
  }
  for (const c of reference?.candidates || [])
    add('location candidate', c.pageUrl, c.directUrl, c.sha256, path.resolve(reference.paths.dir, c.file));
  const files = fs
    .readdirSync(directions)
    .filter(n => /^[0-9a-f]{64}\.json$/.test(n))
    .sort((a, b) => Number(b === job.id + '.json') - Number(a === job.id + '.json'));
  for (const file of files) {
    const d = JSON.parse(fs.readFileSync(path.join(directions, file))),
      same = d.job === job.id && reference?.source === 'same-job-inspected-photos';
    for (const v of d.views) {
      const earth = physical.has(new URL(v.page).hostname);
      if (!same && !earth) continue;
      add(earth ? 'Earth analogue candidate' : 'same binding · location source', v.page, v.image, v.sha256, path.join(cache, v.sha256));
    }
  }
  return photos;
}
export function briefDraft(job, planet) {
  const role = () => ({ decision: '', reject: '', evidence: [] });
  return {
    job: job.id,
    planet,
    views: [],
    ground: role(),
    foliage: {
      ...role(),
      review: {
        disposition: null,
        basis: '',
        forms: [],
        zones: { place: [], exclude: [] },
        variation: { decision: '', limits: [], evidence: [] }
      }
    },
    landmark: role(),
    landUse: Object.fromEntries(['natural', 'built', 'transition'].map(k => [k, { decision: '', evidence: [] }])),
    outskirts: { treatment: null, skyline: '', join: '', reject: '', foliage: [], evidence: [] },
    climate: { skies: job.environments.map(e => e.name), pairs: [], substrate: '', lighting: '', exceptions: '', evidence: [] },
    uncertain: ''
  };
}
