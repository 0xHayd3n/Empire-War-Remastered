// Private stills from the same equipped, posed body as the ring. No portrait
// TGA, battlefield unit, or downloaded image is a substitute for this figure.
import * as THREE from 'three';
import { commandBody } from './commandfigure.js';

// One composition at card resolution; desktop/mobile share the same PNG. Only
// the card camera changes framing, never the ring's scale or head animation.
const WIDTH = 360,
  HEIGHT = 240,
  ASPECT = WIDTH / HEIGHT;
const clamp = THREE.MathUtils.clamp;
export function commandHeadshotKey(p, art) {
  if (!p?.id || !art?.model || !art?.idle || !(art.revision || p.revision)) return null;
  return JSON.stringify([
    p.id,
    p.revision,
    art.profile || p.id,
    art.revision || p.revision,
    art.model,
    art.idle,
    (art.props || []).map(({ model, bone }) => [model, bone])
  ]);
}

function frameCamera(camera, { inst, box }, ringUnits) {
  const h = box.max.z - box.min.z,
    centre = box.getCenter(new THREE.Vector3()),
    bone = inst.bone('B_Head') || inst.bone('Head'),
    at = bone?.getWorldPosition(new THREE.Vector3());
  // Use the skull joint, not the highest vertex (Gunray's mitre, Mandalore's
  // raised axe, or a trooper's antenna). Without a head joint, crop the
  // upper torso itself, e.g. the B2's integrated sensor or Jerec's older rig.
  const head = at && at.z > box.min.z + h * 0.55 && at.z <= box.max.z + 0.02 * h;
  const rise = head ? clamp(box.max.z - at.z, h * 0.08, h * 0.2) : h * 0.14;
  const bust = clamp(2.6 * rise, h * 0.32, h * 0.43);
  // Keep a short actor from becoming a giant head on a card. Give him the
  // same frame in physical units, letting more of his equipped body show.
  const crop = ringUnits ? bust / (h * ringUnits) : bust;
  if (head) centre.copy(at);
  // Let a tall hat or blade bleed out of the print before pushing the face
  // below its middle. Shorter hats still get a little air above their crown.
  centre.z = Math.min(box.max.z - bust * 0.44, head ? at.z - bust * 0.1 : Infinity);
  camera.up.set(0, 0, 1);
  camera.position.copy(centre).addScaledVector(new THREE.Vector3(-0.34, -1, 0.08).normalize(), h * 2.5);
  camera.lookAt(centre);
  camera.left = -crop * ASPECT * 0.6;
  camera.right = crop * ASPECT * 0.4;
  camera.top = crop / 2;
  camera.bottom = -camera.top;
  camera.near = h * 0.01;
  camera.far = h * 6;
  camera.updateProjectionMatrix();
}

function studio() {
  const gl = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' }),
    depth = new THREE.DepthTexture(1, 1),
    scene = new THREE.Scene(),
    camera = new THREE.OrthographicCamera();
  gl.outputColorSpace = THREE.LinearSRGBColorSpace;
  gl.setSize(WIDTH, HEIGHT, false);
  gl.setClearColor(0, 0);
  depth.compareFunction = THREE.LessEqualCompare;
  depth.needsUpdate = true;
  return {
    async bake(r, wanted) {
      const body = await commandBody(r, depth);
      try {
        if (!wanted()) return null;
        scene.add(body.inst.root);
        frameCamera(camera, body, r.art.ringUnits);
        if (gl.getContext().isContextLost()) throw Error('Lost portrait context');
        gl.render(scene, camera);
        const blob = await new Promise(resolve => gl.domElement.toBlob(resolve, 'image/png'));
        if (!blob || gl.getContext().isContextLost()) throw Error('No portrait pixels');
        return blob;
      } finally {
        body.dispose();
      }
    },
    dispose() {
      depth.dispose();
      gl.dispose();
      gl.forceContextLoss();
    }
  };
}

