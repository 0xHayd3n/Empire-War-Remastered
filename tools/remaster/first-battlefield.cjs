// Install before navigating the Universal host. At reveal inspect the last submitted
// main-camera land pass, NOT the current option or a later frame that reached 'ready'.
function observeReveal() {
  if (window === parent) return;
  let game;
  Object.defineProperty(window, 'game', {
    configurable: true, get: () => game,
    set(g) {
      game = g;
      if (!g?.ground) return;
      Object.defineProperty(window, 'game', { configurable: true, writable: true, value: g });
      const r = g.gpuOn ? g.gpu : g.renderer;
      let last, draws = 0;
      const visible = () => !document.querySelector('.battle-plate, #loading:not(.hidden), #splash:not(.hidden)');
      const originals = new Map();
      const observer = new MutationObserver(reveal);
      function reveal() {
        if (!last || !visible()) return;
        window.firstBattlefield = last;
        observer.disconnect();
        for (const [name, fn] of originals) r[name] = fn;
      }
      observer.observe(document.body, { childList: true, attributes: true, attributeFilter: ['class'], subtree: true });
      for (const name of ['render', 'renderWithBackdrop']) {
        const render = r[name];
        if (!render) continue;
        originals.set(name, render);
        r[name] = function (scene, camera, ...args) {
          const primary = scene === g.scene && camera === g.camera && !scene.overrideMaterial;
          if (primary) {
            const { material, userData } = g.ground, u = material.uniforms;
            const status = userData.reviewedLandscape || userData.endorLandscape;
            last = { draw: ++draws, map: g.map.file, backend: g.gpuOn ? 'webgpu' : 'webgl',
              state: status?.state, active: status?.active, reason: status?.reason,
              shader: !!material.defines?.BIOME_RECIPE || u.fullTerrain?.value === 2,
              donors: !!(u.map.value?.isCompressedArrayTexture && u.bump.value?.isCompressedArrayTexture &&
                u.map.value !== u.bump.value && (userData.endorLandscape ? u.fullTerrain.value === 2 && u.map.value.image.depth === 8 :
                  (u.map.value === u.soilColor.value && u.bump.value === u.soilSurface.value))),
              width: u.map.value?.image?.width };
          }
          const result = render.call(this, scene, camera, ...args);
          if (primary) reveal();
          return result;
        };
      }
    }
  });
}
async function readReveal(body) {
  return body.evaluate(async () => {
    const until = performance.now() + 120000;
    while (!window.firstBattlefield) {
      if (performance.now() > until) throw Error('No battlefield reveal: ' + document.querySelector('#loadText')?.textContent);
      await new Promise(requestAnimationFrame);
    }
    return window.firstBattlefield;
  });
}
function checkReveal(first, { planet, file = `_MP_LAND_${planet?.toUpperCase()}.TED`, mode, backend, width }) {
  const on = mode === 'remaster';
  if (!first?.draw || first.map?.toUpperCase() !== file.toUpperCase() || first.backend !== backend ||
      first.state !== (on ? 'ready' : mode === 'original' ? 'idle' : 'unavailable') ||
      first.active !== on || first.shader !== on || first.donors !== on || (on && first.width !== width) ||
      (mode === 'fallback' && !first.reason)) throw Error(`Wrong first visible battlefield (${file}/${mode}): ${JSON.stringify(first)}`);
  return first;
}
module.exports = { observeReveal, readReveal, checkReveal };
