import { toLinear } from './orbitcolor.js';

// The disk was rendered in display RGB against transparent black. Average radiance in linear light.
export function diskRadiance(bytes) {
  const rgb = [0, 0, 0];
  let weight = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const a = bytes[i + 3] / 255;
    weight += a;
    for (let c = 0; c < 3; c++) rgb[c] += a * toLinear(bytes[i + c] / 255);
  }
  return rgb.map(x => (weight ? x / weight : 0));
}

// Distance (in planet radii) to the top of a thin spherical shell. Rationalized to avoid
// cancellation at nadir. One in-scatter and transmission term, not a uniform outline.
export function airColumn(wg) {
  const f = wg ? 'let' : 'float',
    mu = wg ? 'v.vFacing' : 'vFacing',
    light = wg ? 'v.vLight.z' : 'vLight.z',
    air = wg ? 'U.atmosphere' : 'atmosphere',
    sun = wg ? 'U.sunColor' : 'sunColor';
  return `
    ${f} mu=clamp(${mu},0.0,1.0);
    ${f} column=2.016/(sqrt(mu*mu+0.032256)+mu);
    ${f} day=smoothstep(-0.10,0.26,${light});
    ${f} scatter=1.0-exp(-0.14*max(${air}.a,0.0)*column);
    ${f} tint=max(${air}.r,max(${air}.g,${air}.b));
    ${f} veil=scatter*day*clamp(tint,0.0,1.0);
    rgb=rgb*(1.0-veil)+${sun}*${air}.rgb*(1.55*scatter*day);
  `;
}

// Diffuse irradiance of an extended disk: proportional to its projected solid angle (r/d)^2.
// Smooth the cosine only where part of the source straddles the receiver's horizon.
export function diskBounce(wg, paint) {
  const v = wg ? 'vec3f' : 'vec3',
    f = wg ? 'let' : 'float',
    p = wg ? 'P.' : '',
    pos = wg ? 'v.vWorldPos' : 'vWorldPos';
  return `
  if (${p}planetDisk.w>0.0) {
    ${wg ? 'let' : 'vec3'} delta=${p}planetDisk.xyz-${pos};
    ${f} invD=${wg ? 'inverseSqrt' : 'inversesqrt'}(max(dot(delta,delta),1.0));
    ${f} radius=min(1.0,${p}planetDisk.w*invD);
    ${f} cosine=dot(n,delta)*invD;
    ${f} fringe=clamp(cosine+radius,0.0,2.0*radius);
    ${f} facing=max(cosine,fringe*fringe/(4.0*max(radius,0.00001)));
    if (facing>0.0) {
      if(mapShadow) {col*=mix(${p}shadowTint,${v}(1.0),shadowLit); mapShadow=false;}
      ${wg ? 'let' : 'vec3'} bounce=${paint}*${p}planetRadiance*radius*radius*facing;
      col=${wg ? 'select(orbitEncode(orbitDecode(max(col,vec3f(0.0)))+bounce),col+bounce,corrected)' : 'corrected ? col+bounce : orbitEncode(orbitDecode(max(col,0.0))+bounce)'};
    }
  }`;
}
