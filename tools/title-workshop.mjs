// The Universal window can prepare independent local Workshop stacks. Catalog browsing never mounts one.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { completeOfflinePack } from './universal-atlas.mjs';
import { steamCommits, workshopSnapshot } from './workshop-status.mjs';
import { steamTitles } from './workshop-titles.mjs';
import { readLibrary } from './workshop-library.mjs';
import { bindMedia, mediaFile } from './workshop-media.mjs';

// A playset keeps its save origin between sessions. Never recycle an assignment for another load order.
function reservePort(home, key) {
  const dir = path.join(home, 'workshop-playset-ports');
  fs.mkdirSync(dir, { recursive: true });
  const seed = parseInt(key.slice(0, 8), 16);
  for (let n = 0; n < 1024; n++) {
    const port = 30000 + ((seed + n) % 17000),
      file = path.join(dir, port + '.txt');
    try {
      fs.writeFileSync(file, key, { flag: 'wx' });
      return port;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (fs.readFileSync(file, 'utf8') === key) return port;
    }
  }
  throw Error('No playset port is available.');
}
// Maintainer-reviewed, distinct publications only. Evidence must be the author's explicit
// release statement for this pair. This is trusted code, NOT fields read from modinfo or a client.
// The current six Universal manifests have zero such pairs. See docs/workshop-exchange.md.
const verifiedStrippedEditions = [];
export function titleWorkshop({ home, library, eras, startGame, discover = readLibrary, verifiedEditions = verifiedStrippedEditions }) {
  const editions = new Map();
  for (const { base, native, evidence } of verifiedEditions) {
    if (
      ![base, native].every(id => typeof id === 'string' && /^[1-9]\d{0,19}$/.test(id)) ||
      base === native ||
      editions.has(base) ||
      editions.has(native) ||
      typeof evidence !== 'string' ||
      !evidence.trim()
    )
      throw Error('Invalid verified edition pair.');
    editions.set(base, { nativeId: native });
    editions.set(native, { baseId: base, evidence });
  }
  function installed(m) {
    if (!m) return false;
    // A subscription can disappear between startup, viewing the gallery and preparing an order.
    try {
      return fs.readdirSync(m.folder, { withFileTypes: true }).some(d => d.isDirectory() && /^data$/i.test(d.name));
    } catch {
      return false;
    }
  }
  function playable(pack, id, ambiguous) {
    if (!pack?.ready || !library.game || ambiguous?.has(id)) return false;
    // The host mounts from its startup inventory, not the refreshed Workshop list.
    if (installed(library.items.get(id))) return true;
    try {
      return completeOfflinePack(home, id);
    } catch {
      return false;
    }
  }
  let lib,
    active = new Map();
  const load = () => (lib ||= bindMedia(library));
  let known = new Set();
  function catalog(refresh = false) {
    if (refresh) lib = bindMedia(discover());
    const { items, cards, ambiguous } = load(),
      packs = eras().filter(e => e.id !== 'stock');
    const committed = steamCommits(load().roots || []);
    const saved = cards.filter(c => c.saved);
    const ids = new Set([...packs.map(e => e.id), ...items.keys(), ...saved.flatMap(c => [...c.order, ...c.disabled]), ...editions.keys()]);
    known = ids;
    const mods = [...ids].map(id => {
      const m = items.get(id),
        pack = packs.find(e => e.id === id),
        collections = saved.filter(c => c.order.includes(id) || c.disabled.includes(id));
      const filesPresent = installed(m),
        receipt = committed(m);
      const named = m?.name && m.name !== `Workshop ${id}` ? m.name : null;
      return {
        id,
        name: pack?.name || named || collections.find(c => c.primary === id)?.name || `Workshop ${id}`,
        summary: m?.summary || '',
        version: m?.version || '',
        scene: !!m?.backdrop,
        filesPresent,
        steamVerified: filesPresent && receipt === true,
        clientTarget: !!pack || receipt === true || editions.has(id),
        installed: filesPresent && receipt !== false,
        duplicate: !!ambiguous?.has(id),
        ...editions.get(id),
        pack: !!pack || packs.some(p => p.id === editions.get(id)?.baseId),
        ready: receipt !== false && playable(pack, id, ambiguous),
        art: !!(m?.backdrop || m?.art),
        collections: collections.map(c => c.name)
      };
    });
    return {
      mods,
      gameAvailable: !!load().game,
      clientDetected: (load().roots || []).some(root =>
        ['steam.exe', 'steam.sh', 'Steam.AppBundle/Steam/Contents/MacOS/steam_osx'].some(rel =>
          fs.statSync(path.join(root, rel), { throwIfNoEntry: false })?.isFile()
        )
      ),
      collections: saved.map(c => ({ name: c.name, primary: c.primary, order: c.order, disabled: c.disabled, problem: c.problem || null }))
    };
  }
  const picture = id => {
    const m = load().items.get(id);
    return m && ((m.backdrop && mediaFile(...m.backdrop)) || (m.art && mediaFile(m.folder, path.basename(m.art), 8 * 1024 * 1024)));
  };
  async function prepare(ids) {
    const { items, ambiguous, game, roots } = load();
    const committed = steamCommits(roots || []);
    if (
      !game ||
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 64 ||
      new Set(ids).size !== ids.length ||
      ids.some(
        id =>
          typeof id !== 'string' ||
          !/^[1-9]\d{0,19}$/.test(id) ||
          !items.has(id) ||
          ambiguous?.has(id) ||
          !installed(items.get(id)) ||
          committed(items.get(id)) === false
      )
    )
      throw Error('Choose 1–64 distinct, installed, unambiguous Workshop items. Refresh after changing subscriptions.');
    const sources = ids.map(id => editions.get(id)?.baseId || id);
    if (new Set(sources).size !== ids.length) throw Error('Choose one edition of each mod per playset.');
    if (eras().filter(e => sources.includes(e.id) || ids.includes(e.id)).length > 1)
      throw Error('Choose only one primary overhaul per playset.');
    const key = createHash('sha256')
      .update('foc:' + ids.join(','))
      .digest('hex');
    if (!active.has(key)) {
      if (active.size >= 3) throw Error('Three playsets are open. Save your games and restart Universal to prepare another.');
      const port = reservePort(process.env.SWR_PLAYSET_HOME || home, key);
      active.set(
        key,
        Promise.resolve()
          .then(() => startGame(game, ids.map(id => items.get(id).folder).reverse(), { port }))
          .catch(e => {
            active.delete(key);
            throw e;
          })
      );
    }
    return (await active.get(key)).url;
  }
  return {
    catalog,
    picture,
    prepare,
    status(id) {
      if (!known.has(id)) throw Error('Choose a known item from this catalog.');
      return workshopSnapshot(load().roots || [], id);
    },
    async titles() {
      await steamTitles(load().items);
      return catalog();
    },
    async close() {
      await Promise.allSettled([...active.values()].map(async p => (await p).close()));
    }
  };
}
