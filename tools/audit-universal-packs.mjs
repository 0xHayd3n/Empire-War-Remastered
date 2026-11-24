// Read-only inventory of the generated mini-mods. Never calls entry.ensure():
// auditing a thin pack must not copy an asset, consult Steam, or alter an origin.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { libraryHome, listPacks, loadPack } from './universal-library.mjs';

function hashFile(file, buffer) {
  const fd = fs.openSync(file, 'r'),
    hash = createHash('sha256');
  try {
    for (let n; (n = fs.readSync(fd, buffer)) > 0; ) hash.update(buffer.subarray(0, n));
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}
export function auditPacks(home, { verify = false } = {}) {
  const packs = listPacks(home).filter(p => p.ready),
    objects = new Map();
  let references = 0,
    masks = 0,
    logicalBytes = 0,
    withinProfileBytes = 0,
    crossProfileBytes = 0,
    distinctBytes = 0;
  for (const { id } of packs) {
    const seen = new Set();
    for (const e of loadPack(home, id).entries.values()) {
      if (!e) {
        masks++;
        continue;
      }
      const sha = path.basename(e.file);
      references++;
      logicalBytes += e.size;
      if (objects.has(sha) && objects.get(sha).size !== e.size) throw Error('Pack manifests disagree on object size.');
      if (seen.has(sha)) withinProfileBytes += e.size;
      else if (objects.has(sha)) {
        crossProfileBytes += e.size;
        objects.get(sha).profiles++;
      } else {
        distinctBytes += e.size;
        objects.set(sha, { size: e.size, profiles: 1 });
      }
      seen.add(sha);
    }
  }
  const root = path.join(home, 'objects'),
    buffer = verify && Buffer.allocUnsafe(1024 * 1024);
  let cachedObjects = 0,
    cachedBytes = 0,
    verifiedObjects = 0,
    unreferencedObjects = 0,
    unexpectedEntries = 0,
    invalidObjects = 0;
  // Walk actual files, not just references: this also finds stray copies. Ignore
  // neither noncanonical names nor corrupt contents; report them without unlinking.
  if (fs.existsSync(root)) {
    if (!fs.lstatSync(root).isDirectory()) throw Error('Expected an object directory.');
    for (const shard of fs.readdirSync(root, { withFileTypes: true })) {
      if (!shard.isDirectory() || !/^[a-f0-9]{2}$/.test(shard.name)) {
        unexpectedEntries++;
        continue;
      }
      for (const e of fs.readdirSync(path.join(root, shard.name), { withFileTypes: true })) {
        if (!e.isFile() || !/^[a-f0-9]{64}$/.test(e.name) || e.name.slice(0, 2) !== shard.name) {
          unexpectedEntries++;
          continue;
        }
        const file = path.join(root, shard.name, e.name),
          size = fs.statSync(file).size,
          wanted = objects.get(e.name);
        cachedObjects++;
        cachedBytes += size;
        if (!wanted) unreferencedObjects++;
        if ((wanted && wanted.size !== size) || (verify && hashFile(file, buffer) !== e.name)) invalidObjects++;
        else if (verify) verifiedObjects++;
      }
    }
  }
  return {
    profiles: packs.length,
    references,
    masks,
    logicalBytes,
    distinctObjects: objects.size,
    distinctBytes,
    sharedAcrossProfiles: [...objects.values()].filter(x => x.profiles > 1).length,
    crossProfileBytes,
    withinProfileBytes,
    cachedObjects,
    cachedBytes,
    verifiedObjects,
    unreferencedObjects,
    unexpectedEntries,
    invalidObjects
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some(x => x !== '--verify')) throw Error('Usage: npm run universal:audit [-- --verify]');
  const report = auditPacks(libraryHome(), { verify: args.includes('--verify') });
  console.log(JSON.stringify(report, null, 2));
  if (!report.profiles || report.invalidObjects || report.unexpectedEntries) process.exitCode = 1;
}
