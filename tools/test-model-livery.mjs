// buildModel() painting, material/pool isolation and the stock path, using a
// synthetic ALO-shaped model so no retail data is needed.
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.fetch = async () => new Response(null, { status: 404 });

const { alphaInstanceable, buildModel, instanceable, lighting, paletteMaterialCount, prebuildModel, programSources } =
  await import('../public/js/model.js');
const { LIVERY_AMOUNT } = await import('../public/js/livery.js');

const quad = (scale = 1) => ({
  nVerts: 4,
  nPrims: 2,
  stride: 32,
  format: 'F',
  vertices: {
    pos: new Float32Array([-scale, -scale, -scale, scale, -scale, -scale, scale, scale, scale, -scale, scale, scale]),
    nrm: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    tan: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]),
    bin: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    col: null,
    skinIndex: null,
    skinWeight: null
  },
  indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  boneMap: null
});

const mesh = (name, shader, params = {}, scale = 1) => ({
  name,
  bone: 0,
  hidden: false,
  subs: [{ material: { shader, params: { BaseTexture: 'Data/Art/Textures/Hull.tga', ...params } }, geometry: quad(scale) }]
});
const model = (meshes = [mesh('hull', 'mesh.fx')]) => ({
  bones: [{ name: 'root', parent: -1, visible: true, billboard: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] }],
  meshes,
  proxies: []
});

const paint = { colors: ['#3d5a80', '#ee6c4d', '#e0fbfc', '#293241'], pattern: 'banded' };
const other = { ...paint, pattern: 'chevron' };
const materialOf = (inst, name = null) => {
  let found;
  inst.root.traverse(o => {
    if (!o.isMesh) return;
    if (name == null || o.parent?.name === name) found ??= o.material;
  });
  return found;
};
const color = new THREE.Color(0.8, 0.1, 0.1);

// --- stock path ----------------------------------------------------------
{
  const inst = buildModel(model()),
    material = materialOf(inst);
  assert.equal(material.defines.LIVERY, undefined, 'no paint, no define');
  assert.equal(material.uniforms.liveryColor0, undefined, 'no paint, no palette uniforms');
  assert.equal(material.uniforms.colorization.value.x, 1, 'stock colorization default is untouched');
  assert.equal(material.vertexShader, materialOf(buildModel(model())).vertexShader, 'the shared shader source is used');
  const again = materialOf(buildModel(model()));
  assert.equal(again, material, 'stock materials still share the cache');
}

// --- livery on a shader without a native colour mask --------------------
{
  const material = materialOf(buildModel(model(), { livery: paint }));
  assert.equal(material.defines.LIVERY, 1, 'plain mesh.fx is painted');
  const at = i => material.uniforms['liveryColor' + i].value;
  assert.deepEqual(
    [at(0).x, at(0).y, at(0).z].map(v => Math.round(v * 255)),
    [0x3d, 0x5a, 0x80]
  );
  assert.deepEqual(
    [at(1).x, at(1).y, at(1).z].map(v => Math.round(v * 255)),
    [0xee, 0x6c, 0x4d]
  );
  assert.deepEqual(
    [at(2).x, at(2).y, at(2).z].map(v => Math.round(v * 255)),
    [0xe0, 0xfb, 0xfc]
  );
  assert.deepEqual(
    [at(3).x, at(3).y, at(3).z].map(v => Math.round(v * 255)),
    [0x29, 0x32, 0x41]
  );
  assert.equal(material.uniforms.liveryParams.value.x, 1, 'banded pattern index');
  assert.equal(material.uniforms.liveryParams.value.y, LIVERY_AMOUNT);
  // Paint frame is the geometry's own bounding box (quad -> +/-1).
  assert.deepEqual(material.uniforms.liveryCenter.value.toArray(), [0, 0, 0]);
  assert.deepEqual(material.uniforms.liveryHalf.value.toArray(), [1, 1, 1]);
  assert.equal(material.transparent, false);
  assert.equal(material.depthWrite, true);
  assert.equal(material.uniforms.opacity.value, 1);
}

// --- pattern and palette isolation --------------------------------------
{
  const a = materialOf(buildModel(model(), { livery: paint })),
    b = materialOf(buildModel(model(), { livery: other })),
    c = materialOf(buildModel(model(), { livery: { ...paint, colors: ['#3d5a80', '#ee6c4d', '#e0fbfc', '#293242'] } })),
    twin = materialOf(buildModel(model(), { livery: { colors: paint.colors.slice(), pattern: 'banded' } }));
  assert.notEqual(a, b, 'different pattern is a different material');
  assert.notEqual(a.uniforms.liveryParams, b.uniforms.liveryParams, 'pattern uniform is per material');
  assert.equal(a.uniforms.liveryParams.value.x, 1);
  assert.equal(b.uniforms.liveryParams.value.x, 3, 'chevron');
  assert.notEqual(a, c, 'different accent colour is a different material');
  assert.equal(a, twin, 'an equivalent palette reuses the cached material');
}

// --- team colour and livery coexist -------------------------------------
{
  const plain = materialOf(buildModel(model([mesh('hull', 'meshcolorize.fx')]), { teamColor: color }));
  const painted = materialOf(buildModel(model([mesh('hull', 'meshcolorize.fx')]), { teamColor: color, livery: paint }));
  assert.equal(plain.defines.COLORIZE, 1, 'stock team colour still uses the native mask');
  assert.equal(plain.defines.LIVERY, undefined);
  assert.equal(painted.defines.COLORIZE, 1);
  assert.equal(painted.defines.LIVERY, 1);
  assert.notEqual(plain, painted, 'paint layers over the team-colour pass');
  assert.equal(painted.uniforms.colorization.value.x, +color.r.toFixed(6), 'team colour still reaches COLORIZE');
}

