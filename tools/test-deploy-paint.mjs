// Deployment portrait rules: which model is shown, which paint is applied, and
// that a repaint releases everything it owned. No browser and no retail art.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { previewAnimBases, previewFile, previewPaint } from '../public/js/game/deploy-paint.js';
import { DeployPreview } from '../public/js/game/deploy-preview.js';
import { previewMaterial } from '../public/js/game/previewmaterial.js';

const type = values => ({ str: key => values[key] ?? '' });

// --- model choice --------------------------------------------------------
const land = type({ Land_Model_Name: 'AT_ST.ALO', Space_Model_Name: 'AT_ST_SPACE.ALO' });
const space = type({ Space_Model_Name: 'Rebel_Blockade_Runner.ALO' });
assert.equal(previewFile(land), 'AT_ST.ALO', 'land model wins when the unit has one');
assert.equal(previewFile(space), 'Rebel_Blockade_Runner.ALO', 'space-only units get a portrait');
assert.equal(previewFile(type({})), '');
assert.equal(previewFile(null), '');
assert.equal(previewFile(type({ Land_Model_Name: '   ' })), '');
assert.equal(previewFile(type({ Space_Model_Name: '  ISD.ALO  ' })), 'ISD.ALO');

// --- idle clip bases -----------------------------------------------------
assert.deepEqual(previewAnimBases('AT_ST.ALO', 'AT_ST_MOV.ALO'), ['AT_ST_MOV.ALO', 'AT_ST.ALO'], 'override first, then the model');
assert.deepEqual(previewAnimBases('AT_ST.ALO', 'at_st.alo'), ['at_st.alo'], 'the same rig under two casings is loaded once');
assert.deepEqual(previewAnimBases('AT_ST.ALO', ''), ['AT_ST.ALO']);
assert.deepEqual(previewAnimBases('AT_ST.ALO', 'AT_ST.ALO'), ['AT_ST.ALO']);
assert.deepEqual(previewAnimBases('', ''), []);
// A hero's animation rig applies to the land and the space model alike.
assert.deepEqual(previewAnimBases('spc.alo', 'HERO_RIG.alo'), ['HERO_RIG.alo', 'spc.alo']);

// --- paint identity ------------------------------------------------------
const team = new THREE.Color(0.8, 0.1, 0.1);
const livery = { colors: ['#3d5a80', '#ee6c4d', '#e0fbfc', '#293241'], pattern: 'banded' };
assert.equal(previewPaint(team, null).livery, null, 'team colour alone stays on the stock path');
assert.equal(previewPaint(null, null).key, '-/', 'no paint at all');
assert.notEqual(previewPaint(team, null).key, previewPaint(null, null).key, 'team colour changes the key');
assert.equal(
  previewPaint(team, livery).key,
  previewPaint(team.clone(), { ...livery, colors: livery.colors.slice() }).key,
  'equivalent palettes compare equal'
);
assert.notEqual(previewPaint(team, livery).key, previewPaint(team, { ...livery, pattern: 'split' }).key, 'pattern changes the key');
assert.notEqual(
  previewPaint(team, livery).key,
  previewPaint(team, { ...livery, colors: ['#3d5a81', ...livery.colors.slice(1)] }).key,
  'colour changes the key'
);
assert.notEqual(
  previewPaint(team, livery).key,
  previewPaint(new THREE.Color(0.1, 0.1, 0.8), livery).key,
  'team colour is part of the painted key'
);
assert.equal(previewPaint(null, livery).livery.pattern, 'banded', 'a livery paints without a team colour');
assert.notEqual(previewPaint(null, livery).key, previewPaint(null, { ...livery, pattern: 'chevron' }).key);

