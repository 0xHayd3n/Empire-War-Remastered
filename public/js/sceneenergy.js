// Archive shaders emit display-authored RGB. Bridge their output BEFORE fixed-function blending,
// preserving alpha, HDR headroom and discard. These variants are for the scene attachment only.
import { CustomBlending, MultiplyBlending, SubtractiveBlending, DstColorFactor, SrcColorFactor, OneMinusSrcColorFactor } from 'three';
// A shadow multiplier or stencil hole is data, not display-authored radiance.
export function colorEmitter(m) {
  return (
    m.colorWrite !== false &&
    m.blending !== MultiplyBlending &&
    m.blending !== SubtractiveBlending &&
    !(
      m.blending === CustomBlending &&
      (m.blendSrc === DstColorFactor || m.blendDst === SrcColorFactor || m.blendDst === OneMinusSrcColorFactor)
    )
  );
}
import { orbitShader } from './orbitcolor.js';
export function incidentRGB(wg) {
  const v = wg ? 'vec3f' : 'vec3',
    pow = `pow((max(x,${v}(0.0))+0.055)/1.055,${v}(2.4))`;
  return wg
    ? `fn incidentRGB(x:vec3f)->vec3f{return select(${pow},max(x,vec3f(0.0))/12.92,x<=vec3f(0.04045));}`
    : `vec3 incidentRGB(vec3 x){return mix(${pow},max(x,0.0)/12.92,lessThanEqual(x,vec3(0.04045)));}`;
}
export function incidentGL(source) {
  return (
    '#define INCIDENT_LIGHT 1\n' +
    source.replace(/\bvoid\s+main\s*\(/, 'void archiveColor(') +
    '\n' +
    incidentRGB(false) +
    '\nvoid main(){archiveColor();gl_FragColor.rgb=incidentRGB(gl_FragColor.rgb);}\n'
  );
}
export function incidentWG(source) {
  // All custom color families take interpolants and optionally the triangle-facing builtin. Keep
  // annotations on the entry only. A wrapper also catches early returns from native FX branches.
  const signature =
    /@fragment\s+fn fs\((\w+)\s*:\s*(\w+)(,\s*@builtin\(front_facing\)\s*(\w+)\s*:\s*bool)?\)\s*->\s*@location\(0\)\s*vec4f\s*\{/;
  const m = source.match(signature);
  if (!m) throw Error('Unsupported incident-light color entry');
  const [, v, type, , face] = m;
  return (
    source.replace(signature, `fn archiveColor(${v}:${type}${face ? ', ' + face + ':bool' : ''})->vec4f {`) +
    '\n' +
    incidentRGB(true) +
    '\n' +
    m[0] +
    `let c=archiveColor(${v}${face ? ', ' + face : ''});return vec4f(incidentRGB(c.rgb),c.a);}`
  );
}
export function displayEnergy(wg) {
  return orbitShader(wg ? 'wgsl' : 'glsl');
}
export function energyBloom(wg) {
  const V = wg ? 'vec3f' : 'vec3';
  return `${wg ? 'let' : 'float'} peak=max(signal.r,max(signal.g,signal.b));\nreturn ${V}(signal*max(0.0,peak-0.72)/max(peak,0.001));`;
}
