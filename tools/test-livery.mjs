// Army Painter maths and shader text, no retail data and no browser.
// The shader body is generated from LIVERY_TERMS, so this test evaluates the
// generated expressions themselves and compares them with sampleLivery().
import assert from 'node:assert/strict';
import {
  LIVERY_AMOUNT,
  LIVERY_FRAG_APPLY,
  LIVERY_FRAG_BODY,
  LIVERY_FRAG_DECL,
  LIVERY_PATTERNS,
  LIVERY_TERMS,
  LIVERY_VERT_DECL,
  LIVERY_VERT_SET,
  liveryBounds,
  liveryColorHex,
  liveryComposite,
  liveryKey,
  liveryPaintable,
  liveryPatternSource,
  liverySoft,
  liveryStep,
  liveryTri,
  liveryUniformValues,
  normalizeLivery,
  parseLiveryColor,
  sampleLivery
} from '../public/js/livery.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// Evaluate the generated GLSL statement text as plain arithmetic. The palette
// expression only uses these helpers, so a typo in either side fails here.
const evaluate = (source, q) => {
  const out = { secondary: 0, accent1: 0, accent2: 0 };
  for (const statement of source
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)) {
    const m = /^(\w+) = ([\s\S]+)$/.exec(statement);
    assert.ok(m, 'livery: unexpected shader statement ' + statement);
    const value = new Function(
      'q',
      'abs',
      'liveryTri',
      'liverySoft',
      'liveryStep',
      `return ${m[2].replace(/q\./g, 'q.').replace(/\babs\(/g, 'abs(')}`
    )(q, Math.abs, liveryTri, liverySoft, liveryStep);
    out[m[1]] = value;
  }
  return out;
};

// --- colours -------------------------------------------------------------
assert.equal(parseLiveryColor('#aa0000').length, 3);
assert(close(parseLiveryColor('#aa0000')[0], 170 / 255));
assert(close(parseLiveryColor('#a00')[0], 170 / 255));
assert(close(parseLiveryColor(0x00ff00)[1], 1));
assert(parseLiveryColor([255, 128, 0]).every((v, i) => close(v, [1, 128 / 255, 0][i])));
assert.equal(parseLiveryColor('nope'), null);
assert.equal(parseLiveryColor('#12345'), null);

const palette = { colors: ['#3d5a80', '#ee6c4d', '#e0fbfc', '#293241'], pattern: 'banded' };
const normalized = normalizeLivery(palette);
assert.equal(normalized.pattern, 'banded');
assert.equal(normalized.colors.length, 4);
assert.equal(liveryColorHex(normalized.colors[0]), '#3d5a80');

// Missing colours fall back to the team colour and then to derived tones, so a
// caller can paint with just a primary.
const team = [0.8, 0.1, 0.1];
const derived = normalizeLivery({ colors: [] }, team);
assert.ok(derived, 'team colour alone paints');
assert.equal(liveryColorHex(derived.colors[0]), '#cc1a1a');
assert.notEqual(liveryColorHex(derived.colors[1]), liveryColorHex(derived.colors[0]), 'secondary derived');
assert.notEqual(liveryColorHex(derived.colors[2]), liveryColorHex(derived.colors[0]), 'accent1 derived');
assert.notEqual(liveryColorHex(derived.colors[3]), liveryColorHex(derived.colors[0]), 'accent2 derived');
assert.equal(normalizeLivery(null), null);
assert.equal(normalizeLivery({}), null, 'no primary and no team colour keeps the stock path');
assert.equal(normalizeLivery({ colors: ['#112233'], pattern: 'plaid' }).pattern, 'standard', 'unknown pattern falls back');
assert.equal(liveryKey(normalizeLivery(palette)), liveryKey(normalizeLivery({ ...palette })));
assert.notEqual(liveryKey(normalizeLivery(palette)), liveryKey(normalizeLivery({ ...palette, pattern: 'split' })));
assert.notEqual(
  liveryKey(normalizeLivery(palette)),
  liveryKey(normalizeLivery({ ...palette, colors: ['#3d5a81', '#ee6c4d', '#e0fbfc', '#293241'] }))
);

