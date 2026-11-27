import * as THREE from 'three';
import { finishAtlasRows } from '../finishatlas.js';
import { SKY_FACE, skyTarget } from '../skyreflect.js';
import { daylightFaces } from '../daylight-probe.js';
import { measureOrbitFaces } from '../orbitcolor.js';

// Live sky and planar water still see every forecast sample. Avoid filtering intermediate
// skies that last only a few seconds. Long Workshop fades still get occasional updates.
export function weatherProbeDue(state, color, time, forecast) {
  if (time < state.nextSample) return false;
  if (forecast?.out && (forecast.ease <= 12 || forecast.left < 4 || time < state.nextSample + 12)) return false;
  const last = state.color;
  return Math.max(Math.abs(last.x - color.x), Math.abs(last.y - color.y), Math.abs(last.z - color.z)) > 0.08;
}

// In the window, a 48px cube means over a million directional lookups. Keep
// convolution off the render thread. Retain the small input for exact fallback
// if worker creation or module loading is disallowed. No long-lived worker.
function filteredLandSky(slot, pixels, size) {
  return new Promise(resolve => {
    let worker,
      timer,
      rows,
      done = false;
    function finish(result) {
      if (done) return;
      done = true;
      slot.cancel = null;
      clearTimeout(timer);
      worker?.terminate();
      resolve(result);
    }
    function fallback() {
      if (done || rows) return;
      worker?.terminate();
      worker = null;
      rows = finishAtlasRows(pixels, size);
      function slice() {
        const end = performance.now() + 2;
        for (let i = 0; i < 8; i++) {
          const row = rows.next();
          if (row.done) return finish(row.value);
          if (performance.now() >= end) break;
        }
        timer = setTimeout(slice, 0);
      }
      timer = setTimeout(slice, 0);
    }
    slot.cancel = () => finish(null);
    if (typeof Worker === 'undefined') return fallback();
    try {
      worker = new Worker(new URL('./land-filter-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => finish(e.data);
      worker.onerror = e => {
        e.preventDefault();
        fallback();
      };
      worker.onmessageerror = fallback;
      worker.postMessage({ pixels, size });
    } catch {
      fallback();
    }
  });
}
// The material and diffuse probes can request the same capture in the same draw.
// Share only its pending read: no permanent CPU atlas, and no reuse across captures.
function readSky(view, r, target) {
  const version = view.skyAtlasState?.version,
    sky = view.sky,
    old = view.pendingLandSkyRead;
  if (old?.sky === sky && old.r === r && old.version === version && old.target === target) return old.ready;
  const slot = { sky, r, version, target },
    raw = new Uint8Array(6 * SKY_FACE * SKY_FACE * 4);
  view.pendingLandSkyRead = slot;
  slot.ready = r
    .readRenderTargetPixelsAsync(target, 0, 0, 6 * SKY_FACE, SKY_FACE, raw)
    .then(() => raw)
    .finally(() => {
      if (view.pendingLandSkyRead === slot) view.pendingLandSkyRead = null;
    });
  return slot.ready;
}
// Copy whole RGBA pixels, without creating a typed-array view for each texel.
function subsampleSky(raw, n) {
  const small = new Uint8Array(n * n * 6 * 4),
    src = new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4),
    dst = new Uint32Array(small.buffer);
  for (let y = 0; y < n; y++) {
    const row = Math.floor(((y + 0.5) * SKY_FACE) / n) * 6 * SKY_FACE;
    for (let x = 0; x < 6 * n; x++) dst[y * 6 * n + x] = src[row + Math.floor(((x + 0.5) * SKY_FACE) / n)];
  }
  return small;
}
// Filter the already-warmed six faces, never recapture per object. Ignore delayed readback
// after switching environment, renderer, or leaving the battle.
export function landFinish(view, r, finish = true) {
  const state = view.skyAtlasState,
    t = skyTarget();
  if (!t || state?.left !== 0 || !view.sky.children.length || !r.readRenderTargetPixelsAsync) return null;
  const old = view.landFinish,
    same = old?.sky === view.sky && old.r === r && old.env === view.map.environment && (!finish || old.finish);
  if (same && (old.retryAt === Infinity || performance.now() < old.retryAt)) return finish ? old.texture : null;
  old?.cancel?.();
  old?.texture?.dispose();
  const slot = (view.landFinish = {
    sky: view.sky,
    env: view.map.environment,
    r,
    finish,
    texture: null,
    attempt: same ? old.attempt + 1 : 1,
    retryAt: Infinity
  });
  readSky(view, r, t)
    .then(async raw => {
      if (view.landFinish !== slot || view.sky !== slot.sky) return;
      const n = 48,
        small = subsampleSky(raw, n);
      slot.daylight = daylightFaces(small, n, slot.env);
      if (!finish) return;
      const bytes = await filteredLandSky(slot, small, n);
      if (!bytes || view.landFinish !== slot || view.sky !== slot.sky || view.map.environment !== slot.env) return;
      const tex = new THREE.DataTexture(bytes, 6 * n, 3 * n);
      tex.magFilter = tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      slot.texture = tex;
    })
    .catch(() => {
      // Keep the authored fallback while waiting; don't queue readbacks every frame or
      // let one transient failure disable reflections for the rest of the battle.
      if (view.landFinish === slot && slot.attempt < 3) slot.retryAt = performance.now() + 1000 * slot.attempt;
    });
  return null;
}
// Reuse the ground renderer's existing sky capture. Wait until its texture warm-up is done;
// keep the map's own fill lights while loading, under a render worker without readback, or on failure.
export function landSkyFaces(view, renderer) {
  const target = skyTarget(),
    state = view.skyAtlasState;
  if (!target || state?.left !== 0 || !view.sky.children.length || !renderer.readRenderTargetPixelsAsync) return null;
  if (view.landProbe?.sky === view.sky && view.landProbe.renderer === renderer) return view.landProbe.faces;
  const probe = (view.landProbe = { sky: view.sky, renderer, faces: null });
  readSky(view, renderer, target)
    .then(bytes => {
      if (view.landProbe !== probe) return;
      // Ground maps already include ambient + two directional fills. Add a modest sky bounce,
      // not the full orbital exposure. Subsample the low-frequency signal, not the actual reflection map.
      const n = 16,
        small = subsampleSky(bytes, n);
      const faces = measureOrbitFaces(small, n);
      for (let i = 0; i < faces.length; i++) if (i < 18 || i >= 21) faces[i] *= 0.18;
      probe.faces = faces;
    })
    .catch(() => {});
  return null;
}
