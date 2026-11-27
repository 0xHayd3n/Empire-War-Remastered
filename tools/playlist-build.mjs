import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Source checkouts all say BUILD='dev'. Fingerprint the served runtime (including lockstep WASM), not a
// local directory, git branch name or machine timestamp. Production builds already have a revision.
export async function playlistBuild(root) {
  const hash = createHash('sha256');
  async function visit(dir) {
    const entries = await readdir(path.join(root, dir), { withFileTypes: true });
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const file = dir ? dir + '/' + e.name : e.name;
      if (e.isDirectory()) await visit(file);
      else if (e.isFile() && /\.(js|wasm)$/.test(e.name)) {
        const raw = await readFile(path.join(root, file));
        // Git's CRLF checkout mode should not split otherwise identical Windows and Linux runtimes.
        const bytes = file.endsWith('.js') ? Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n')) : raw;
        hash.update(file + '\0' + bytes.length + '\0').update(bytes);
      }
    }
  }
  await visit('');
  return hash.digest('hex');
}
