import { families, simple } from './programs.js';
import { impactVertex, impactFragment } from '../impactshader.js';
import './programs-galactic.js';
import { spatialShader } from '../spatialupscale.js';
import { closeAreaShader, CLOSE_RESOLVE } from '../closeedges.js';
import { cubicShader, postVertex as POST_VERT } from '../imagesampling.js';
import { contactWGSL } from '../game/contactshade.js';

const f32 = (...xs) => {
  let v = Math.fround(xs[0]);
  for (let i = 1; i < xs.length; i++) v = Math.fround(v * Math.fround(xs[i]));
  return v.toPrecision(9);
};
const only = (m, ...names) => !!m.uniforms && Object.keys(m.uniforms).length === names.length && names.every(n => n in m.uniforms);

const impactPatch = simple({
  name: 'hull-impact-patch', match: m => m.isShaderMaterial && m.vertexShader === impactVertex,
  params: [['damageStage','v2']], vertex: () => [['position',3,0],['uv',2,1]],
  code: () => `struct In { @location(0) p:vec3f,@location(1) uv:vec2f } struct Out { @builtin(position) pos:vec4f,@location(0) uv:vec2f }
  @vertex fn vs(v:In)->Out { var o:Out; o.pos=glDepth(P.proj*D.modelView*vec4f(v.p,1.0)); o.uv=v.uv; return o; }` + impactFragment(true)
});

const sprites = simple({
  name: 'sprites',
  textures: ['map'],
  soft: true,
  match: m =>
    m.isShaderMaterial &&
    only(m, 'map') &&
    m.vertexShader.startsWith('attribute vec4 center; attribute vec4 tint; varying vec2 vUv; varying vec4 vTint;'),
  vertex: () => [['position', 3, 0]],
  perInstance: [
    ['center', 4, 1],
    ['tint', 4, 2]
  ],
  code: () => `
struct VIn { @location(0) position: vec3f, @location(1) center: vec4f, @location(2) tint: vec4f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f, @location(1) vTint: vec4f, @location(2) vView: vec2f }
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.vUv = i.position.xy * 0.5 + 0.5; o.vTint = i.tint;
  var mv = P.view * vec4f(i.center.xyz, 1.0);
  o.vView = vec2f(-mv.z, i.center.w);
  mv = vec4f(mv.xy + i.position.xy * i.center.w, mv.zw);
  o.pos = glDepth(P.proj * mv);
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let t = textureSample(mapT, mapS, v.vUv);
  return vec4f(t.rgb * v.vTint.rgb * v.vTint.a * t.a * softFade(v.pos, v.vView), 1.0);
}`
});

const beams = simple({
  name: 'beams',
  textures: ['map'],
  match: m =>
    m.isShaderMaterial && only(m, 'map') && m.vertexShader.startsWith('attribute vec4 tail; attribute vec4 head; attribute vec3 tint;'),
  vertex: () => [['position', 3, 0]],
  perInstance: [
    ['tail', 4, 1],
    ['head', 4, 2],
    ['tint', 3, 3]
  ],
  code: () => `
struct VIn { @location(0) position: vec3f, @location(1) tail: vec4f, @location(2) head: vec4f, @location(3) tint: vec3f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f, @location(1) vTint: vec3f }
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.vTint = i.tint; o.vUv = vec2f(i.position.x * 0.5 + 0.5, i.position.y);
  let a = P.view * vec4f(i.tail.xyz, 1.0); let b = P.view * vec4f(i.head.xyz, 1.0);
  var d = b.xy - a.xy; let l = length(d); d = select(vec2f(0.0, 1.0), d / l, l > 1e-4);
  var p = mix(a, b, i.position.y); p = vec4f(p.xy + vec2f(-d.y, d.x) * i.position.x * i.tail.w, p.zw);
  o.pos = glDepth(P.proj * p);
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let t = textureSample(mapT, mapS, v.vUv);
  return vec4f(v.vTint * t.r * 2.2 + vec3f(t.a) * 0.55, 1.0);
}`
});

