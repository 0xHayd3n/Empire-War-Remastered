import { recipes, digest, refitID } from './recipes.js';
export { digest };
import { rebuildDDS } from './enhance.js';
import { storeZip } from './archive.js';
export async function buildProfile(profile, read, progress = () => {}) {
  if (!Object.hasOwn(recipes, profile)) throw Error('This profile is not in the showcase');
  const rows = [];
  async function source(r) {
    progress(r.file);
    const input = await read(r.file);
    if (!input || (await digest(input)) !== r.source) throw Error('Source is missing or changed: ' + r.file + '. No pack was installed.');
    return input;
  }
  if (profile === refitID) {
    const { refitPair } = await import('./refit.js');
    for (let i = 0; i < recipes[profile].length; i += 2) {
      const [a, b] = recipes[profile].slice(i, i + 2);
      const pair = refitPair(await source(a), await source(b), a, b);
      for (const [j, r] of [a, b].entries()) rows.push(['Data/Art/Textures/' + r.file, pair[j]]);
    }
  } else for (const r of recipes[profile]) rows.push(['Data/Art/Textures/' + r.file, rebuildDDS(await source(r), r)]);
  return storeZip(rows);
}
