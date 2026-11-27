// A work packet, not a recipe. Reuse source bytes, never another map's decisions.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parseDDS } from '../../public/js/dds.js';
import { decodeDXT } from '../../public/js/ddsdecode.js';
import { placeInputs, briefDraft } from './reference-worklist.mjs';
const here = fileURLToPath(new URL('./', import.meta.url)),
  art = path.resolve(here, '../../public/art');
const read = f => JSON.parse(fs.readFileSync(f)),
  write = (f, data) => fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n');
const sha = b => createHash('sha256').update(b).digest('hex'),
  token = /^[a-z0-9][a-z0-9_-]*$/;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const url = f => esc(pathToFileURL(f).href),
  link = (f, s) => `<a href="${url(f)}">${esc(s)}</a>`;

// Native scan candidates from actual four-channel ledgers. Decode flat albedo, not a ball or height alpha.
// An unrelated broken pack is a flagged library miss, not a reason to invent a substitute.
function swatches(out) {
  const { PNG } = createRequire(import.meta.url)('pngjs'),
    seen = new Set(),
    images = [],
    misses = [];
  const ledger = path.join(here, 'terrain');
  for (const file of fs
    .readdirSync(ledger)
    .filter(n => /^[a-f0-9]{64}\.json$/.test(n))
    .sort()) {
    const r = read(path.join(ledger, file));
    if (r.policy !== 'polyhaven-2k' || !token.test(r.pack)) continue;
    for (const f of r.families) {
      const pack = f.reuse || r.pack,
        key = `${pack}/${f.id}`;
      if (seen.has(key)) continue;
      try {
        if (![pack, f.id, f.asset].every(k => token.test(k))) throw Error('Invalid identifier');
        const dir = path.join(art, pack),
          source = read(path.join(art, r.pack, 'sources.json'))[f.asset];
        if (
          source?.page !== `https://polyhaven.com/a/${f.asset}` ||
          !['color', 'height', 'normal', 'roughness'].every(k => /^[a-f0-9]{64}$/.test(source.inputs[k]?.sha256))
        )
          throw Error('Missing input lock');
        const index = read(path.join(dir, 'materials.json'));
        if (pack === 'endor-terrain') index.push(read(path.join(dir, 'paving.json')));
        const row = index.find(m => m.id === f.id && m.asset === f.asset);
        if (!row) throw Error('Missing cooked pair');
        let mip;
        for (const k of ['color', 'surface']) {
          const bytes = fs.readFileSync(path.join(dir, `${f.id}-${k}.dds`));
          if (sha(bytes) !== row[k + 'Hash'] || bytes.toString('ascii', 84, 88) !== 'DXT5') throw Error(`Changed ${k}`);
          const d = parseDDS(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
          if (d.width !== 2048 || d.height !== 2048 || d.mipmaps.length !== 12) throw Error('Incomplete mip chain');
          if (k === 'color') mip = d.mipmaps.find(m => m.width === 256);
        }
        const png = new PNG({ width: 256, height: 256 });
        png.data = Buffer.from(decodeDXT(mip.data, 256, 256, 5));
        for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
        const name = `${pack}-${f.id}.png`;
        fs.writeFileSync(path.join(out, name), PNG.sync.write(png));
        images.push({
          pack,
          id: f.id,
          asset: f.asset,
          tileMeters: row.tileMeters,
          page: source.page,
          image: name,
          colorHash: row.colorHash,
          surfaceHash: row.surfaceHash
        });
        seen.add(key);
      } catch (e) {
        misses.push({ key, reason: e.message });
      }
    }
  }
  return { images, misses };
}
export function draftSlots(job, r) {
  if (r.job !== job.id || r.state !== 'baseline-only' || r.trial || r.errors?.length || r.unreadable?.length || !r.inventory?.slots?.length)
    throw Error('Need fresh, readable, mounted original inventory');
  const slots = r.inventory.slots;
  if (
    slots.length !== r.activeSlots.length ||
    new Set(slots.map(s => s.slot)).size !== slots.length ||
    !r.activeSlots.every(i => slots.some(s => s.slot === i))
  )
    throw Error('Incomplete drawn slot inventory');
  return slots.map(s => {
    const j = job.slots[s.slot],
      pin = job.identity.slots[s.slot];
    if (
      !j?.texture?.hash ||
      j.texture.hash !== pin?.[2] ||
      s.texture !== j.texture.name ||
      s.vertices !== j.vertices ||
      (j.bump?.hash ?? null) !== (pin[4] ?? null) ||
      (j.bump?.name || null) !== (s.bump || null)
    )
      throw Error('Changed inventory: ' + s.slot);
    return { ...s, diffuseHash: pin[2], bumpHash: pin[4], family: null, use: null, reason: null };
  });
}
export async function prepare(job, home, capture, refs) {
  const root = path.join(home, 'prep', job.id);
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'run-'));
  const start = performance.now(),
    packet = { kind: 'scouting-only', job: job.id, startedAt: new Date().toISOString(), state: 'blocked', stages: {} };
  const timed = async (key, fn) => {
    const t = performance.now();
    try {
      return await fn();
    } finally {
      packet.stages[key] = +(0.001 * (performance.now() - t)).toFixed(2);
    }
  };
  try {
    const stages = await Promise.allSettled([
      timed('mountedStock', capture),
      timed('references', refs),
      timed('localLibrary', () => swatches(dir))
    ]);
    if (stages[0].status === 'fulfilled') packet.stock = stages[0].value;
    if (stages[1].status === 'fulfilled') packet.references = stages[1].value.paths.board;
    const failures = stages.flatMap((s, i) =>
      s.status === 'rejected' ? [['stock', 'references', 'library'][i] + ': ' + s.reason.message] : []
    );
    if (failures.length) throw Error(failures.join('; '));
    const [folder, reference, library] = stages.map(s => s.value),
      r = read(path.join(folder, 'report.json')),
      slots = draftSlots(job, r);
    packet.stock = folder;
    packet.references = reference.paths.board;
    packet.library = library;
    packet.slots = slots;
    packet.inventory = { props: r.inventory.props, foot: r.inventory.foot, sites: r.inventory.sites };
    const photos = placeInputs(job, reference, home);
    packet.photoCount = photos.length;
    write(path.join(dir, 'place-candidates.json'), photos);
    write(path.join(dir, 'brief-draft.json'), briefDraft(job, reference.planet?.name || job.planet));
    packet.environments = job.environments;
    packet.outskirts = job.outskirtsIntake;
    packet.board = path.join(dir, 'prep.html');
    const fig = (f, title) =>
      `<figure><a href="${url(f)}"><img loading="lazy" src="${url(f)}" alt="${esc(title)}"></a><figcaption>${esc(title)}</figcaption></figure>`;
    const grid = contents => `<section>${contents.join('')}</section>`;
    fs.writeFileSync(
      packet.board,
      `<!doctype html><meta charset="utf-8"><title>Scout · ${esc(job.file)}</title><style>body{font:16px system-ui;margin:24px;color:#eee;background:#242628}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:12px}figure{margin:0}img{width:100%;max-height:260px;object-fit:contain}a{color:#afe0fd}td,th{padding:3px 12px;text-align:left}small{color:#ddd}</style><h1>${esc(job.file)} · scout</h1><p>${link(packet.references, 'Inspect location references')} · ${link(path.join(dir, 'packet.json'), 'Slot worksheet, source hashes and timing')} · ${link(path.join(folder, 'report.json'), 'Fresh mounted stock receipt')}</p><p>Candidate sources, no chosen families or release approval. Inspect the places and compare the grain at physical scale before choosing any cook.</p>` +
        grid(
          Object.keys(r.views)
            .map(v => fig(path.join(folder, v + '-original.png'), v))
            .concat(fig(path.join(folder, 'painted-sources.png'), 'Drawn original diffuse, indexed by TED slot'))
        ) +
        `<h2>Drawn slots</h2><table><tr><th>Slot</th><th>Original diffuse / bump</th><th>Vertices</th><th>Grade p10 / median / p90</th><th>TED tilt (rad)</th></tr>${slots.map(s => `<tr><td>${s.slot}</td><td>${esc(s.texture)} / ${esc(s.bump || '—')}</td><td>${s.vertices}</td><td>${s.grade?.map(n => n.toFixed(2)).join(' / ') || 'not painted'}</td><td>${Number(s.tilt || 0).toFixed(2)}</td></tr>`).join('')}</table><p>Grade is rise/run, not an inferred art role. Actual construction requires a receipt.</p>` +
        `<h2>Props and authored skies</h2><p>${r.inventory.props.map(p => `${p.count} × ${esc(p.model)} @ ${esc(p.example.join(', '))}`).join(' · ')}</p><p>${job.environments.map(e => esc(`${e.name}: ${e.weather || 'no weather scenario'}`)).join(' · ')}</p>` +
        `<h2>Location research</h2><p>${link(path.join(dir, 'place-candidates.json'), 'Source URLs, verified hashes and local files')} · ${link(path.join(dir, 'brief-draft.json'), 'Empty brief with authored skies')}. Inspect suitable places individually. Earth analogues describe physical conditions, not fictional architecture.</p>` +
        grid(photos.map((p, i) => fig(p.localFile, `${i + 1}. ${p.type} · ${new URL(p.page).pathname}`))) +
        `<h2>Available flat scans</h2>` +
        grid(library.images.map(d => fig(path.join(dir, d.image), `${d.asset} · ${d.tileMeters} m · ${d.pack}/${d.id}`))) +
        `<p>${esc(library.misses.map(x => `${x.key}: ${x.reason}`).join('; '))}</p>`
    );
    packet.state = 'needs-inspection';
    return packet;
  } catch (e) {
    packet.reason = e.message;
    throw Error(`${e.message} (packet: ${dir})`, { cause: e });
  } finally {
    packet.seconds = +(0.001 * (performance.now() - start)).toFixed(2);
    write(path.join(dir, 'packet.json'), packet);
  }
}
