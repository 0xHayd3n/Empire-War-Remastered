import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const id = s => typeof s === 'string' && /^[1-9]\d{0,19}$/.test(s);
const dirs = p => {
  try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; }
};
function json(file) {
  try { if (fs.lstatSync(file).isFile() && fs.statSync(file).size <= 256_000) return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch {}
}
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
export function steamLibraries() {
  const roots = [process.env.STEAM_PATH, process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'),
    path.join(os.homedir(), '.steam', 'steam'), path.join(os.homedir(), '.local/share/Steam')].filter(Boolean);
  const libraries = new Set();
  for (const p of roots) {
    if (!isDir(p)) continue;
    libraries.add(fs.realpathSync(p));
    try {
      const vdf = fs.readFileSync(path.join(p, 'steamapps/libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) {
        const lib = m[1].replace(/\\\\/g, '\\');
        if (isDir(lib)) libraries.add(fs.realpathSync(lib));
      }
    } catch {}
  }
  return [...libraries];
}
const image = /\.(ico|jpe?g|png|webp)$/i;
function item(folder, key) {
  const entries = dirs(folder);
  if (!entries.some(e => e.isDirectory() && /^data$/i.test(e.name))) return;
  const meta = entries.find(e => e.isFile() && /^modinfo\.json$/i.test(e.name));
  const info = meta && json(path.join(folder, meta.name));
  const name = [info?.name, info?.steamdata?.title].find(s => typeof s === 'string' && s.trim());
  const images = entries.filter(e => e.isFile() && image.test(e.name)).map(e => e.name).sort();
  // Match only enumerated files in this item's root. Never follow a path or URL from mod metadata.
  const icon = String(info?.icon || '').split(/[\\/]/).pop().toLowerCase();
  const art = images.find(n => n.toLowerCase() === icon) || images.find(n => /\.ico$/i.test(n)) || images.find(n => /^(splash|logo)/i.test(n)) || images[0];
  // Scene and identity serve different roles: don't stretch a small ICO into a backdrop.
  const splash = images.find(n => /^splash\.(png|jpe?g|webp)$/i.test(n));
  const battle = path.join('Data', 'Art', 'Textures', 'Loadscreens', 'AAA_New_Space_1.png');
  const scene = splash || (fs.existsSync(path.join(folder, battle)) ? battle : undefined);
  return { id: key, folder, name: name?.trim() || `Workshop ${key}`, art: art && path.join(folder, art), scene };
}

export function readLibrary(libraries = steamLibraries(), profileDir = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ModCollectionLauncher/profiles'), override = process.env.SWR_GAME) {
  const game = [override, ...libraries.map(p => path.join(p, 'steamapps/common/Star Wars Empire at War'))].filter(Boolean)
    .find(p => ['GameData','corruption'].every(d => fs.existsSync(path.join(p, d, 'Data/megafiles.xml'))));
  const items = new Map(), ambiguous = new Set();
  for (const p of libraries) {
    const root = path.join(p, 'steamapps/workshop/content/32470');
    for (const e of dirs(root)) {
      if (!e.isDirectory() || !id(e.name)) continue;
      const mod = item(path.join(root, e.name), e.name);
      if (!mod) continue;
      if (items.has(e.name)) ambiguous.add(e.name);
      else items.set(e.name, mod);
    }
  }
  const cards = [], grouped = new Set();
  let skipped = 0;
  function card(name, primary, order, disabled, saved) {
    const problem = !game ? 'Game installation not found' : order.find(k => !items.has(k) || ambiguous.has(k));
    cards.push({ name, primary, order, disabled, saved, problem: problem && (game ? `${ambiguous.has(problem) ? 'Duplicate' : 'Missing'} item ${problem}` : problem) });
  }
  for (const e of profileDir ? dirs(profileDir) : []) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith('.json')) continue;
    const doc = json(path.join(profileDir, e.name)), p = doc?.profile;
    const validIds = a => Array.isArray(a) && a.length <= 512 && a.every(id) && new Set(a).size === a.length;
    if (doc?.schemaVersion !== 1 || p?.variant !== 'forces-of-corruption' || p.isDraft !== false || !id(p.primaryItemId) ||
        ![p.itemOrder,p.requiredItemIds,p.optionalItemIds,p.disabledItemIds ?? []].every(validIds) || !Array.isArray(p.incompatibilities) || p.incompatibilities.length) { skipped++; continue; }
    const disabled = p.disabledItemIds || [], required = [p.primaryItemId, ...p.requiredItemIds];
    const order = p.itemOrder.filter(k => !disabled.includes(k));
    if (required.some(k => !order.includes(k)) || p.optionalItemIds.some(k => !order.includes(k) && !disabled.includes(k)) ||
        order.some(k => !required.includes(k) && !p.optionalItemIds.includes(k))) { skipped++; continue; }
    const name = typeof p.displayName === 'string' && p.displayName.trim() || items.get(p.primaryItemId)?.name || `Collection ${p.primaryItemId}`;
    card(p.isAutoGenerated && items.get(p.primaryItemId)?.name !== `Workshop ${p.primaryItemId}` ? items.get(p.primaryItemId)?.name || name : name, p.primaryItemId, order, disabled, true);
    for (const k of [...order, ...disabled]) grouped.add(k);
  }
  for (const m of items.values()) if (!grouped.has(m.id)) card(m.name, m.id, [m.id], [], false);
  cards.sort((a,b) => Number(b.saved) - Number(a.saved) || a.name.localeCompare(b.name));
  return { game, items, cards, skipped, ambiguous };
}