export function commandHeadshots() {
  const cache = new Map(),
    cooldown = new Map(),
    cards = new Map(),
    queue = new Map();
  let oven = null,
    busy = null,
    timer = 0,
    dead = false;
  const observer = new IntersectionObserver(
    entries => {
      for (const { target, isIntersecting } of entries) {
        const r = cards.get(target);
        if (!r) continue;
        r.visible = isIntersecting;
        if (isIntersecting && busy !== r.key) queue.set(r.key, r);
      }
      pump();
    },
    { rootMargin: '180px 0px' }
  );
  const audience = key => [...cards].filter(([img, r]) => r.key === key && r.visible && img.isConnected && img.getClientRects().length);
  function settle(img, url) {
    observer.unobserve(img);
    cards.delete(img);
    img.dataset.headshot = url ? 'ready' : 'unavailable';
    if (url) img.src = url;
    else img.removeAttribute('src'); // Keep its faction mark, label and controls.
  }
  function bind(img, p, id) {
    if (dead) return;
    const art = p.commanders?.[id]?.stage,
      key = commandHeadshotKey(p, art);
    const hit = cache.get(key);
    img.dataset.headshotKey = key || '';
    if (hit) {
      cache.delete(key);
      cache.set(key, hit); // LRU
      return settle(img, hit);
    }
    if (!key || (cooldown.get(key) || 0) > performance.now()) return settle(img, null);
    img.removeAttribute('src');
    img.dataset.headshot = 'pending';
    cards.set(img, { key, p, art, visible: false });
    observer.observe(img);
  }
  function release() {
    clearTimeout(timer);
    oven?.dispose();
    oven = null;
  }
  async function pump() {
    if (busy || dead || document.hidden) return;
    while (queue.size && !dead && !document.hidden) {
      const [key, r] = queue.entries().next().value;
      queue.delete(key);
      if (!audience(key).length) continue;
      busy = key;
      clearTimeout(timer);
      try {
        let url = cache.get(key);
        if (!url) {
          oven ||= studio();
          const blob = await oven.bake(r, () => !dead && !document.hidden && audience(key).length);
          if (!blob || dead) continue;
          url = URL.createObjectURL(blob);
          cache.set(key, url);
          if (cache.size > 80) {
            const oldest = cache.keys().next().value;
            URL.revokeObjectURL(cache.get(oldest));
            cache.delete(oldest);
          }
          cooldown.delete(key);
        }
        for (const [img, rec] of cards) if (rec.key === key) settle(img, url);
      } catch (err) {
        if (dead) return;
        cooldown.set(key, performance.now() + 15000);
        for (const [img, rec] of cards) if (rec.key === key) settle(img, null);
        console.warn('Commander card:', r.art.model, err.message);
        release(); // A lost context cannot poison the next figure.
      } finally {
        busy = null;
      }
    }
    if (!dead) {
      clearTimeout(timer);
      timer = setTimeout(release, 1200);
    }
  }
  function resume() {
    if (document.hidden || dead) return;
    for (const r of cards.values()) if (r.visible && r.key !== busy) queue.set(r.key, r);
    pump();
  }
  document.addEventListener('visibilitychange', resume);
  function reset(root) {
    // Both the team sidebar and the directory use this bank. Rebuilding one
    // surface must not strand pending renders on the other, or evict its PNGs.
    if (root) {
      for (const img of cards.keys())
        if (root.contains(img)) {
          observer.unobserve(img);
          cards.delete(img);
        }
      const remaining = new Set([...cards.values()].map(r => r.key));
      for (const key of queue.keys()) if (!remaining.has(key)) queue.delete(key);
    } else {
      observer.disconnect();
      cards.clear();
      queue.clear();
    }
  }
  return {
    bind,
    reset,
    dispose() {
      dead = true;
      reset();
      release();
      document.removeEventListener('visibilitychange', resume);
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
      cooldown.clear();
    }
  };
}
