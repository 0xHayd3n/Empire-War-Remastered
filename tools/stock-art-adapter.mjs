// Preflight for a reference-only adapter, not a mod packer or a replacement gameplay mount.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openGame } from './megfs.mjs';
import { readLibrary } from './workshop-library.mjs';

export const targets = Object.freeze(['EV_STARDESTROYER.ALO', 'RV_XWING.ALO', 'EV_AT-AT.ALO']);
const hash = data => createHash('sha256').update(data).digest('hex');
const art = /^Data\/Art\/(?:Models\/[A-Za-z0-9_-]+\.(?:ALO|ALA)|Textures\/[A-Za-z0-9_-]+\.(?:DDS|TGA))$/i;
const exact = (o, keys) =>
  o && !Array.isArray(o) && typeof o === 'object' && Object.keys(o).sort().join('|') === [...keys].sort().join('|');
// Reviewed by a maintainer, *outside* the submitted manifest. Key = exact binding fingerprint;
// value = {credit, terms, compatibility}. No real third-party model has been cleared for this pilot.
const reviewed = new Map();
export function bindingID(r) {
  return hash(
    JSON.stringify([r.edition, r.target, r.workshop, r.model, r.files.map(f => [f.path, f.sha256]).sort((a, b) => (a[0] < b[0] ? -1 : 1))])
  );
}
export function readAdapter(directory) {
  const members = fs.readdirSync(directory, { withFileTypes: true });
  if (members.length !== 1 || members[0].name !== 'adapter.json' || !members[0].isFile())
    throw Error('Distributable must contain only adapter.json (no payloads, links, archives or subfolders).');
  const file = path.join(directory, 'adapter.json');
  if (fs.statSync(file).size > 65536) throw Error('Oversized adapter');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    !exact(doc, ['format', 'bindings']) ||
    doc.format !== 'stock-art-references/1' ||
    !Array.isArray(doc.bindings) ||
    doc.bindings.length > targets.length * 2
  )
    throw Error('Unknown adapter format');
  const slots = new Set();
  for (const r of doc.bindings) {
    if (
      !exact(r, ['edition', 'target', 'workshop', 'model', 'files']) ||
      !['eaw', 'foc'].includes(r.edition) ||
      !targets.includes(r.target) ||
      typeof r.workshop !== 'string' ||
      !/^\d{1,20}$/.test(r.workshop) ||
      typeof r.model !== 'string' ||
      !/^Data\/Art\/Models\/[a-z0-9_-]+\.alo$/i.test(r.model) ||
      !Array.isArray(r.files) ||
      !r.files.length ||
      r.files.length > 64
    )
      throw Error('Invalid stock binding');
    const slot = r.edition + ':' + r.target,
      names = new Set();
    if (slots.has(slot)) throw Error('Duplicate stock slot');
    slots.add(slot);
    for (const f of r.files) {
      if (
        !exact(f, ['path', 'sha256']) ||
        typeof f.path !== 'string' ||
        f.path.length > 200 ||
        !art.test(f.path) ||
        typeof f.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(f.sha256) ||
        names.has(f.path.toUpperCase())
      )
        throw Error('Invalid art dependency');
      names.add(f.path.toUpperCase());
    }
    if (!r.files.some(f => f.path === r.model)) throw Error('Donor model not pinned');
  }
  return doc.bindings;
}
const status = (r, reason) => ({ edition: r.edition, target: r.target, status: 'stock', reason });
// Test injection for a locally authored fixture. The CLI never takes a review list from a mod or caller.
export function preflight(r, library, reviews = reviewed) {
  const grant = reviews.get(bindingID(r));
  if (!grant?.credit || !grant.terms || !grant.compatibility) return status(r, 'No reviewed permission and compatibility record');
  const item = library.items.get(r.workshop);
  if (!item?.folder || library.ambiguous?.has(r.workshop)) return status(r, 'Required Workshop item missing or ambiguous');
  let mount;
  try {
    const root = fs.realpathSync(item.folder);
    mount = openGame(null, [root]); // this item's live files only; never a stock or cached pack fallback
    for (const f of r.files) {
      const key = f.path.replaceAll('/', '\\').toUpperCase(),
        e = mount.index.get(key);
      if (!e) return status(r, 'Dependency missing: ' + f.path);
      const rel = path.relative(root, fs.realpathSync(e.file || e.meg));
      if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || e.size > 64 * 1024 * 1024)
        return status(r, 'Dependency outside allowed source or size');
      if (hash(mount.read(key)) !== f.sha256) return status(r, 'Dependency changed: ' + f.path);
    }
    // This is an eligibility result, not a game activation. Do not return artwork or on-disk paths.
    return {
      edition: r.edition,
      target: r.target,
      status: 'eligible',
      workshop: r.workshop,
      model: r.model,
      credit: grant.credit,
      terms: grant.terms
    };
  } catch {
    return status(r, 'Dependency unavailable');
  } finally {
    mount?.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node tools/stock-art-adapter.mjs <reference-only adapter directory>');
    const bindings = readAdapter(process.argv[2]);
    const library = bindings.length ? readLibrary() : null;
    console.table(
      ['eaw', 'foc'].flatMap(edition =>
        targets.map(target => {
          const r = bindings.find(b => b.target === target && b.edition === edition);
          return r ? preflight(r, library) : status({ edition, target }, 'No mapping');
        })
      )
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
