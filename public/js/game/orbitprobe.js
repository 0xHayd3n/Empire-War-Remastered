import * as THREE from 'three';
import { filterFinishAtlas } from '../finishatlas.js';
import { SKY_FACES } from '../skyreflect.js';
import { measureOrbitFaces } from '../orbitcolor.js';

// Read the actual map once, not the camera viewport or the fleet. The same diffuse probe serves every hull.
function backdrop(view, exclude) {
  const planets = new THREE.Scene(), ready = new Set();
  const textures = mesh => {
    for (const u of Object.values(mesh.material?.uniforms || {})) if (u.value?.isTexture && u.value.userData.ready) ready.add(u.value.userData.ready);
  };
  view.bgScene.traverseVisible(textures);
  view.scene.traverseVisible(m => {
    if (m===exclude || !m.isMesh || !m.material.uniforms?.orbitalAir) return;
    textures(m);
    m.updateWorldMatrix(true, false);
    const copy = new THREE.Mesh(m.geometry, m.material);
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(m.matrixWorld);
    planets.add(copy);
  });
  return { planets, ready };
}

async function sample(view, r, token) {
  const SIZE = token.finish ? 48 : 24;
  const { planets, ready } = backdrop(view, token.exclude);
  await Promise.allSettled(ready);
  if (view.orbitProbes !== token.cache) return;
  const target = new THREE.WebGLRenderTarget(6 * SIZE, SIZE, { generateMipmaps: false });
  const eye = new THREE.PerspectiveCamera(90, 1, 1, Math.max(view.skyFar, 1e7));
  const px = new Uint8Array(SIZE*SIZE*6*4);
  function draw() {
    const kept = r.getRenderTarget(), auto = r.autoClear;
    const centers = view.skydomes.map(s => s.root.position.clone());
    const wasDeep = view.spaceBackdrop.deep;
    try {
      view.spaceBackdrop.use(token.deep);
      r.autoClear = false;
      for (const s of view.skydomes) s.root.position.set(0,0,0);
      target.viewport.set(0,0,6*SIZE,SIZE);
      r.setRenderTarget(target);
      r.clear();
      SKY_FACES.forEach(([x,y,z,ux,uy,uz], i) => {
        eye.up.set(ux,uy,uz);
        eye.lookAt(x,y,z);
        eye.updateMatrixWorld(true);
        target.viewport.set(SIZE*i,0,SIZE,SIZE);
        r.setRenderTarget(target);
        r.render(view.bgScene,eye);
        if (planets.children.length) r.render(planets,eye);
      });
    } finally {
      view.spaceBackdrop.use(wasDeep);
      view.skydomes.forEach((s,i) => s.root.position.copy(centers[i]));
      r.setRenderTarget(kept);
      r.autoClear = auto;
    }
  }
  try {
    draw();
    // The custom WebGPU renderer compiles pipelines for this single-sample target asynchronously.
    if (r.pendingPipelines?.().length) {
      r.endFrame();
      await r.settle();
      if (view.orbitProbes !== token.cache) return;
      draw();
    }
    await r.readRenderTargetPixelsAsync(target,0,0,6*SIZE,SIZE,px);
    if (view.orbitProbes === token.cache) {
      if (!token.finish) token.faces = measureOrbitFaces(px,SIZE);
      else {
        // Offscreen GPU glDepth flips clip Y to give this atlas the same row order as GL.
        const t = new THREE.DataTexture(filterFinishAtlas(px,SIZE),6*SIZE,3*SIZE);
        t.minFilter=t.magFilter=THREE.LinearFilter; t.needsUpdate=true;
        token.texture=t;
      }
    }
  } finally { target.dispose(); }
}

export function clearOrbitProbes(view) {
  for (const slot of view.orbitProbes?.slots || []) slot?.texture?.dispose();
  view.orbitProbes=view.orbitProbe=null;
  view.separatePlanet=undefined;
}
function probeCache(view,r) {
  if(view.orbitProbes?.renderer!==r){clearOrbitProbes(view);view.orbitProbes={renderer:r,slots:[]};}
  return view.orbitProbes;
}
export function finishProbe(view,r,deep) {
  const cache=probeCache(view,r), i=2+Number(deep);
  if(!cache.slots[i]) {
    const token=cache.slots[i]={cache,deep,finish:true};
    token.ready=sample(view,r,token).catch(error=>console.warn('Hull reflections unavailable; retaining detailed surfaces.',error));
  }
  return cache.slots[i];
}
export function bindOrbitProbe(view,r,lighting,deep = false) {
  const exclude=view.separatePlanet, cache = probeCache(view,r), i = Number(deep)+(exclude ? 4 : 0);
  if (!cache.slots[i]) {
    const token = cache.slots[i] = { cache, deep, exclude, faces:null };
    token.ready = sample(view,r,token).catch(error => console.warn('Orbital sky unavailable; using corrected hull lighting.',error));
  }
  view.orbitProbe = cache.slots[i];
  bindSkyFaces(lighting, view.orbitProbe.faces);
}
export function bindSkyFaces(lighting, f) {
  if (f) {
    lighting.orbitDir.value.fromArray(f,18);
    lighting.orbitRadiance.value.fromArray(f,21);
  } else lighting.orbitRadiance.value.set(0,0,0);
  for (let axis=0; axis<3; axis++) for (let channel=0; channel<3; channel++) {
    lighting.orbitPos.value.elements[3*axis+channel] = f?.[6*axis+channel] || 0;
    lighting.orbitNeg.value.elements[3*axis+channel] = f?.[6*axis+3+channel] || 0;
  }
}
