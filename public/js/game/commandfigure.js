// A real, posed infantry figure. Never show the bind pose, a texture stand-in,
// or a model from the active battlefield in place of the revision named here.
import * as THREE from 'three';
import { loadModel } from '../model.js';
import { standaloneFileTexture } from '../dds.js';
import { loadALA, AnimState } from '../ala.js';
import { DeployMotion } from './deploy-motion.js';
import { previewMaterial } from './previewmaterial.js';

export const artPath = (r, f) => `UXA${r.art.profile || r.p.id}_${r.art.revision || r.p.revision}__${f}`;
// Once per figure, measure the visible, already-skinned infantry. Bind boxes
// contain hidden helmets/weapons; a synchronous GPU pixel read stalls the carousel.
function posedBounds(inst) {
  const box = new THREE.Box3(),
    vert = new THREE.Vector3(),
    pt = new THREE.Vector3();
  const skins = new Map(inst.skins.map(s => [s.mesh, s.mats]));
  inst.root.traverseVisible(o => {
    if (!o.isMesh || o.material.userData.additive) return;
    const g = o.geometry,
      p = g.attributes.position,
      mats = skins.get(o),
      ix = g.attributes.skinIndex?.array,
      wt = g.attributes.skinWeight?.array;
    for (let i = 0; i < p.count; i++) {
      vert.fromBufferAttribute(p, i);
      if (mats && ix && wt) {
        pt.set(0, 0, 0);
        const { x, y, z } = vert;
        for (let j = i * 4; j < i * 4 + 4; j++) {
          const a = wt[j];
          if (!a) continue;
          const k = 16 * ix[j];
          pt.x += a * (mats[k] * x + mats[k + 4] * y + mats[k + 8] * z + mats[k + 12]);
          pt.y += a * (mats[k + 1] * x + mats[k + 5] * y + mats[k + 9] * z + mats[k + 13]);
          pt.z += a * (mats[k + 2] * x + mats[k + 6] * y + mats[k + 10] * z + mats[k + 14]);
        }
      } else pt.copy(vert);
      box.expandByPoint(pt.applyMatrix4(o.matrixWorld));
    }
  });
  return box;
}
// Both displays consume this exact idle, equipment, geometry and isolated
// material set. Framing and movement belong to the caller, not the source.
export async function commandBody(r, depth) {
  const { art } = r;
  if (!art?.idle || !art.infantry) throw Error('No verified animated infantry');
  const [inst, idle] = await Promise.all([loadModel(artPath(r, art.model), { fresh: true }), loadALA(artPath(r, art.idle))]);
  if (!inst || !(idle?.frames > 1)) throw Error('Missing figure or pose');
  // Some heroes include a second full-body cloak overlay, visible in the ALO
  // by default. The ring is not a battle using stealth or hologram abilities.
  for (const [mesh, g] of inst.meshByName) if (/(?:STEALTH|CLOAK|HOLOCRON|MUZZLE.*FLASH)/i.test(mesh)) g.visible = false;
  const motion = new DeployMotion(inst, [idle]);
  if ((motion.stand?.bound.length || 0) < 4) throw Error('Idle does not bind to this skeleton');
  const box = posedBounds(inst),
    height = box.max.z - box.min.z;
  if (!Number.isFinite(height) || height < 0.01) throw Error('Empty infantry silhouette');
  // Frame the person, not the length of the blaster. The prop inherits its
  // socket's native transform and follows every subsequent pose. Use the same
  // signed art source as the body, including for cross-pack illustrations.
  await Promise.all(
    (art.props || []).map(async ({ model, bone }) => {
      const socket = inst.bone(bone);
      if (!socket) return;
      const prop = await loadModel(artPath(r, model), { fresh: true });
      if (!prop) throw Error('Missing verified equipment: ' + model);
      for (const [mesh, g] of prop.meshByName) if (/MUZZLE.*FLASH/i.test(mesh)) g.visible = false;
      prop.syncFromBones();
      prop.root.userData.commandProp = model;
      socket.add(prop.root);
    })
  );
  const needed = new Set(),
    materials = new Map();
  inst.root.traverseVisible(o => {
    for (const key of ['map', 'normalMap', 'glossMap']) {
      const t = o.material?.uniforms?.[key]?.value;
      if (t?.isTexture) needed.add(t);
    }
  });
  const owned = new Map(await Promise.all([...needed].map(async t => [t, await standaloneFileTexture(t)])));
  inst.root.traverse(o => {
    if (!o.isMesh || !o.material.uniforms?.map) return;
    const src = o.material;
    if (!materials.has(src)) {
      const m = previewMaterial(src, owned, depth);
      m.uniforms.ringLight = { value: 1 };
      m.uniforms.ringAlpha = { value: 1 };
      m.userData.stageTransparent = m.transparent;
      // Additive battle shaders assume an opaque framebuffer. On a transparent
      // stage their black texels must not cut rectangular holes into the scenery.
      m.fragmentShader =
        'uniform float ringLight, ringAlpha;\n' +
        m.fragmentShader.replace(
          /}\s*$/,
          `gl_FragColor.rgb *= ringLight;\n${src.userData.additive ? 'gl_FragColor.a=clamp(max(max(gl_FragColor.r,gl_FragColor.g),gl_FragColor.b),0.,1.); gl_FragColor.rgb *= ringAlpha;' : ''}\ngl_FragColor.a *= ringAlpha;\n}`
        );
      if (src.userData.additive) {
        m.blendSrcAlpha = THREE.OneFactor;
        m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      }
      materials.set(src, m);
    }
    o.material = materials.get(src);
    o.frustumCulled = false;
  });
  return {
    inst,
    motion,
    box,
    materials,
    dispose() {
      inst.root.removeFromParent();
      for (const m of materials.values()) m.dispose();
      for (const t of owned.values()) t?.dispose();
    }
  };
}
export async function commandFigure(r, depth) {
  const body = await commandBody(r, depth),
    { inst, motion, box, materials } = body,
    height = box.max.z - box.min.z,
    { art } = r;
  const root = new THREE.Group(),
    pivot = new THREE.Group(),
    anchor = new THREE.Group();
  root.add(pivot);
  pivot.add(anchor);
  anchor.add(inst.root);
  const center = box.getCenter(new THREE.Vector3());
  anchor.position.set(-center.x, -center.y, -box.min.z);
  // A calibrated actor keeps the source pack's relative stature on the same
  // floor, in every ring position. The stage camera never fits to this actor.
  pivot.scale.setScalar(art.ringUnits ?? 1 / height);
  pivot.rotation.z = -0.32;
  let level = -1,
    action = null,
    focusToken = 0;
  return {
    root,
    motion,
    bound: motion.stand.bound.length,
    model: art.model,
    idle: art.idle,
    actionName: null,
    alpha: 0,
    fade(n) {
      this.alpha = n;
      for (const m of materials.values()) {
        m.transparent = m.userData.stageTransparent || n < 1;
        m.uniforms.ringAlpha.value = n;
      }
    },
    light(n) {
      if (Math.abs(n - level) < 0.015) return;
      level = n;
      for (const m of materials.values()) {
        m.uniforms.ringLight.value = n;
      }
    },
    focus(reduced) {
      const token = ++focusToken;
      action = null;
      this.actionName = null;
      if (reduced) return;
      // An authored second idle/salute/ready animation is preferred. While it
      // loads (or if absent) the rig makes a short surveying turn over its idle.
      motion.active = null;
      motion.next = motion.time;
      this.actionName = 'survey';
      if (art.action)
        Promise.resolve(loadALA(artPath(r, art.action)))
          .then(clip => {
            if (token !== focusToken || !clip || clip.frames < 3) return;
            const state = new AnimState(inst, clip);
            if (state.bound.length < 4) return;
            action = state;
            this.actionName = art.action;
          })
          .catch(() => {});
    },
    blur() {
      focusToken++;
      action = null;
      this.actionName = null;
      motion.active = null;
      motion.next = motion.time + 14;
      motion.step(0);
    },
    tick(dt) {
      if (action) {
        if (!action.step(dt)) {
          action = null;
          motion.step(0);
        }
      } else motion.step(dt);
    },
    dispose() {
      focusToken++;
      root.removeFromParent();
      body.dispose();
    }
  };
}
