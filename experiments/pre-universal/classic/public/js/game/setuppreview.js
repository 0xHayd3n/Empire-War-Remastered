import { loadMapPreview, loadSpaceBounds } from '../ted.js';
import { isDynamic, dynamicSize } from './dynamicmap.js';

// One small cache per mounted page. Keep pending work too: a click during
// preloading joins that read. Never cache a live lobby, draft or battle world.
function recent(load) {
  const entries = new Map();
  return (key, ...args) => {
    let job = entries.get(key);
    if (!job) {
      job = load(...args).catch(() => {
        if (entries.get(key) === job) entries.delete(key);
        return null;
      });
    }
    entries.delete(key);
    entries.set(key, job);
    if (entries.size > 8) entries.delete(entries.keys().next().value);
    return job;
  };
}
const picture = recent(loadMapPreview);
const bounds = recent(loadSpaceBounds);
export const setupPreview = (file, teams, instant = false) => {
  teams = Math.max(2, teams);
  return file ? picture(isDynamic(file) ? `${file}|${teams}|${instant}` : file, file, { teams, instant }) : Promise.resolve(null);
};
export function entryBounds(file) {
  if (!file) return Promise.resolve(null);
  if (!isDynamic(file)) return bounds(file, file);
  const half = dynamicSize(file).half;
  return Promise.resolve({ min: { x: -half, y: -half }, max: { x: half, y: half } });
}
// A mounted canvas belongs to its screen, not to the preview cache.
export function copyPreview(source) {
  const canvas = source.cloneNode(false);
  canvas.getContext('2d').drawImage(source, 0, 0);
  return canvas;
}
