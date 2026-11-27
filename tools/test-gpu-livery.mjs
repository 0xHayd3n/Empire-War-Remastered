// WebGPU half of the Army Painter: the WGSL paint is generated from the same
// palette table as the WebGL shader, the palette block matches the uniforms
// model.js writes, and only materials that define LIVERY pick the painted
// families, so the stock program and its bytes stay as they were.
//
// The browser test (tools/test-gpu-livery-browser.cjs) compiles the real shader
// and reads pixels; this one needs no GPU. Requires public/js/livery.js, the
// WebGL side of the feature.
import assert from 'node:assert/strict';

import * as livery from '../public/js/livery.js';

const { LIVERY_BINDING, LIVERY_BYTES, LIVERY_PATTERN_BLOCK, LIVERY_WGSL, liveryPatternWGSL, packLivery } = await import(
  '../public/js/gpu/livery.js'
);
const { env } = await import('../public/js/gpu/env.js');
const { families } = await import('../public/js/gpu/programs.js');

const PATTERNS = livery.LIVERY_PATTERNS;

// --- the shader body is the GLSL body, by construction --------------------
for (const pattern of PATTERNS) {
  assert.equal(liveryPatternWGSL(pattern), livery.liveryPatternSource(pattern), `${pattern}: the WGSL statements are the GLSL statements`);
  const assigned = [...liveryPatternWGSL(pattern).matchAll(/(secondary|accent1|accent2) =/g)].map(m => m[1]);
  assert.deepEqual(assigned.sort(), ['accent1', 'accent2', 'secondary'], `${pattern}: every non-primary channel is painted once`);
}
// All four patterns are in the shader, in table order, behind the same ladder.
assert.equal(LIVERY_PATTERN_BLOCK, livery.LIVERY_FRAG_BODY, 'the four-pattern ladder is the GLSL ladder, byte for byte');
const at = PATTERNS.map(p => LIVERY_PATTERN_BLOCK.replace(/\s+/g, ' ').indexOf(liveryPatternWGSL(p)));
assert(
  at.every((i, k) => i > 0 && (k === 0 || i > at[k - 1])),
  'the WGSL carries every pattern in table order'
);
assert.equal(
  (LIVERY_PATTERN_BLOCK.match(/else if \(pattern </g) || []).length,
  PATTERNS.length - 2,
  'the ladder has one branch per pattern'
);
assert(
  LIVERY_PATTERN_BLOCK.startsWith('  if (pattern < 0.5)') && LIVERY_PATTERN_BLOCK.endsWith('  }'),
  'the ladder opens on 0.5 and ends in else'
);
assert(LIVERY_WGSL.includes(LIVERY_PATTERN_BLOCK), 'and the model shader embeds that ladder unchanged');

// --- uniform layout ------------------------------------------------------
assert.equal(LIVERY_BINDING, 8, 'after map/normal/gloss (0-5) and the reflect sky (6-7)');
assert.equal(LIVERY_BYTES, (4 * 4 + 4 + 4 + 4) * 4, 'four colours, centre, half size and params, 16-byte aligned');
assert(LIVERY_WGSL.includes(`@group(1) @binding(${LIVERY_BINDING}) var<uniform> LV: Livery`), 'the block is the family block binding');
assert(
  /struct Livery \{\n {2}colors: array<vec4f, 4>,\n {2}center: vec3f, centerPad: f32,\n {2}extent: vec3f, extentPad: f32,\n {2}params: vec4f,\n\}/.test(
    LIVERY_WGSL
  ),
  'WGSL field order matches the packer'
);

const palette = [
  [0.24, 0.35, 0.5],
  [0.93, 0.42, 0.3],
  [0.88, 0.98, 0.99],
  [0.16, 0.2, 0.25]
];
const rgb4 = c => ({ x: c[0], y: c[1], z: c[2], w: 1 });

// The shapes model.js's liveryUniformSet() hands over: THREE.Vector4/Vector3.
const liveryUniforms = (pattern = 1, amount = livery.LIVERY_AMOUNT) => ({
  liveryColor0: { value: rgb4(palette[0]) },
  liveryColor1: { value: rgb4(palette[1]) },
  liveryColor2: { value: rgb4(palette[2]) },
  liveryColor3: { value: rgb4(palette[3]) },
  liveryCenter: { value: { x: -2, y: 0.5, z: 3 } },
  liveryHalf: { value: { x: 4, y: 1.5, z: 2 } },
  liveryParams: { value: { x: pattern, y: amount, z: 0, w: 0 } }
});

{
  const f = new Float32Array(LIVERY_BYTES / 4);
  packLivery(liveryUniforms(2), f);
  for (let i = 0; i < 4; i++)
    assert.deepEqual(
      [...f.slice(i * 4, i * 4 + 4)].map(v => Math.round(v * 1e6) / 1e6),
      [...palette[i], 1],
      `colour ${i} lands on its slot`
    );
  assert.deepEqual([...f.slice(16, 19)], [-2, 0.5, 3], 'centre at float 16');
  assert.equal(f[19], 0, 'centre pad is zeroed');
  assert.deepEqual([...f.slice(20, 23)], [4, 1.5, 2], 'half size at float 20');
  assert.equal(f[23], 0, 'half pad is zeroed');
  assert.equal(f[24], 2, 'pattern index');
  assert.equal(Math.round(f[25] * 1e6) / 1e6, livery.LIVERY_AMOUNT, 'paint amount');
  assert.deepEqual([...f.slice(26, 28)], [0, 0], 'the spare pair stays zero');
  assert(
    f.every(v => Number.isFinite(v)),
    'every float in the block is a number'
  );
  // Offsets above are the whole block, so nothing is written past LIVERY_BYTES.
  packLivery({}, f);
  assert(
    f.every(v => v === 0),
    'a material without palette uniforms packs zeros'
  );
  assert.equal(f[25], 0, '...which makes the paint amount 0: the hull keeps its texture');
  packLivery(null, f);
  assert(
    f.every(v => v === 0),
    'packing without a uniforms map is safe'
  );
}

// --- family wiring -------------------------------------------------------
// The turn shader is FRAG with the facing test inverted, as in model.js.
env.programSources = { VERT: 'vert', FRAG: 'frag gl_FrontFacing', DEPTH_FRAG: 'depth' };
env.lighting = {};
const material = (defines, fragmentShader = 'frag gl_FrontFacing') => ({
  isShaderMaterial: true,
  vertexShader: 'vert',
  fragmentShader,
  defines,
  uniforms: liveryUniforms()
});
const pick = m => {
  const f = families.find(x => x.match(m));
  assert(f, 'material matches a family');
  return f;
};

const stock = mat => pick(material(mat));
assert.equal(families[0].name, 'model', 'the stock family is still found first');
assert.equal(stock({}).name, 'model', 'no paint, the stock family');
assert.equal(stock({ COLORIZE: 1, ALPHA: 1 }).name, 'model', 'stock defines stay on the stock family');
assert.equal(stock({ LIVERY: 1 }).name, 'modelLivery', 'paint gets its own family');
assert.equal(stock({ REFLECT: 1 }).name, 'modelReflect', 'reflection is unchanged');
assert.equal(stock({ REFLECT: 1, LIVERY: 1 }).name, 'modelReflectLivery', 'paint plus reflection has its own family too');

// The program key is what the renderer caches modules by, so it must name paint.
assert.equal(stock({}).key(material({}), false), 'model|', 'the stock key is unchanged');
assert.equal(stock({ COLORIZE: 1 }).key(material({ COLORIZE: 1 }), false), 'model|COLORIZE', 'stock defines keep their key');
assert.equal(stock({ LIVERY: 1 }).key(material({ LIVERY: 1 }), false), 'model|LIVERY', 'paint is part of the key');
assert.equal(stock({ LIVERY: 1 }).key(material({ LIVERY: 1 }), true), 'model|LIVERY|I', 'and so is instancing');

// Only the painted families carry the block; the stock layout has no buffer.
const painted = stock({ LIVERY: 1 });
assert.deepEqual(
  painted.layout.filter(e => e.buffer),
  [{ binding: LIVERY_BINDING, visibility: 3, buffer: { type: 'uniform' } }],
  'the palette block sits at group 1 binding 8'
);
assert.deepEqual(
  painted.layout.filter(e => e.texture).map(e => e.binding),
  [0, 2, 4],
  'textures are untouched'
);
assert.equal(painted.block.size, LIVERY_BYTES, 'one block per material');
assert.equal(
  stock({}).layout.some(e => e.buffer),
  false,
  'the stock material binds no extra buffer'
);
assert.equal(stock({}).block, undefined);
const reflectPainted = stock({ REFLECT: 1, LIVERY: 1 });
assert.deepEqual(
  reflectPainted.layout.filter(e => e.texture).map(e => e.binding),
  [0, 2, 4, 6],
  'reflection keeps its sky texture'
);
assert.equal(reflectPainted.layout.filter(e => e.buffer).length, 1, 'and gains the block');

// The block is filled from the material's uniforms, once per frame.
{
  const f = new Float32Array(LIVERY_BYTES / 4);
  painted.block.fill(material({ LIVERY: 1 }), f);
  assert.equal(f[24], 1, 'banded pattern index reaches the shader');
  assert.equal(Math.round(f[25] * 1e6) / 1e6, livery.LIVERY_AMOUNT, 'and the paint amount');
}

// --- generated WGSL ------------------------------------------------------
{
  // A team-coloured painted hull: COLORIZE runs first, paint layers over it.
  const code = painted.code(material({ LIVERY: 1, COLORIZE: 1 }), false);
  assert(code.includes('o.vLiveryPos = i.position;'), 'the paint frame is the vertex position attribute, before skin and instance');
  assert(code.includes('@location(9) vLiveryPos: vec3f'), 'the frame interpolates to the fragment stage');
  assert(code.includes('albedo = liveryPaint(albedo, v.vLiveryPos);'), 'paint is applied to albedo only');
  assert(code.includes(`@group(1) @binding(${LIVERY_BINDING}) var<uniform> LV: Livery`), 'the block is declared');
  // Paint must run after the native team colour and before lighting.
  const colorize = code.indexOf('albedo = mix(albedo, albedo * D.colorization.rgb, base.a);');
  const paintAt = code.indexOf('albedo = liveryPaint(albedo, v.vLiveryPos);');
  // Indirect fill is computed separately from shadowed sunlight; the ordering
  // contract is paint before light is applied, not the spelling of the fill sum.
  const lightAt = code.indexOf('diffuse * light * ls.rgb');
  assert(colorize > 0 && colorize < paintAt && paintAt < lightAt, 'team colour, then paint, then lighting');
  assert(!code.includes('v.vLiveryPos ='), 'the varying is only written in the vertex stage');

  const instanced = painted.code(material({ LIVERY: 1 }), true);
  assert(instanced.includes('albedo = liveryPaint(albedo, v.vLiveryPos);'), 'instanced hulls are painted');
  assert(instanced.includes('arenaAt(D.instBase'), 'and still take their frame from the attribute, not the world');
  assert.equal((instanced.match(/vLiveryPos = i\.position;/g) || []).length, 1, 'the frame is the local position once');

  const depthCode = painted.code(material({ LIVERY: 1 }, 'depth'), false);
  assert(depthCode.includes('@location(9) vLiveryPos: vec3f'), 'the shadow twin keeps the same vertex outputs');
  assert(depthCode.includes('fn fs(v: VOut)'), 'and the depth fragment still exists');

  const plain = families[0].code(material({}), false);
  assert(!/Livery|liveryPaint|vLiveryPos|liverySoft/.test(plain), 'the stock shader mentions no paint');
  assert.equal((plain.match(/struct Draw/g) || []).length, 1, 'and keeps one Draw block');
}

console.log(
  'PASS: WGSL paint is generated from the shared palette table, the 28-float block matches model.js uniforms, and only LIVERY materials take the painted families'
);