// --- shader text ---------------------------------------------------------
assert.match(LIVERY_VERT_DECL, /#ifdef LIVERY/);
assert.match(LIVERY_VERT_DECL, /varying vec3 vLiveryPos;/);
assert.match(LIVERY_VERT_SET, /vLiveryPos = position;/);
assert.match(LIVERY_FRAG_DECL, /#ifdef LIVERY\nuniform vec4 liveryColor0, liveryColor1, liveryColor2, liveryColor3;/);
assert.match(LIVERY_FRAG_DECL, /uniform vec3 liveryCenter, liveryHalf;/);
assert.match(LIVERY_FRAG_DECL, /uniform vec4 liveryParams;/);
assert.match(LIVERY_FRAG_DECL, /vec3 q = \(vLiveryPos - liveryCenter\) \/ max\(liveryHalf, vec3\(0\.001\)\);/);
assert.match(LIVERY_FRAG_APPLY, /albedo = liveryPaint\(albedo\);/);
// Texture detail and lighting survive: the paint is modulated by luma and mixed
// with the albedo instead of replacing the lit result.
assert.match(LIVERY_FRAG_DECL, /float luma = dot\(albedo, vec3\(0\.299, 0\.587, 0\.114\)\);/);
assert.match(LIVERY_FRAG_DECL, /return mix\(albedo, paint \* shade, clamp\(liveryParams\.y, 0\.0, 1\.0\)\);/);
for (const mix of ['liveryColor0.rgb, liveryColor1.rgb, secondary', 'liveryColor2.rgb, accent1', 'liveryColor3.rgb, accent2'])
  assert.ok(LIVERY_FRAG_DECL.includes(mix), 'all four channels are mixed: ' + mix);
// One branch per pattern, in declaration order.
const branch = i => (i === 0 ? 'if (pattern < 0.5)' : i === LIVERY_PATTERNS.length - 1 ? 'else {' : `else if (pattern < ${i + 0.5})`);
for (let i = 0; i < LIVERY_PATTERNS.length; i++) assert.ok(LIVERY_FRAG_BODY.includes(branch(i)), 'branch for ' + LIVERY_PATTERNS[i]);
for (const pattern of LIVERY_PATTERNS)
  assert.ok(LIVERY_FRAG_BODY.includes(liveryPatternSource(pattern).split(';')[0]), 'body inlines ' + pattern);

// --- generated shader vs sampleLivery -----------------------------------
const grid = [];
for (let x = -1; x <= 1.0001; x += 0.05)
  for (let y = -1; y <= 1.0001; y += 0.05) for (let z = -1; z <= 1.0001; z += 0.1) grid.push({ x, y, z });
assert.equal(grid.length, 41 * 41 * 21);
for (const pattern of LIVERY_PATTERNS) {
  const source = liveryPatternSource(pattern);
  let maxSecondary = 0,
    maxAccent1 = 0,
    maxAccent2 = 0;
  for (const q of grid) {
    const js = sampleLivery(pattern, q),
      shader = evaluate(source, q);
    for (const key of ['secondary', 'accent1', 'accent2']) {
      assert.ok(
        close(js[key], shader[key], 1e-9),
        `${pattern} ${key} shader/js disagree at ${q.x},${q.y},${q.z}: ${shader[key]} vs ${js[key]}`
      );
      assert.ok(js[key] >= 0 && js[key] <= 1, `${pattern} ${key} stays a weight`);
    }
    maxSecondary = Math.max(maxSecondary, js.secondary);
    maxAccent1 = Math.max(maxAccent1, js.accent1);
    maxAccent2 = Math.max(maxAccent2, js.accent2);
  }
  // Every channel must actually appear on a typical hull, not just be declared.
  assert(maxSecondary > 0.9, pattern + ' secondary covers a region');
  assert(maxAccent1 > 0.9, pattern + ' accent1 draws a line');
  assert(maxAccent2 > 0.9, pattern + ' accent2 draws a line');
}

// Patterns must read differently across the hull, otherwise a palette swap is
// invisible.
for (let i = 0; i < LIVERY_PATTERNS.length; i++)
  for (let j = i + 1; j < LIVERY_PATTERNS.length; j++) {
    let sum = 0;
    for (const q of grid) {
      const a = sampleLivery(LIVERY_PATTERNS[i], q),
        b = sampleLivery(LIVERY_PATTERNS[j], q);
      sum += Math.abs(a.secondary - b.secondary) + Math.abs(a.accent1 - b.accent1) + Math.abs(a.accent2 - b.accent2);
    }
    assert(sum / grid.length > 0.05, `${LIVERY_PATTERNS[i]} and ${LIVERY_PATTERNS[j]} read differently`);
  }

// Distinct channels produce distinct paint, and the composite follows the mix
// order secondary -> accent1 -> accent2.
const colors = normalized.colors;
const flat = liveryComposite(colors, { secondary: 0, accent1: 0, accent2: 0 });
assert.deepEqual(
  flat.map(v => +v.toFixed(6)),
  colors[0].map(v => +v.toFixed(6))
);
const painted = liveryComposite(colors, { secondary: 1, accent1: 0, accent2: 0 });
assert.deepEqual(
  painted.map(v => +v.toFixed(6)),
  colors[1].slice(0, 3).map(v => +v.toFixed(6))
);
const topped = liveryComposite(colors, { secondary: 1, accent1: 1, accent2: 1 });
assert.deepEqual(
  topped.map(v => +v.toFixed(6)),
  colors[3].slice(0, 3).map(v => +v.toFixed(6))
);

// --- protection ----------------------------------------------------------
const open = { additive: false, unlit: false, nativeAdditive: false, nebula: false, emissiveOnly: false };
assert.equal(liveryPaintable('mesh.fx', open), true, 'plain hull');
assert.equal(liveryPaintable('meshcolorize.fx', open), true, 'native team-colour mask');
assert.equal(liveryPaintable('meshbumpgloss.fx', open), true);
assert.equal(liveryPaintable('meshalpha.fx', { ...open, additive: false }), true, 'transparent hull keeps its alpha');
assert.equal(liveryPaintable('meshadditive.fx', { ...open, additive: true }), false);
assert.equal(liveryPaintable('meshadditiveemissive.fx', { ...open, nativeAdditive: true }), false);
assert.equal(liveryPaintable('skydome.fx', { ...open, unlit: true }), false);
assert.equal(liveryPaintable('nebula.fx', { ...open, unlit: true, nebula: true, nativeAdditive: true }), false);
assert.equal(liveryPaintable('meshshield.fx', { ...open, additive: true }), false);
assert.equal(liveryPaintable('planet.fx', open), false);
assert.equal(liveryPaintable('batchmeshgloss.fx', open), false);
assert.equal(liveryPaintable('terrainmeshbump.fx', open), false);
assert.equal(liveryPaintable('meshgloss.fx', { ...open, emissiveOnly: true }), false, 'glow-only pass keeps its colour');

// --- paint frame ---------------------------------------------------------
const box = liveryBounds({ x: -2, y: -1, z: 0 }, { x: 2, y: 1, z: 6 });
assert.deepEqual(box.center, [0, 0, 3]);
assert.deepEqual(box.half, [2, 1, 3]);
assert.equal(box.key, liveryBounds({ x: -2, y: -1, z: 0 }, { x: 2, y: 1, z: 6 }).key);
assert.notEqual(box.key, liveryBounds({ x: -2, y: -1, z: 0 }, { x: 2, y: 1, z: 8 }).key, 'mesh size is part of the identity');
const degenerate = liveryBounds(null, null);
assert.deepEqual(degenerate.center, [0, 0, 0]);
assert(degenerate.half.every(v => v === 1));

// Uniform payload is plain data; model.js wraps it in THREE types.
const values = liveryUniformValues(normalized, box, LIVERY_AMOUNT);
assert.equal(values.colors.length, 4);
assert.equal(values.colors[0].length, 4);
assert.deepEqual(values.center, box.center);
assert.deepEqual(values.half, box.half);
assert.equal(values.pattern, LIVERY_PATTERNS.indexOf('banded'));
assert.equal(values.amount, LIVERY_AMOUNT);
assert.equal(LIVERY_AMOUNT > 0 && LIVERY_AMOUNT < 1, true, 'paint keeps some texture hue');
assert.equal(LIVERY_TERMS.standard.length, 3);

console.log(
  'PASS: livery colours, key isolation, generated shader == sampleLivery for all four patterns, channel coverage, protection and paint frame'
);
