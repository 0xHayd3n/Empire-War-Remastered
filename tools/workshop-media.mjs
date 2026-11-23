import fs from 'node:fs';
import path from 'node:path';

// Filenames only. Pictures and tracks stay in the user's local collection, not the web distribution.
const families = {
  '1976399102': ['fotr-collection-banner.png', 'great-jedi-purge.mp3'],
  '1125571106': ['thrawns-revenge-collection-banner.png', 'thrawns-revenge-preview-from-00-30.mp3', 'Thrawn-Theme.mp3'],
  '3417277973': ['revans-revenge-collection-banner-storm-v2.png', 'revans-revenge-preview-from-00-30.mp3', 'Darth-Revan-theme.mp3'],
  '1770851727': ['empire-at-war-remake-collection-banner.png', 'The Imperial March.mp3']
};
const branding = {
  '1976399102': ['fotr-wordmark.png', 'embers'],
  '1125571106': ['thrawns-revenge-wordmark.png', 'fade'],
  '3417277973': ['revans-revenge-wordmark.png', 'storm'],
  '1770851727': ['empire-at-war-remake-wordmark.png']
};
const menu = { '3387971722': 'Battle_Of_The_Heroes_1.mp3', '1397421866': 'MainMenu.mp3' };
export function mediaFile(root, relative, limit) {
  if (!root || !relative) return;
  try {
    const dir = fs.realpathSync.native(root), file = path.resolve(dir, relative);
    if (!file.startsWith(dir + path.sep)) return;
    const real = fs.realpathSync.native(file);
    // Win32 preserves case on lookup, but a case difference is not a junction.
    if (path.relative(file, real) !== '') return;
    const stat = fs.statSync(real);
    if (stat.isFile() && stat.size > 0 && stat.size <= limit) return { file: real, size: stat.size };
  } catch {}
}
export function bindMedia(lib, { local = process.env.LOCALAPPDATA, art = process.env.SWR_COLLECTION_ART || (local && path.join(local, 'EaWBrowserWorkshop', 'collection-art')) } = {}) {
  const music = local && path.join(local, 'ModCollectionLauncher', 'music');
  for (const m of lib.items.values()) {
    const [banner, ...tracks] = families[m.id] || [];
    const pick = (sources, limit) => {
      const pair = sources.find(([dir, name]) => mediaFile(dir, name, limit));
      return pair && [...pair, limit];
    };
    m.backdrop = pick([[art, m.id + '.png'], [art, banner], [m.folder, m.scene]], 16 * 1024 * 1024);
    const [wordmark, effect] = branding[m.id] || [];
    m.wordmark = pick([[art, `${m.id}-wordmark.png`], [art, wordmark]], 8 * 1024 * 1024);
    m.effect = m.backdrop && effect;
    m.theme = pick([[music, m.id + '.mp3'], ...tracks.map(track => [music, track]), [m.folder, menu[m.id] && path.join('Data','Audio','Music',menu[m.id])]], 32 * 1024 * 1024);
  }
  return lib;
}
