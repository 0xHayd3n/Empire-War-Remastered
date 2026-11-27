import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readVerified } from './verified-pack-read.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verified-range-'));
try {
  const meg = path.join(dir, 'synthetic.meg'), offset = 65, size = 3 * 256 * 1024 + 37;
  const data = Buffer.alloc(size); for (let i = 0; i < size; i++) data[i] = (i * 5) % 251;
  const archived = Buffer.concat([Buffer.alloc(offset), data, Buffer.from('next member')]);
  fs.writeFileSync(meg, archived);
  const sha = createHash('sha256').update(data).digest('hex'), e = { meg, off: offset, size };
  for (const [start, length] of [[262111, 640], [0, 1], [size - 97, 97], [size, 0], [0, size]])
    assert.deepEqual(readVerified(e, sha, size, start, length), data.subarray(start, start + length));
  assert.throws(() => readVerified(e, sha, size, size, 1), /range/);
  assert.throws(() => readVerified(e, '1'.repeat(64), size, 10, 8), /mismatch/);
  archived[offset + 262144] ^= 3; fs.writeFileSync(meg, archived);
  assert.throws(() => readVerified(e, sha, size, 262111, 640), /mismatch/, 'covered blocks are revalidated even when length stays unchanged');
  fs.truncateSync(meg, size); assert.throws(() => readVerified(e, sha, size, 0, 2), /length/);
  console.log('PASS: bounded, verified MEG ranges across blocks, same-length updates, wrong revision and truncation');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