// --- transparency and protected effects --------------------------------
{
  const alpha = materialOf(buildModel(model([mesh('hull', 'meshalpha.fx')]), { livery: paint }));
  assert.equal(alpha.defines.LIVERY, 1, 'transparent hull parts are painted');
  assert.equal(alpha.defines.ALPHA, 1);
  assert.equal(alpha.transparent, true, 'alpha blending is preserved');
  assert.equal(alpha.depthWrite, false, 'alpha depth state is preserved');
  const additive = materialOf(buildModel(model([mesh('glow', 'meshadditive.fx')]), { livery: paint }));
  assert.equal(additive.defines.LIVERY, undefined, 'additive effect keeps its colour');
  assert.equal(additive.defines.ADDITIVE, 1);
  const glow = materialOf(
    buildModel(model([mesh('glass', 'meshgloss.fx', { Diffuse: [0, 0, 0, 0], Specular: [0, 0, 0, 0] })]), { livery: paint })
  );
  assert.equal(glow.defines.NATIVE_MESH_GLOSS_EMISSIVE, 1);
  assert.equal(glow.defines.LIVERY, undefined, 'emissive-only gloss pass keeps its glow');
  const shield = materialOf(buildModel(model([mesh('shield', 'meshshield.fx')]), { livery: paint }));
  assert.equal(shield.defines?.LIVERY, undefined);
  assert.equal(shield.userData.shield, true);
  const sky = materialOf(buildModel(model([mesh('sky', 'skydome.fx')]), { livery: paint }));
  assert.equal(sky.defines.LIVERY, undefined, 'skydome is not hull paint');
}

// --- per-mesh paint frame ----------------------------------------------
{
  const inst = buildModel(model([mesh('small', 'mesh.fx', {}, 1), mesh('large', 'mesh.fx', {}, 4)]), { livery: paint });
  const small = materialOf(inst, 'small'),
    large = materialOf(inst, 'large');
  assert.notEqual(small, large, 'meshes of different size get their own pattern frame');
  assert.deepEqual(small.uniforms.liveryHalf.value.toArray(), [1, 1, 1]);
  assert.deepEqual(large.uniforms.liveryHalf.value.toArray(), [4, 4, 4]);
  assert.equal(materialOf(inst, 'small'), small, 'the same mesh keeps its material');
}

// --- pooled instances are paint-specific -------------------------------
{
  const data = model();
  const a = materialOf(buildModel(data, { livery: paint })),
    b = materialOf(buildModel(data, { livery: paint }));
  assert.equal(a, b, 'the same paint shares materials');

  // Two pooled hulls may only be handed out to the same palette. A different
  // pattern, or a bare team colour, must build its own instance instead.
  prebuildModel(data, null, 2, paint);
  const chevron = materialOf(buildModel(data, { livery: other }));
  assert.equal(chevron.uniforms.liveryParams.value.x, 3, 'a pooled banded hull is not reused for chevrons');
  const plain = materialOf(buildModel(data, { teamColor: color }));
  assert.equal(plain.defines.LIVERY, undefined, 'a pooled painted hull is not reused for team colour');
  const painted = materialOf(buildModel(data, { livery: paint }));
  assert.equal(painted, a, 'the pooled hulls were built with the same material');
  // `fresh` never consumes the pool.
  const fresh = materialOf(buildModel(data, { livery: paint, fresh: true }));
  assert.equal(fresh, a);
}

// --- instancing stays available ----------------------------------------
{
  const painted = materialOf(buildModel(model(), { livery: paint }));
  assert.ok(instanceable.has(painted), 'painted opaque hulls stay batchable');
  const alpha = materialOf(buildModel(model([mesh('hull', 'meshalpha.fx')]), { livery: paint }));
  assert.ok(alphaInstanceable.has(alpha), 'painted transparent hulls stay batchable');
}

// WebGPU picks a painted pipeline only for models wearing a livery.
{
  const { env } = await import('../public/js/gpu/env.js');
  const { families } = await import('../public/js/gpu/programs.js');
  env.programSources = programSources;
  env.lighting = lighting;
  const stock = materialOf(buildModel(model())), painted = materialOf(buildModel(model(), { livery: paint }));
  const a = families.find(f => f.match(stock)), b = families.find(f => f.match(painted));
  assert.equal(a.name, 'model');
  assert.equal(b.name, 'modelLivery');
  assert(!a.key(stock, false).includes('LIVERY'));
  assert(b.key(painted, false).includes('LIVERY'));
  assert.equal(b.block.size, 112);
  assert(b.code(painted, false).includes('liveryPaint'));
  assert(!/livery/i.test(a.code(stock, false)));
}

// --- bounded palette cache ---------------------------------------------
{
  const data = model();
  const before = paletteMaterialCount();
  for (let i = 0; i < 120; i++) {
    const hex = i.toString(16).padStart(6, '0');
    buildModel(data, { livery: { colors: ['#' + hex, '#ee6c4d', '#e0fbfc', '#293241'], pattern: 'split' } });
  }
  assert(paletteMaterialCount() <= 96, 'colour scrubbing stays bounded');
  assert(paletteMaterialCount() >= before);
}

console.log(
  'PASS: livery defines/uniforms, stock path, palette and pattern isolation, transparent and protected effects, per-mesh frame, pool isolation and bounded palette cache'
);
