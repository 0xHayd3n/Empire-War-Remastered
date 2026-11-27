// Add small rule/texture metadata to a private index without re-baking its art.
import { campaignPresence } from './campaign-presence.mjs';
import { parentPort, workerData } from 'node:worker_threads';
import { openGame } from './megfs.mjs';
import { loadPack } from './universal-library.mjs';
import { laneKit } from './universal-lane-kit.mjs';
import { combatCatalog } from './universal-combat-catalog.mjs';
import { loadCampaignData } from '../public/js/game/galaxy.js';
import { productionPayment, constructionTime } from './universal-rule-catalog.mjs';
const { home, id, game, folder, language, lanes } = workerData,
  pack = id === 'stock' ? null : loadPack(home, id, folder),
  archive = openGame(game, [], { packedLayer: pack?.entries, language });
try {
  globalThis.fetch = async input => {
    const pathname = new URL(String(input), 'http://local/').pathname;
    const b = archive.read(archive.resolve(decodeURIComponent(pathname.replace(/^\/asset\//, ''))));
    return new Response(b || null, { status: b ? 200 : 404 });
  };
  const { campaigns } = await loadCampaignData();
  parentPort.postMessage({
    presence: campaignPresence(campaigns,workerData.facts,workerData.targets),
    combat: combatCatalog(archive, pack, campaigns),
    payment: productionPayment(archive, pack),
    buildTime: constructionTime(archive, pack),
    ...(lanes ? { laneKit: laneKit(archive, lanes) } : {})
  });
} finally {
  archive.close();
}
