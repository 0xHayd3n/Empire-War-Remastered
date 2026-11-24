// Still previews only. The worker owns one immutable profile/revision/viewport and keeps
// its loaded planet instances between selections. The caller serializes requests.
import * as THREE from '../../vendor/three/build/three.module.js';
import { renderGalacticScenes, placeGalacticModel } from './galacticscenes.js';
import { RouteBatches } from './routebatch.js';
import { routeAxes } from './galacticroutes.js';
import { GalacticModelFade } from './galacticfade.js';
let renderer, canvas, quad, namespace;
const planets = new Map(),
  ringStyles = new Map(),
  laneTextures = new Map();
// On the shared lanes-only path a filename is never an asset identity. Resolve in the
// selected kit, then share only identical bytes. No dynamic pack VFS is mounted here.
async function lanePalette(kit, dds) {
  const palette = new Map();
  await Promise.all(
    Object.entries(kit).map(async ([name, bytes]) => {
      if (!bytes) return;
      if (!laneTextures.has(bytes))
        laneTextures.set(
          bytes,
          dds.textureFromBytes(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)).buffer).catch(() => dds.whiteTexture())
        );
      palette.set(name, await laneTextures.get(bytes));
    })
  );
  return name => palette.get(name) || dds.whiteTexture();
}
// Normalized screen-space bounds of the visible mesh parts, including billboards. These
// travel with the cached still so zoom and pan only transform rectangles, not models.
function modelRect(root, camera) {
  root.updateMatrixWorld(true);
  const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    mvp = new THREE.Matrix4(),
    box = new THREE.Box3(),
    screen = new THREE.Box3();
  root.traverseVisible(o => {
    if (o.geometry?.boundingBox) screen.union(box.copy(o.geometry.boundingBox).applyMatrix4(mvp.multiplyMatrices(vp, o.matrixWorld)));
  });
  if (!screen.isEmpty()) return [(1 + screen.min.x) / 2, (1 - screen.max.y) / 2, (1 + screen.max.x) / 2, (1 - screen.min.y) / 2];
}
self.onmessage = async ({ data: q }) => {
  let batch;
  const attached = [];
  try {
    const shared = q.pass === 'lanes' && !!q.laneKit;
    const ns = (shared || q.keepSkyContext ? ['resolved-lanes', q.w, q.h] : [q.profile, q.revision, q.w, q.h]).join(':');
    if (namespace && namespace !== ns) throw Error('Preview mount changed');
    namespace = ns;
    if (!shared) globalThis.SWR_BASE = `${location.origin}/api/universal/art/${q.profile}/${q.revision}/`;
    globalThis.SWR_OVERLAY = { read: async () => undefined };
    const [models, dds] = await Promise.all([q.pass === 'lanes' ? null : import('../model.js'), import('../dds.js')]);
    const texture = shared ? await lanePalette(q.laneKit, dds) : n => dds.loadTexture(n, { repeat: false });
    canvas ??= new OffscreenCanvas(q.w, q.h);
    renderer ??= new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const scenes = Array.from({ length: 4 }, () => new THREE.Scene()),
      cam = new THREE.PerspectiveCamera(45, q.w / q.h, 1, 20000),
      view = q.view;
    cam.fov = view.fov;
    cam.updateProjectionMatrix();
    cam.up.set(0, 0, 1);
    cam.position.set(...view.eye);
    cam.lookAt(...view.target);
    cam.updateMatrixWorld();
    if (models) {
      const { lighting, planetLighting } = models,
        L = q.camera.light;
      lighting.sunDir.value.fromArray(L.direction);
      lighting.sunColor.value.setScalar(L.intensity);
      lighting.sunSpecular.value.setScalar(2 * L.intensity);
      lighting.ambient.value.setScalar(0.05);
      lighting.fillColor.value.setScalar(0);
      lighting.fillColor2.value.setScalar(0);
      for (const key of Object.keys(planetLighting)) planetLighting[key].value.copy(lighting[key].value);
    }
    let placed = 0,
      reused = 0;
    const materials = [],
      bounds = [];
    await Promise.all(
      (q.pass === 'lanes' ? [] : [...q.worlds, ...q.scenery]).map(async (p, i) => {
        const [, , , , , file, scale, layer, excluded] = p;
        if (!file) return;
        const world = i < q.worlds.length,
          type = { num: () => scale, bool: () => excluded };
        let inst = world && planets.get(p[0]);
        if (inst) reused++;
        else {
          inst = await models.loadModel(file, { alts: world ? [0, 1, 2] : false });
          if (!inst) return;
          new GalacticModelFade(inst, type, layer === 1);
          for (const [n, meshes] of (inst.alts || []).entries())
            if (meshes) for (const m of meshes) m.visible = n === 0 && !m.userData.hiddenByDefault;
          if (world) planets.set(p[0], inst);
        }
        placeGalacticModel(inst.root, { pos: p.slice(2, 5), type });
        attached.push(inst.root);
        scenes[layer].add(inst.root);
        if (inst.billboards.length) models.updateBillboards(inst, cam);
        inst.root.traverse(o => {
          if (o.material?.userData.ready) materials.push(o.material.userData.ready);
        });
        if (world) {
          const box = modelRect(inst.root, cam);
          if (box) bounds.push(box);
          placed++;
        }
      })
    );
    // Seed the native background pass with the opaque, pre-rendered pixels. Blit them
    // verbatim before routes/planets: additive and modulate materials need their real destination.
    if (q.backplate) {
      const texture = new THREE.Texture(q.backplate);
      texture.generateMipmaps = false;
      texture.minFilter = texture.magFilter = THREE.NearestFilter;
      texture.needsUpdate = true;
      quad = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.RawShaderMaterial({
          uniforms: { plate: { value: texture } },
          depthTest: false,
          depthWrite: false,
          vertexShader:
            'attribute vec3 position; attribute vec2 uv; varying vec2 v; void main(){v=vec2(uv.x,1.0-uv.y);gl_Position=vec4(position.xy,0.,1.);}',
          fragmentShader: 'precision highp float; uniform sampler2D plate; varying vec2 v; void main(){gl_FragColor=texture2D(plate,v);}'
        })
      );
      quad.frustumCulled = false;
    }
    if (quad) scenes[1].add(quad);
    if (q.pass === 'backdrop') {
      await Promise.all(materials);
      await dds.texturesReady();
      renderGalacticScenes(renderer, cam, ...scenes);
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({ bitmap }, [bitmap]);
      return;
    }
    batch = new RouteBatches(scenes[0], texture, l =>
      /ADDITIVE$/.test(l.mode)
        ? THREE.AdditiveBlending
        : /MODULATE$/.test(l.mode)
          ? THREE.MultiplyBlending
          : l.mode === 'OPAQUE'
            ? THREE.NoBlending
            : THREE.NormalBlending
    );
    const routes = q.routes.map(([a, b, i]) => {
      const A = q.worlds[a].slice(2, 5),
        B = q.worlds[b].slice(2, 5);
      return { A, B, axes: routeAxes(A, B), look: q.looks[i] };
    });
    batch.build(routes);
    const ring = q.overlay?.ring && texture(q.overlay.ring);
    await Promise.all(materials);
    if (!shared) await dds.texturesReady();
    for (const rt of routes) {
      const l = rt.look;
      batch.setQuad(rt, l.width || rt.quad.group.mesh.material.uniforms.map.value.image?.height || 1, ...l.out);
      batch.setSparkColor(rt, 0, 0, 0, 0);
    }
    batch.flush();
    if (!placed && q.pass !== 'lanes') throw Error('No planet models');
    renderGalacticScenes(renderer, cam, ...scenes);
    if (ring?.image?.width > 1) {
      // Gameplay's G_PLANET_RING is a screen-space texture tinted to the visible owner.
      const hud = new THREE.Scene(),
        screen = new THREE.OrthographicCamera(0, q.w, q.h, 0, 0.1, 10);
      screen.position.z = 1;
      const scale = Math.min(q.w / 1024, q.h / 768) * q.overlay.scale,
        styles = ringStyles;
      view.labels.forEach(([u, v], i) => {
        const color = q.colors[i],
          key = [ring.uuid, q.overlay.alpha, color].join(':');
        if (!styles.has(key))
          styles.set(
            key,
            new THREE.SpriteMaterial({
              map: ring,
              color: new THREE.Color(color).convertLinearToSRGB(),
              opacity: q.overlay.alpha,
              transparent: true,
              depthTest: false,
              depthWrite: false
            })
          );
        const s = new THREE.Sprite(styles.get(key));
        s.position.set(u * q.w, (1 - v) * q.h, 0);
        const diameter = q.pass === 'lanes' ? q.ringDiameter : ring.image.width * scale;
        s.scale.set(diameter, (diameter * ring.image.height) / ring.image.width, 1);
        hud.add(s);
        const du = s.scale.x / (2 * q.w),
          dv = s.scale.y / (2 * q.h);
        bounds.push([u - du, v - dv, u + du, v + dv]);
      });
      renderer.autoClear = false;
      renderer.render(hud, screen);
    }
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ bitmap, placed, reused, routes: routes.length, bounds }, [bitmap]);
  } catch (e) {
    self.postMessage({ error: e.message });
  } finally {
    for (const root of attached) root.removeFromParent();
    quad?.removeFromParent();
    batch?.clear();
    // The quad texture retains its source for the life of this worker. Terminating the
    // worker releases the renderer, model caches and bitmap together.
    if (q.pass === 'backdrop' && !q.keepSkyContext) {
      renderer?.dispose();
      renderer?.forceContextLoss();
    }
  }
};
