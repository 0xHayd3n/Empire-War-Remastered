import assert from 'node:assert/strict';
import * as T from 'three';
import { receiverSettings } from '../public/js/fieldreceivers.js';
import { battlePrefs } from '../public/js/battlerealism.js';
import { soilColor, soilGrid } from '../public/js/game/groundday.js';
import { leafShadowMaterial, programSources } from '../public/js/model.js';
assert.equal(receiverSettings.length, 6);
for (const [key] of receiverSettings) {
  const p = { battleRealism: 'on', [key]: false };
  assert.equal(battlePrefs(p)[key], true);
  p.battleRealism = 'off';
  p[key] = true;
  assert.equal(battlePrefs(p)[key], false);
  p.battleRealism = 'custom';
  assert.equal(battlePrefs(p)[key], true);
}
const n = 8,
  t = { size: n, layers: [{}, {}], layerIndex: Array.from({ length: n * n }, (_, i) => (i % n < 4 ? 0 : 1)) },
  dds = rgb => ({ mipmaps: [{ width: 1, height: 1, data: Uint8Array.from([...rgb, 255]) }] });
const palette = [],
  base = soilColor(t, [0, 1], [[dds([30, 43, 92])], [dds([180, 110, 63])]], palette),
  g = soilGrid(t, palette, base, 20),
  image = g.tex.image;
assert.deepEqual([...image.data.slice(0, 8)], [30, 43, 92, 255, 180, 110, 63, 255]);
const after = [...image.data.slice(4)];
const ids = new Set();
for (let j = 0; j < 4; j++)
  for (let i = 0; i < 4; i++) {
    t.layerIndex[j * n + i] = 1;
    ids.add(j * n + i);
  }
g.pave(ids);
assert.deepEqual([...image.data.slice(0, 4)], [180, 110, 63, 255]);
assert.deepEqual([...image.data.slice(4)], after);
assert.equal(g.scale, 1 / (20 * n));
g.tex.dispose();
const m = new T.ShaderMaterial({
  vertexShader: programSources.VERT,
  uniforms: { map: { value: new T.Texture() }, opacity: { value: 1 }, alphaRef: { value: -1 } },
  defines: { ALPHA: 1, WIND_LEAVES: 1 },
  transparent: true,
  depthWrite: false
});
const shadow = leafShadowMaterial(m);
// Utapau scrub uses alpha blending with no alpha test. The same negative
// cutoff in a depth-only pass would let even an alpha-zero texel cast.
assert.equal(shadow.uniforms.map, m.uniforms.map);
assert.equal(shadow.uniforms.opacity, m.uniforms.opacity);
assert(shadow.uniforms.alphaRef.value > 0 && shadow.uniforms.alphaRef.value < 1);
assert.equal(m.uniforms.alphaRef.value, -1);
// FX state can arrive after creation. Respect an explicit cutout (even zero)
// without rebuilding the cached twin or imposing the grass cutoff on shrubs.
for (const ref of [0.34, 0, 0.8]) {
  m.uniforms.alphaRef.value = ref;
  assert.equal(shadow.uniforms.alphaRef.value, ref);
}
assert.equal(shadow.depthWrite, true);
assert.equal(shadow.colorWrite, false);
assert.equal(shadow.defines.LEAF_CASTER, 1);
assert.equal(m.depthWrite, false);
m.userData.grassCard = true;
m.uniforms.alphaRef.value = 8 / 255;
assert.equal(shadow.uniforms.alphaRef.value, 0.55);
assert.equal(m.uniforms.alphaRef.value, 8 / 255);
m.depthWrite = true;
assert.equal(shadow.uniforms.alphaRef.value, 8 / 255);
assert.equal(leafShadowMaterial(m), shadow);
m.visible = false;
assert.equal(leafShadowMaterial(m), null);
m.visible = true;
m.defines = {};
assert.equal(leafShadowMaterial(m), null);
console.log('Six settings, painted local mips, targeted paving and cutout-only canopy twins: ok');
