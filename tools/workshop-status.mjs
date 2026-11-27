// Read-only snapshots. AppManifest counters belong to app 32470, never to a guessed item.
import fs from 'node:fs';
import path from 'node:path';

// Fixed local Steam files only. Parse the small subset of Valve KeyValues used here; malformed,
// duplicate, oversized or linked manifests contribute no evidence. Never serve raw ACF or paths.
function manifest(root, rel, section) {
  let fd;
  try {
    const file = path.resolve(root, rel);
    if (path.relative(file, fs.realpathSync.native(file)) !== '') return;
    fd = fs.openSync(file, 'r');
    const s = fs.fstatSync(fd);
    if (!s.isFile() || !s.size || s.size > 2_000_000) return;
    const b = Buffer.alloc(s.size);
    if (fs.readSync(fd, b, 0, b.length, 0) !== b.length) return;
    const src = b
        .toString('utf8')
        .replace(/^\uFEFF/, '')
        .trim(),
      rx = /\s*(?:"((?:[^"\\]|\\.)*)"|([{}]))/gy;
    const node = Object.create(null),
      stack = [node];
    let k = null;
    while (rx.lastIndex < src.length) {
      const t = rx.exec(src);
      if (!t) return;
      const top = stack.at(-1);
      if (t[2] === '}') {
        if (k !== null || stack.length === 1) return;
        stack.pop();
      } else if (t[2] === '{') {
        if (k === null || stack.length >= 12) return;
        stack.push((top[k] = Object.create(null)));
        k = null;
      } else if (k === null) {
        k = t[1];
        if (Object.hasOwn(top, k)) return;
      } else {
        top[k] = t[1];
        k = null;
      }
    }
    return stack.length === 1 && k === null && node[section]?.appid === '32470' ? node[section] : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
const uint = n => (typeof n === 'string' && /^\d{1,16}$/.test(n) && Number.isSafeInteger(+n) ? +n : null);
function transfer(app) {
  const flags = uint(app?.StateFlags);
  if (flags === null) return null;
  // EAppState::Downloading. Ignore old BytesDownloaded when idle/staged. Never combine counters across roots.
  if (flags & 0x200) return { state: 'paused' };
  if (flags & 0x100000) {
    const done = uint(app.BytesDownloaded),
      total = uint(app.BytesToDownload);
    return { state: 'downloading', ...(done !== null && total && total >= done ? { done, total } : {}) };
  }
  if (flags & 0x200000) return { state: 'staging' };
  if (flags & 0x400000) return { state: 'committing' };
  if (flags & 2 && uint(app.ScheduledAutoUpdate) > Date.now() / 1000) return { state: 'scheduled' };
  return null;
}
// Commit records are per Steam library. Don't attribute another drive's row to this drive's partial folder.
function receiptRows(roots) {
  const seen = new Map();
  for (const root of roots) {
    const w = manifest(root, 'steamapps/workshop/appworkshop_32470.acf', 'AppWorkshop');
    if (w && w.WorkshopItemsInstalled && typeof w.WorkshopItemsInstalled === 'object')
      seen.set(path.resolve(root, 'steamapps/workshop/content/32470'), w.WorkshopItemsInstalled);
  }
  return m => m && seen.get(path.resolve(path.dirname(m.folder)));
}
export function steamCommits(roots) {
  const rows = receiptRows(roots);
  return m => { const items = rows(m); return items ? /^[1-9]\d{0,19}$/.test(items[m.id]?.manifest) : null; };
}
// Test evidence only: record the installed Steam publication without exposing the ACF or local paths.
export function steamRevision(roots) {
  const rows = receiptRows(roots);
  return m => { const value = rows(m)?.[m?.id]?.manifest; return /^[1-9]\d{0,19}$/.test(value) ? value : null; };
}
export function workshopSnapshot(roots, id) {
  if (typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id) || BigInt(id) > 18446744073709551615n) throw Error('Invalid Workshop item.');
  let acf = false,
    item = null,
    data = false,
    verified = false,
    job = null,
    needed = false;
  for (const root of roots) {
    const w = manifest(root, 'steamapps/workshop/appworkshop_32470.acf', 'AppWorkshop');
    const row = w?.WorkshopItemsInstalled?.[id];
    acf ||= !!w;
    needed ||= w?.NeedsDownload === '1';
    let here = false;
    try {
      const folder = path.join(root, 'steamapps/workshop/content/32470', id);
      here =
        fs.lstatSync(folder).isDirectory() &&
        fs.readdirSync(folder, { withFileTypes: true }).some(e => e.isDirectory() && /^data$/i.test(e.name));
    } catch {}
    data ||= here;
    if (typeof row?.manifest === 'string' && /^[1-9]\d{0,19}$/.test(row.manifest)) {
      item = { size: uint(row.size) };
      verified ||= here;
    }
    job ||= transfer(manifest(root, 'steamapps/appmanifest_32470.acf', 'AppState'));
  }
  return { acf, data, verified, item, job, needed };
}
