// Verify exactly the bytes returned. For ranges on movies/audio, memoize hashes of
// blocks from a successful full SHA-256 pass. A Steam update with the same file
// length/mtime still cannot substitute even one requested block of another revision.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const block = 256 * 1024, maxBytes = 4 * 1024 * 1024, maxEntries = 1024;
const proofs = new Map();
let bytes = 0;
const hash = b => createHash('sha256').update(b).digest();
function remember(sha, proof) {
  if (proof.length > maxBytes) return;
  while (proofs.size >= maxEntries || bytes + proof.length > maxBytes) {
    const first = proofs.keys().next().value;
    bytes -= proofs.get(first).length;
    proofs.delete(first);
  }
  proofs.set(sha, proof);
  bytes += proof.length;
}
function fill(fd, target, at) {
  for (let done = 0; done < target.length;) {
    const n = fs.readSync(fd, target, done, target.length - done, at + done);
    if (!n) throw Error('Source changed during read.');
    done += n;
  }
  return target;
}
export function readVerified(entry, sha, size, start = 0, length = size - start) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > size)
    throw RangeError('Invalid pack byte range');
  const fd = fs.openSync(entry.file || entry.meg, 'r');
  try {
    const at = entry.off ?? 0, stat = fs.fstatSync(fd);
    if (entry.size !== size || !stat.isFile() || (entry.off === undefined ? stat.size !== size : at + size > stat.size))
      throw Error('Source length changed.');
    if (!start && length === size) {
      const result = fill(fd, Buffer.allocUnsafe(size), at);
      if (hash(result).toString('hex') !== sha) throw Error('Digest mismatch.');
      return result;
    }
    const saved = proofs.get(sha), count = Math.ceil(size / block), result = Buffer.allocUnsafe(length);
    const full = saved ? null : createHash('sha256');
    const table = !saved && count * 32 <= maxBytes ? Buffer.allocUnsafe(count * 32) : null;
    const scratch = Buffer.allocUnsafe(Math.min(size, block));
    for (let i = saved ? Math.floor(start / block) : 0, n = saved ? Math.ceil((start + length) / block) : count; i < n; i++) {
      const pos = i * block, part = fill(fd, scratch.subarray(0, Math.min(block, size - pos)), at + pos);
      full?.update(part);
      if (saved && !hash(part).equals(saved.subarray(i * 32, (i + 1) * 32))) throw Error('Block digest mismatch.');
      if (table) hash(part).copy(table, i * 32);
      const lo = Math.max(pos, start), hi = Math.min(pos + part.length, start + length);
      if (hi > lo) part.copy(result, lo - start, lo - pos, hi - pos);
    }
    if (full && full.digest('hex') !== sha) throw Error('Digest mismatch.');
    if (table) remember(sha, table);
    return result;
  } finally { fs.closeSync(fd); }
}
