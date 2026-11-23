// A single still of the game's overview. No galaxy, Lua, ticks, fleets or gameplay document.
// Each worker gets one immutable VFS namespace; terminating it also discards model and texture caches.
import * as THREE from '../../vendor/three/build/three.module.js';
import { renderGalacticScenes, placeGalacticModel } from './galacticscenes.js';
import { RouteBatches } from './routebatch.js';
import { routeAxes } from './galacticroutes.js';
import { GalacticModelFade } from './galacticfade.js';
self.onmessage = async ({ data: q }) => {
  let renderer;
  try {
    globalThis.SWR_BASE = `${location.origin}/api/universal/art/${q.profile}/${q.revision}/`;
    globalThis.SWR_OVERLAY = { read: async () => undefined };
    const [{ loadModel, updateBillboards, lighting, planetLighting }, { loadTexture, texturesReady }] = await Promise.all([
      import('../model.js'),
      import('../dds.js')
    ]);
    const canvas = new OffscreenCanvas(q.w, q.h);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
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
    const L = q.camera.light;
    lighting.sunDir.value.fromArray(L.direction);
    lighting.sunColor.value.setScalar(L.intensity);
    lighting.sunSpecular.value.setScalar(2 * L.intensity);
    lighting.ambient.value.setScalar(0.05);
    lighting.fillColor.value.setScalar(0);
    lighting.fillColor2.value.setScalar(0);
    for (const key of Object.keys(planetLighting)) planetLighting[key].value.copy(lighting[key].value);
    let placed = 0;
    const materials = [];
    await Promise.all(
      [...q.worlds, ...q.scenery].map(async (p, i) => {
        const [, , , , , file, scale, layer, excluded] = p;
        if (!file) return;
        const inst = await loadModel(file, { alts: i < q.worlds.length ? [0, 1, 2] : false });
        if (!inst) return;
        const type = { num: () => scale, bool: () => excluded };
        placeGalacticModel(inst.root, { pos: p.slice(2, 5), type });
        new GalacticModelFade(inst, type, layer === 1);
        for (const [n, meshes] of (inst.alts || []).entries())
          if (meshes) for (const m of meshes) m.visible = n === 0 && !m.userData.hiddenByDefault;
        scenes[layer].add(inst.root);
        if (inst.billboards.length) updateBillboards(inst, cam);
        inst.root.traverse(o => {
          if (o.material?.userData.ready) materials.push(o.material.userData.ready);
        });
        if (i < q.worlds.length) placed++;
      })
    );
    // Seed the native background pass with the opaque, pre-rendered pixels. Blit them
    // verbatim before routes/planets: additive and modulate materials need their real destination.
    if (q.backplate) {
      const texture = new THREE.Texture(q.backplate);
      texture.generateMipmaps = false;
      texture.minFilter = texture.magFilter = THREE.NearestFilter;
      texture.needsUpdate = true;
      const quad = new THREE.Mesh(
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
      scenes[1].add(quad);
    }
    if (q.pass === 'backdrop') {
      await Promise.all(materials);
      await texturesReady();
      renderGalacticScenes(renderer, cam, ...scenes);
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({ bitmap }, [bitmap]);
      return;
    }
    const batch = new RouteBatches(
      scenes[0],
      n => loadTexture(n, { repeat: false }),
      l =>
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
    const ring = q.overlay?.ring && loadTexture(q.overlay.ring, { repeat: false });
    await Promise.all(materials);
    await texturesReady();
    for (const rt of routes) {
      const l = rt.look;
      batch.setQuad(rt, l.width || rt.quad.group.mesh.material.uniforms.map.value.image?.height || 1, ...l.out);
      batch.setSparkColor(rt, 0, 0, 0, 0);
    }
    batch.flush();
    if (!placed) throw Error('No planet models');
    renderGalacticScenes(renderer, cam, ...scenes);
    if (ring?.image?.width > 1) {
      // Gameplay's G_PLANET_RING is a screen-space texture tinted to the visible owner.
      const hud = new THREE.Scene(),
        screen = new THREE.OrthographicCamera(0, q.w, q.h, 0, 0.1, 10);
      screen.position.z = 1;
      const scale = Math.min(q.w / 1024, q.h / 768) * q.overlay.scale,
        styles = new Map();
      view.labels.forEach(([u, v], i) => {
        const color = q.colors[i];
        if (!styles.has(color))
          styles.set(
            color,
            new THREE.SpriteMaterial({
              map: ring,
              color: new THREE.Color(color).convertLinearToSRGB(),
              opacity: q.overlay.alpha,
              transparent: true,
              depthTest: false,
              depthWrite: false
            })
          );
        const s = new THREE.Sprite(styles.get(color));
        s.position.set(u * q.w, (1 - v) * q.h, 0);
        s.scale.set(ring.image.width * scale, ring.image.height * scale, 1);
        hud.add(s);
      });
      renderer.autoClear = false;
      renderer.render(hud, screen);
    }
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ bitmap, placed }, [bitmap]);
  } catch (e) {
    self.postMessage({ error: e.message });
  } finally {
    q.backplate?.close();
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
};