const ringCut = simple({
  name: 'ringCut',
  textures: ['map'],
  match: m =>
    m.isShaderMaterial &&
    only(m, 'map') &&
    m.vertexShader.startsWith(
      'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix'
    ),
  vertex: () => [
    ['position', 3, 0],
    ['uv', 2, 1]
  ],
  code: (m, instanced) => `
struct VIn { @location(0) position: vec3f, @location(1) uv: vec2f, ${instanced ? '@location(8) im0: vec4f, @location(9) im1: vec4f, @location(10) im2: vec4f, @location(11) im3: vec4f,' : ''} }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f }
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.vUv = i.uv;
  ${instanced ? 'let im = mat4x4f(i.im0, i.im1, i.im2, i.im3);' : 'let im = mat4x4f(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);'}
  o.pos = glDepth(P.proj * P.view * D.model * im * vec4f(i.position, 1.0));
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let t = textureSample(mapT, mapS, v.vUv);
  if (max(t.r, max(t.g, t.b)) * t.a < 0.5) { discard; }
  return vec4f(0.0);
}`
});

const spaceFog = simple({
  name: 'spaceFog',
  textures: ['state', 'grid', 'gridRed'],
  params: [
    ['cells', 'v2'],
    ['tint', 'c3'],
    ['tintRed', 'c3'],
    ['haveGrid', 'f'],
    ['placing', 'f'],
    ['redLit', 'f']
  ],
  match: m => m.isShaderMaterial && !!m.uniforms && !!m.uniforms.state && !!m.uniforms.gridRed && !!m.uniforms.tintRed,
  vertex: () => [
    ['position', 3, 0],
    ['uv', 2, 1]
  ],
  code: () => `
struct VIn { @location(0) position: vec3f, @location(1) uv: vec2f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f }
@vertex fn vs(i: VIn) -> VOut { var o: VOut; o.vUv = i.uv; o.pos = glDepth(P.proj * D.modelView * vec4f(i.position, 1.0)); return o; }
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let m = v.vUv * 3.0 - 1.0;
  let inside = step(0.0, m.x) * step(m.x, 1.0) * step(0.0, m.y) * step(m.y, 1.0);
  let fog = mix(1.0, textureSample(stateT, stateS, clamp(m, vec2f(0.0), vec2f(1.0))).r, inside);
  let t = m * D.cells;
  let g = textureSample(gridT, gridS, t); let r = textureSample(gridRedT, gridRedS, t);
  let cellMask = smoothstep(0.1, 0.34, max(g.r, max(g.g, g.b)));
  let blue = mix(vec3f(0.0), vec3f(0.78, 0.8, 0.84) * D.tint, cellMask);
  let blueA = mix(0.32, 0.09, cellMask);
  let redMask = smoothstep(0.2, 0.6, r.r);
  let red = mix(mix(blue * 0.35, r.rgb * D.tintRed, cellMask), r.rgb * D.tintRed, D.redLit);
  let redA = mix(blueA, mix(0.05, 0.42, redMask), D.redLit);
  var col = mix(blue, red, D.placing);
  var a = mix(blueA, redA, D.placing);
  col = mix(vec3f(0.008, 0.02, 0.04), col, D.haveGrid);
  a = mix(0.72, a, D.haveGrid);
  return vec4f(col, a * fog);
}`
});

const screenVS = `
struct VIn { @location(0) position: vec3f, @location(1) uv: vec2f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f }
@vertex fn vs(i: VIn) -> VOut { var o: VOut; o.vUv = i.uv; o.pos = glDepth(vec4f(i.position.xy, 0.0, 1.0)); return o; }`;
const screen = (name, test, spec) =>
  simple({
    name,
    vertex: () => [
      ['position', 3, 0],
      ['uv', 2, 1]
    ],
    match: m => m.isShaderMaterial && m.vertexShader === POST_VERT && test(m.fragmentShader, m),
    ...spec
  });

import { displayEnergy, energyBloom } from '../sceneenergy.js';

const bright = screen('bright', f => f.includes('uniform float cutoff;'), {
  textures: ['map'],
  params: [['cutoff', 'f'], ['deepGlow','f']],
  code: () =>
    screenVS +
    `
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let signal = textureSample(mapT, mapS, v.vUv).rgb;
  if (D.deepGlow>1.5) {return vec4f(energyBright(signal),1.0);}
  let c = clamp(signal, vec3f(0.0), vec3f(1.0)); let c2 = c * c;
  var emission = select(c * c2 * c2, c, dot(c, vec3f(0.299, 0.587, 0.114)) > D.cutoff);
  if (D.deepGlow > 0.5) { emission = c*smoothstep(0.68,0.99,max(c.r,max(c.g,c.b))); }
  return vec4f(emission + max(signal - 1.0, vec3f(0.0)), 1.0);
}
fn energyBright(signal:vec3f)->vec3f{${energyBloom(true)}}`
});