// --- release accounting --------------------------------------------------
const host = () => {
  const classes = new Set(['rendered']);
  return {
    style: { setProperty() {} },
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    classes
  };
};
const portrait = (overrides = {}) => {
  const preview = Object.create(DeployPreview.prototype);
  let disposed = 0,
    textures = 0,
    detached = 0;
  Object.assign(preview, {
    host: host(),
    materials: [{ dispose: () => disposed++ }, { dispose: () => disposed++ }],
    ownedTextures: new Map([
      ['map', { dispose: () => textures++ }],
      ['gloss', { dispose: () => textures++ }]
    ]),
    inst: { root: { removeFromParent: () => detached++ } },
    motion: {},
    bounds: {},
    spare: 3,
    serial: 7,
    ...overrides
  });
  return { preview, counts: () => ({ disposed, textures, detached }) };
};

{
  const { preview, counts } = portrait();
  preview.release();
  assert.deepEqual(counts(), { disposed: 2, textures: 2, detached: 1 }, 'every owned material and texture is disposed once');
  assert.deepEqual(preview.materials, []);
  assert.equal(preview.ownedTextures, null);
  assert.equal(preview.inst, null);
  assert.equal(preview.motion, null);
  assert.equal(preview.bounds, null, 'the paint frame is re-measured for the next model');
  assert.equal(preview.host.classes.has('rendered'), false);
  preview.release();
  assert.deepEqual(counts(), { disposed: 2, textures: 2, detached: 1 }, 'releasing twice is harmless');
}

{
  const { preview } = portrait();
  preview.clear();
  assert.equal(preview.unit, null);
  assert.equal(preview.paint, null);
  assert.equal(preview.file, null);
  assert.equal(preview.serial, 8, 'clear cancels any load still in flight');
}

// A unit with no model releases the old portrait and never touches WebGL.
{
  const { preview, counts } = portrait();
  await preview.show(type({}), null, null);
  assert.deepEqual(counts(), { disposed: 2, textures: 2, detached: 1 });
  assert.equal(preview.unit, null);
}

// --- portrait material copies -------------------------------------------
{
  const noShadow = new THREE.DepthTexture(1, 1);
  let wrappers = 0,
    wrapperDisposed = 0;
  const texture = {
      isTexture: true,
      clone() {
        wrappers++;
        return { isTexture: true, dispose: () => wrapperDisposed++ };
      }
    },
    owned = { dispose() {}, isTexture: true };
  const src = new THREE.ShaderMaterial({
    vertexShader: 'v',
    fragmentShader: 'f',
    uniforms: {
      map: { value: texture },
      liveryColor0: { value: new THREE.Vector4(0.2, 0.3, 0.4, 1) },
      liveryParams: { value: new THREE.Vector4(1, 0.82, 0, 0) },
      sunDir: { value: new THREE.Vector3(1, 1, 1) },
      sunColor: { value: new THREE.Color(1, 1, 1) },
      fogRange: { value: new THREE.Vector2(1, 1) },
      shadowOn: { value: 1 }
    }
  });
  const copy = previewMaterial(src, new Map([[texture, owned]]), noShadow);
  assert.notEqual(copy, src);
  assert.equal(copy.uniforms.map.value, owned, 'the portrait samples its own upload');
  assert.equal(src.uniforms.map.value, texture, 'the battlefield material is untouched');
  assert.notEqual(copy.uniforms.liveryColor0.value, src.uniforms.liveryColor0.value, 'palette uniforms are cloned');
  assert.deepEqual(copy.uniforms.liveryColor0.value.toArray(), src.uniforms.liveryColor0.value.toArray(), 'with the same palette');
  assert.equal(copy.uniforms.liveryParams.value.y, 0.82);
  assert.equal(copy.uniforms.shadowOn.value, 0, 'the portrait lights itself');
  assert.ok(copy.uniforms.sunDir.value.x < 0 && Math.abs(copy.uniforms.sunDir.value.length() - 1) < 1e-9);
  assert.equal(wrappers, 1);
  assert.equal(wrapperDisposed, 1, 'the unused texture clone from cloneUniforms() is released');
  assert.deepEqual(copy.uniforms.fogRange.value.toArray(), [0, 0]);
}

console.log('PASS: land/space portrait choice, idle clip bases, paint keys, release accounting and cloned palette uniforms');
