import { assertPrivateLibrary, buildPack, libraryHome, primaries } from './universal-library.mjs';
import { readLibrary } from './workshop-library.mjs';
const args = process.argv.slice(2),
  materialize = args.includes('--materialize'),
  ids = args.filter(a => a !== '--materialize');
if (ids.some(id => !primaries.has(id))) throw new Error('Expected a supported primary Workshop ID, or --materialize.');
const lib = readLibrary(),
  home = libraryHome(),
  unique = new Map();
assertPrivateLibrary(home, lib);
let count = 0,
  bytes = 0;
for (const id of ids.length ? new Set(ids) : primaries.keys()) {
  const item = lib.items.get(id);
  if (!item) {
    if (ids.length) throw new Error('Parent not installed: ' + id);
    console.log(`Not installed: ${primaries.get(id)}`);
    continue;
  }
  if (lib.ambiguous?.has(id)) throw new Error('Multiple installs of primary ' + id + '; resolve before building.');
  console.log(`Indexing ${primaries.get(id)}...`);
  const { rows } = buildPack(home, id, item.folder, { materialize });
  for (const [, sha, size] of rows)
    if (sha !== null) {
      unique.set(sha, size);
      bytes += size;
    }
  console.log(`Ready: ${rows.length} virtual paths`);
  count++;
}
const uniqueBytes = [...unique.values()].reduce((a, b) => a + b, 0);
console.log(
  JSON.stringify({ profiles: count, logicalBytes: bytes, distinctBytes: uniqueBytes, duplicateBytes: bytes - uniqueBytes, materialize })
);
if (!count) process.exitCode = 1;
