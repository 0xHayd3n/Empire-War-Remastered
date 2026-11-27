import assert from 'node:assert/strict';
import { CustomBlending, OneFactor, DstColorFactor, SrcColorFactor, MultiplyBlending } from 'three';
import { colorEmitter, incidentGL, incidentWG } from '../public/js/sceneenergy.js';
import { canMixLight } from '../public/js/game/incidentgl.js';
import { battlePrefs } from '../public/js/battlerealism.js';
assert.equal(colorEmitter({ colorWrite: false }), false);
assert.equal(colorEmitter({ blending: MultiplyBlending }), false);
assert.equal(colorEmitter({ blending: CustomBlending, blendSrc: DstColorFactor, blendDst: SrcColorFactor }), false);
assert.equal(colorEmitter({ blending: CustomBlending, blendSrc: OneFactor, blendDst: OneFactor }), true);
assert.match(
  incidentWG('@fragment fn fs(v: VOut, @builtin(front_facing) facing: bool) -> @location(0) vec4f {if (!facing){discard;} return v.rgb;}'),
  /archiveColor\(v, facing\)|archiveColor\(v,\s*facing\)/
);
assert.match(incidentGL('void main() { if (true) discard; }'), /void archiveColor\(\)/);
assert.equal(canMixLight({ isWebGLRenderer: true, extensions: { has: () => false } }), false);
const prefs = { battleRealism: 'on', sceneLight: false };
assert.equal(battlePrefs(prefs).sceneLight, true);
prefs.battleRealism = 'off';
assert.equal(battlePrefs(prefs).sceneLight, false);
prefs.battleRealism = 'custom';
assert.equal(battlePrefs(prefs).sceneLight, false);
console.log('Linear scene: archive entry points, color vs factor blends, fallback and master overrides passed.');