const blur = screen('blur', f => f.includes('uniform vec2 offset;'), {
  textures: ['map'],
  params: [['offset', 'v2']],
  code: () =>
    screenVS +
    `
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let o = D.offset; let p = vec2f(D.offset.x, -D.offset.y);
  return vec4f((textureSample(mapT, mapS, v.vUv + o).rgb + textureSample(mapT, mapS, v.vUv - o).rgb + textureSample(mapT, mapS, v.vUv + p).rgb + textureSample(mapT, mapS, v.vUv - p).rgb) * 0.25, 1.0);
}`
});

const streak = screen('streak', f => f.includes('vec3 hot(vec2 uv)'), {
  textures: ['map'],
  code: () => screenVS + `
fn hot(uv:vec2f) -> vec3f {
  let c = textureSampleLevel(mapT,mapS,uv,0.0).rgb;
  return c * smoothstep(0.50,0.92,max(max(c.r,c.g),c.b));
}
@fragment fn fs(v:VOut) -> @location(0) vec4f {
  var sum = 0.16*hot(v.vUv);
  for (var i=1; i<=6; i++) {
    let k=f32(i)/6.0; let d=vec2f(k*k*0.018,0.0);
    sum += (hot(v.vUv-d)+hot(v.vUv+d))*(0.13-0.085*k);
  }
  return vec4f(sum,1.0);
}`
});

const closeResolve = screen('close-area-resolve', f=>f===CLOSE_RESOLVE, {
  textures:['map'], params:[['sourceSpan','v2']],
  code:()=>screenVS+closeAreaShader(true)+'\n@fragment fn fs(v:VOut)->@location(0) vec4f { return vec4f(areaResolve(v.vUv),1.0); }'
});

const spatial = ['easu','rcas','lanczos'].map(pass => screen('spatial-'+pass, f => f.startsWith('// spatial-pass:'+pass+'\n'), {
  textures: ['map'], params: [['amount','f'],['extended','f'],['paired','f']],
  code: () => screenVS + spatialShader('wgsl',pass) + '\n@fragment fn fs(v:VOut)->@location(0) vec4f { return vec4f(filterPixel(v.vUv),1.0); }'
}));

const upscale = screen('upscale', f => f.includes('uniform float upscaleBlend;'), {
  textures: ['map'], params: [['upscaleBlend','f']],
  code: () => screenVS + cubicShader('wgsl') + `
@fragment fn fs(v:VOut)->@location(0) vec4f {
  var rgb=textureSampleLevel(mapT,mapS,v.vUv,0.0).rgb;
  if (D.upscaleBlend>0.0) { rgb=mix(rgb,cubicRGB(v.vUv,vec2f(textureDimensions(mapT,0))),D.upscaleBlend); }
  return vec4f(rgb,1.0);
}`
});

