// One surface response for the two tactical backends. `base` is linear diffuse reflectance;
// the mounted gloss (not metalness) controls the width of a finite, restrained highlight.
export const BLAST_SLOTS = 4;
export function blastShader(wgsl) {
  const v = wgsl ? 'vec3f' : 'vec3',
    f = wgsl ? 'f32' : 'float';
  const args = [
    ['d', v],
    ['invR', f],
    ['energy', v],
    ['n', v],
    ['eye', v],
    ['base', v],
    ['mask', v],
    ['g', f]
  ]
    .map(([name, type]) => (wgsl ? `${name}: ${type}` : `${type} ${name}`))
    .join(', ');
  const F = wgsl ? 'let' : f,
    V = wgsl ? 'let' : v;
  return `${wgsl ? 'fn' : v} blastBounce(${args})${wgsl ? ' -> vec3f' : ''} {
    ${F} q = dot(d,d) * invR * invR;
    if (q >= 1.0) { return ${v}(0.0); }
    ${V} l = d / max(length(d),0.001);
    ${F} nl = max(dot(n,l),0.0);
    ${V} h = (l+eye) / max(length(l+eye),0.001);
    ${F} glossiness = clamp(g,0.0,1.0);
    ${F} shine = pow(max(dot(n,h),0.0), mix(5.0,48.0,glossiness));
    ${F} falloff = (1.0-q)*(1.0-q)/(1.0+5.0*q);
    return energy * (falloff * nl) * (base + mask * ((0.035+0.24*glossiness)*shine));
  }`;
}
