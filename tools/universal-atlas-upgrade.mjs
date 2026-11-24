// Add small rule/texture metadata to a private index without re-baking its art.
import { parentPort, workerData } from 'node:worker_threads';
import { openGame } from './megfs.mjs';
import { loadPack } from './universal-library.mjs';
import { laneKit } from './universal-lane-kit.mjs';
import { productionPayment } from './universal-rule-catalog.mjs';
const { home, id, game, folder, language, lanes } = workerData,
  pack = id === 'stock' ? null : loadPack(home, id, folder),
  archive = openGame(game, [], { packedLayer: pack?.entries, language });
try {
  parentPort.postMessage({ payment: productionPayment(archive, pack), ...(lanes ? { laneKit: laneKit(archive, lanes) } : {}) });
} finally {
  archive.close();
}
