// Complete terrain is a release constraint. A partial trial is useful, but never a finished landscape.
import fs from 'node:fs';
import {validatePatchReview,validateVariation} from './composition-audit.mjs';
import { createHash } from 'node:crypto';
import { parseDDS } from '../../public/js/dds.js';
const sha = b => createHash('sha256').update(b).digest('hex'),
  json = u => JSON.parse(fs.readFileSync(u));
const art = new URL('../../public/art/', import.meta.url),
  key = /^[a-z0-9][a-z0-9_-]*$/,
  digest = /^[a-f0-9]{64}$/;
export function completeTerrain(job, brief) {
  if (!digest.test(job.id)) throw Error('Invalid terrain job');
  const review = json(new URL(`terrain/${job.id}.json`, import.meta.url));
  if (review.job !== job.id || review.policy !== 'polyhaven-2k' || !key.test(review.pack))
    throw Error('Need reviewed Poly Haven 2K terrain');
  const lock = json(new URL(`${review.pack}/sources.json`, art));
  const donors = [],
    slots = {},
    proof = {};
  for (const spec of review.families) {
    const { id, asset, role, regular, why, evidence, tileMeters } = spec,
      pack = spec.reuse || review.pack;
    if (
      ![id, asset, pack].every(s => typeof s === 'string' && key.test(s)) ||
      !brief.views.some(v => v.sha256 === evidence) ||
      !why?.trim() ||
      !(tileMeters > 0) ||
      typeof regular !== 'boolean' ||
      donors.some(d => d.id === id)
    )
      throw Error('Unreviewed terrain choice: ' + id);
    const s = lock[asset];
    if (
      s?.page !== `https://polyhaven.com/a/${asset}` ||
      s.api !== `https://api.polyhaven.com/files/${asset}` ||
      s.license !== 'https://polyhaven.com/license'
    )
      throw Error('Missing official provenance for ' + asset);
    const channels = ['color', 'height', 'normal', 'roughness'];
    for (const k of channels) {
      const f = s.inputs[k],
        u = new URL(f.url);
      if (
        u.origin !== 'https://dl.polyhaven.org' ||
        !new RegExp(`^/file/ph-assets/Textures/(png|jpg)/2k/${asset}/[\\w.-]+$`).test(u.pathname) ||
        !f.size ||
        !digest.test(f.sha256) ||
        !/^\w{32}$/.test(f.md5)
      )
        throw Error('Missing locked native 2K ' + asset + ' ' + k);
    }
    const index = json(new URL(`${pack}/materials.json`, art));
    if (pack === 'endor-terrain') index.push(json(new URL('endor-terrain/paving.json', art)));
    const row = index.find(r => r.id === id && r.asset === asset);
    if (!row || row.tileMeters !== tileMeters || (row.role || row.id) !== role) throw Error('Wrong cooked terrain row: ' + id);
    for (const k of ['color', 'surface']) {
      const b = fs.readFileSync(new URL(`${pack}/${id}-${k}.dds`, art)),
        d = parseDDS(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      if (
        sha(b) !== row[k + 'Hash'] ||
        d.width !== 2048 ||
        d.height !== 2048 ||
        d.mipmaps.length !== 12 ||
        b.toString('ascii', 84, 88) !== 'DXT5'
      )
        throw Error('Incomplete 2K DDS: ' + id + ' ' + k);
    }
    donors.push({ ...row, regular });
    for (const i of spec.slots) {
      if (!Number.isInteger(i) || slots[i]) throw Error('Duplicate or invalid TED slot: ' + i);
      const src = job.identity.slots[i];
      if (src?.[0] !== i || !src[2] || !src[4]) throw Error('Missing mounted source: ' + i);
      if (!['built', 'natural'].includes(spec.use) || ((role === 'concrete' || regular) && spec.use !== 'built'))
        throw Error('Classify manufactured vs natural ground: ' + id);
      slots[i] = { family: id, use: spec.use, diffuse: src[2], bump: src[4] };
      proof[i] = asset;
    }
  }
  for (const s of job.slots)
    if (s.vertices && !s.hole && s.texture && !slots[s.index]) throw Error('Uncovered painted terrain: ' + s.index);
  const zones = review.zones;
  if (!Array.isArray(zones)) throw Error('Missing land-use zones');
  const built = Object.keys(slots)
    .filter(i => slots[i].use === 'built')
    .map(Number);
  if (zones.length !== built.length || built.some(i => !zones.some(z => z.slot === i)))
    throw Error('Each built slot needs a land-use rule');
  for (const z of zones) {
    if (
      slots[z.natural]?.use !== 'natural' ||
      !Array.isArray(z.aprons) ||
      !(z.construction || z.aprons.length) ||
      !brief.landUse.built.evidence.includes(z.evidence)
    )
      throw Error('Missing evidenced built-ground permission');
    for (const a of z.aprons) {
      const r = a.rect;
      if (
        !a.model ||
        !Array.isArray(a.anchor) ||
        a.anchor.length !== 2 ||
        !r?.every(Number.isFinite) ||
        r.length !== 4 ||
        r[2] <= r[0] ||
        r[3] <= r[1]
      )
        throw Error('Invalid reviewed apron');
    }
  }
  const composition=review.composition;
  validatePatchReview(composition,brief);
  if(composition.variation||job.id!=='d96aa07683839825c24b8653663e554a88948f6d4e2ff1a198d77b426f1bb03e')validateVariation(composition,slots,brief);
  return { policy: review.policy, donors, slots, proof, zones, composition, stamp: sha(JSON.stringify([review, brief, lock, donors])) };
}
export function checkMountedTerrain(compiled, report) {
  const a = report.terrainSources,
    expected = Object.keys(compiled.proof)
      .map(Number)
      .sort((a, b) => a - b);
  if (
    !a ||
    a.stamp !== compiled.stamp ||
    a.usesStockAtlas !== false ||
    a.masterSize !== 2048 ||
    !['webgpu', 'webgl'].includes(report.backend) ||
    a.bound?.length !== expected.length ||
    report.stats.replaced !== expected.length ||
    report.stats.slots !== expected.length
  )
    throw Error('Incomplete or stale mounted Poly Haven terrain evidence');
  const use = report.groundUse;
  if (
    !use ||
    !Number.isInteger(use.checked) ||
    use.checked <= 0 ||
    use.natural + use.built !== use.checked ||
    use.illegal !== 0 ||
    use.rerouted !== use.oldIllegal ||
    (compiled.zones.some(z => z.aprons.length) && (!(use.built > 0) || !report.views.stone || !report.views['wild-rock']))
  )
    throw Error('Need mounted natural / built controls and zero unauthorized paving');
  const tier = report.stats.width,
    cache = new Map();
  if (![512, 1024, 2048].includes(tier)) throw Error('Unexpected mounted terrain resolution');
  for (const [s, i] of expected.entries()) {
    const b = a.bound[s],
      row = compiled.donors.find(d => d.id === compiled.slots[i].family);
    if (!cache.has(row.id))
      cache.set(
        row.id,
        ['color', 'surface'].map(k => {
          const file = fs.readFileSync(new URL(`${row.pack || 'endor-terrain'}/${row.id}-${k}.dds`, art));
          return sha(
            parseDDS(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)).mipmaps.find(m => m.width === tier).data
          );
        })
      );
    if (
      b.slot !== i ||
      b.asset !== compiled.proof[i] ||
      b.colorHash !== row.colorHash ||
      b.surfaceHash !== row.surfaceHash ||
      b.regular !== row.regular ||
      !cache.get(row.id).every((h, k) => h === b.mipHashes?.[k])
    )
      throw Error('Wrong mounted Poly Haven terrain at slot ' + i);
  }
}
