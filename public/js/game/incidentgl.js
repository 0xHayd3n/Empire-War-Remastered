import { Material } from 'three';
import { incidentGL, colorEmitter } from '../sceneenergy.js';

// The offscreen color attachment, NOT the global graphics preference, determines the color
// contract. Probes, shadow maps, heat displacement, the UI and post passes remain untouched.
const installed = new WeakSet();
export function canMixLight(r) {
  return !!r.device || !!(r.isWebGLRenderer && r.extensions.has('EXT_color_buffer_float'));
}
export function incidentTargetsGL(r) {
  if (!r.isWebGLRenderer || installed.has(r)) return;
  installed.add(r);
  const cache = new WeakMap(),
    direct = r.renderBufferDirect;
  r.renderBufferDirect = function (camera, scene, geo, src, obj, group) {
    if (
      !this.getRenderTarget()?.texture.userData.incidentScene ||
      !src.isShaderMaterial ||
      !colorEmitter(src) ||
      !src.fragmentShader.includes('gl_FragColor')
    )
      return direct.call(this, camera, scene, geo, src, obj, group);
    let entry = cache.get(src);
    if (!entry) {
      // An independent Three program identity sharing today's uniforms, side, blend state and
      // mod defines. Material.clone() would clone the archive textures and sever live uniforms.
      const identity = new Material(),
        variant = Object.create(src, { id: { value: identity.id }, uuid: { value: identity.uuid }, _listeners: { value: {} } });
      entry = { variant };
      cache.set(src, entry);
      src.addEventListener('dispose', function drop() {
        variant.dispose();
        cache.delete(src);
        src.removeEventListener('dispose', drop);
      });
    }
    if (entry.source !== src.fragmentShader) {
      entry.source = src.fragmentShader;
      entry.variant.fragmentShader = incidentGL(entry.source);
    }
    entry.variant.uniformsNeedUpdate = src.uniformsNeedUpdate;
    return direct.call(this, camera, scene, geo, entry.variant, obj, group);
  };
}
