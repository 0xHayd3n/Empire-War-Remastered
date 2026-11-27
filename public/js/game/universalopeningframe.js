import { overviewView } from './universalviewcamera.js';
import { planetDiameter } from './universalplanetart.js';

// Used by the title preloader and the live board. These are preview-only inputs;
// never open the campaign, tactical map or a second game document to produce a still.
export function chartPasses(chart, p, m, worlds, w, h) {
  const ref = chart.reference,
    factor = Math.min(2, 2560 / w, 2048 / h),
    W = Math.max(1, Math.round(w * factor)),
    H = Math.max(1, Math.round(h * factor)),
    view = overviewView(worlds, ref.camera, w, h, chart.frame),
    base = { profile: p.id, revision: p.revision, w: W, h: H, camera: p.camera, view };
  return {
    W,
    H,
    view,
    backdrop: { ...base, profile: ref.id, revision: ref.revision, camera: ref.camera, pass: 'backdrop', worlds: [], scenery: chart.sky },
    query: (backplate, crop) => ({
      ...base,
      pass: p.sheets ? 'lanes' : 'worlds',
      laneKit: p.laneKit,
      ringDiameter: ((planetDiameter + 2.5) * W) / w,
      worlds,
      backplate,
      overlay: p.overlay,
      colors: m.worlds.map(([, o]) => p.facts[o]?.color || '#bbb'),
      scenery: [],
      routes: m.routes,
      looks: p.looks,
      crop
    })
  };
}

export function renderPass(query, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./universalviewworker.js', import.meta.url), { type: 'module' });
    const clean = () => {
      worker.terminate();
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      clean();
      reject(signal.reason);
    };
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => {
      clean();
      data.error ? reject(Error(data.error)) : resolve(data);
    };
    worker.onerror = e => {
      clean();
      reject(Error(e.message));
    };
    try {
      worker.postMessage(query);
    } catch (e) {
      clean();
      reject(e);
    }
  });
}

// At most three opening maps per title session. The owning menu drops them on
// disposal; outstanding boards hold their own references until they go away.
const openings = new WeakMap();
export function openingFrame(profiles) {
  return openings.get(profiles);
}
export function rememberFrame(profiles, frame) {
  openings.set(profiles, frame);
}
export function forgetFrame(profiles, frame) {
  if (openings.get(profiles) === frame) openings.delete(profiles);
}
