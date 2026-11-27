// Standalone after extracting the builder ZIP. Requires Node.js 22+. No npm, network or install writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openGame } from './megfs.mjs';
import { buildProfile } from '../public/js/texture-showcase/build.js';
const [game, second, ...extra] = process.argv.slice(2);
const endor = second === '--endor', mod = endor ? null : second;
if (!game || (extra.length && (extra.length !== 1 || extra[0] !== '--refit' || !mod)))
  throw Error('Usage: node tools/texture-showcase-cli.mjs "GOLD INSTALL FOLDER" [--endor | "FALL OF THE REPUBLIC FOLDER" [--refit]]');
const profile = endor ? 'stock-endor' : mod ? (extra.length ? '1976399102-refit' : '1976399102') : 'stock',
  roots = [game, ...(mod ? [mod] : [])].map(p => fs.realpathSync(p)),
  temp = fs.realpathSync(os.tmpdir());
for (const root of roots) {
  const rel = path.relative(root, temp);
  if (rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep)))
    throw Error('Choose a temporary folder outside game and mod installs.');
}
const v = openGame(roots[0], roots.slice(1));
try {
  const zip = await buildProfile(
    profile,
    file => {
      const key = v.resolve('Data/Art/Textures/' + file);
      return key ? v.read(key) : null;
    },
    file => console.log('Building', file)
  );
  const dir = fs.mkdtempSync(path.join(temp, 'eaw-textures-')),
    out = path.join(dir, 'showcase-' + profile + '.zip');
  fs.writeFileSync(out, zip, { flag: 'wx', mode: 0o600 });
  console.log('Private ZIP:', out);
  console.log('Import it in the matching Universal profile: Settings > Video > Graphics Quality > Enhanced texture pack.');
} finally {
  v.close();
}