const combine = depth => screen(depth ? 'combineAO-' + depth : 'combine', (f,m) => f.includes('vec3 smoothEdges(vec2 uv)') &&
  depth === (m.defines?.CONTACT_SHADE ? (m.defines.CONTACT_MS ? 'multi' : 'single') : null), {
  contactDepth: depth,
  textures: ['scene', 'glow', 'heat', 'streak', ...(depth ? ['contactSurface'] : [])],
  params: [
    ['texel', 'v2'],
    ['bloom', 'f'],
    ['haze', 'f'],
    ['glare', 'f'],
    ['edges', 'f'], ['displayLight','f'],
    ...(depth ? [['contactParams','v4'],['waterPlane','v4'],['terrainContactMask','f'],['contactMaxSpan','f']] : [])
  ],
  code: () =>
    screenVS + displayEnergy(true) + (depth ? contactWGSL : '') +
    `
const L = vec3f(0.299, 0.587, 0.114);
fn smoothEdges(uv: vec2f) -> vec3f {
  let tx = D.texel;
  let nw = textureSampleLevel(sceneT, sceneS, uv + vec2f(-1.0, -1.0) * tx, 0.0).rgb; let ne = textureSampleLevel(sceneT, sceneS, uv + vec2f(1.0, -1.0) * tx, 0.0).rgb;
  let sw = textureSampleLevel(sceneT, sceneS, uv + vec2f(-1.0, 1.0) * tx, 0.0).rgb; let se = textureSampleLevel(sceneT, sceneS, uv + vec2f(1.0, 1.0) * tx, 0.0).rgb;
  let m = textureSampleLevel(sceneT, sceneS, uv, 0.0).rgb;
  let lnw = dot(nw, L); let lne = dot(ne, L); let lsw = dot(sw, L); let lse = dot(se, L); let lm = dot(m, L);
  let lo = min(lm, min(min(lnw, lne), min(lsw, lse))); let hi = max(lm, max(max(lnw, lne), max(lsw, lse)));
  var dir = vec2f(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  let reduce = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), vec2f(-8.0), vec2f(8.0)) * tx;
  let a = 0.5 * (textureSampleLevel(sceneT, sceneS, uv + dir * (${f32(1 / 3)} - 0.5), 0.0).rgb + textureSampleLevel(sceneT, sceneS, uv + dir * (${f32(2 / 3)} - 0.5), 0.0).rgb);
  let b = a * 0.5 + 0.25 * (textureSampleLevel(sceneT, sceneS, uv - dir * 0.5, 0.0).rgb + textureSampleLevel(sceneT, sceneS, uv + dir * 0.5, 0.0).rgb);
  let lb = dot(b, L);
  return select(b, a, lb < lo || lb > hi);
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  var uv = v.vUv;
  let hz = textureSample(heatT, heatS, v.vUv).rg - 0.5;
  if (D.haze > 0.0) { uv += hz * step(0.006, max(abs(hz.x), abs(hz.y))) * D.haze; }
  var c:vec3f;
  if (D.edges>0.5) { c=smoothEdges(uv); } else { c=textureSampleLevel(sceneT,sceneS,uv,0.0).rgb; }
  ${depth ? 'c *= mix(contactVisibility(uv),1.0,smoothstep(0.65,1.0,max(max(c.r,c.g),c.b)));' : ''}
  let gl = textureSample(glowT, glowS, v.vUv).rgb;
  if(D.displayLight>0.0) {c+=gl*D.bloom*0.15;}
  else if (D.bloom > 0.0) {
    let g = clamp(gl * D.bloom, vec3f(0.0), vec3f(1.0));
    let base = clamp(c, vec3f(0.0), vec3f(1.0));
    c = base + g * (1.0 - base) + max(c - 1.0, vec3f(0.0)) + max(gl - 1.0, vec3f(0.0)) * D.bloom;
  }
  if (D.glare > 0.0) { c += textureSampleLevel(streakT,streakS,v.vUv,0.0).rgb * D.glare * vec3f(0.72,0.87,1.0); }
  if(D.displayLight>0.0){c=orbitEncode(select(orbitShoulder(c),c,D.displayLight>1.5));}
  return vec4f(c, 1.0);
}`
});

const flare = simple({
  name: 'flare',
  textures: ['map'],
  params: [
    ['cell', 'c3'],
    ['tint', 'c3'],
    ['level', 'f']
  ],
  match: m =>
    m.isShaderMaterial && only(m, 'map', 'cell', 'tint', 'level') && m.vertexShader.startsWith('uniform vec3 cell; varying vec2 vUv;'),
  vertex: () => [
    ['position', 3, 0],
    ['uv', 2, 1]
  ],
  code: () => `
struct VIn { @location(0) position: vec3f, @location(1) uv: vec2f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f }
@vertex fn vs(i: VIn) -> VOut { var o: VOut; o.vUv = (D.cell.xy + vec2f(i.uv.x, 1.0 - i.uv.y)) * D.cell.z; o.pos = glDepth(P.proj * D.modelView * vec4f(i.position, 1.0)); return o; }
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let t = textureSample(mapT, mapS, v.vUv);
  return vec4f(t.rgb * D.tint * t.a * D.level, 1.0);
}`
});

families.push(impactPatch, sprites, beams, ringCut, spaceFog, bright, blur, streak, upscale, closeResolve, ...spatial, combine(null), combine('single'), combine('multi'), flare);
