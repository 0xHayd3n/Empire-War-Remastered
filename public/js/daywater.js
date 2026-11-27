// Two passes over the same water sheet: first attenuate the bed, then add the reflected
// scene and in-scattered daylight. Both depend on the same optical path. Linear radiance
// is converted for the legacy multiplicative/additive sheet blend, not added to the HUD.
export function dayWater(wg) {
  const p = wg ? 'P.' : '',
    D = wg ? 'D.' : '',
    v = wg ? 'vec3f' : 'vec3',
    f = wg ? 'let' : 'float',
    c = wg ? 'let' : 'vec3',
    sig = (n, w, g, ret) => (wg ? `fn ${n}(${w})->${ret}` : `${ret === 'f32' ? 'float' : ret} ${n}(${g})`);
  return `${sig('lakeF', 'at:vec3f', 'vec3 at', 'f32')}{
  ${f} cosV=clamp(abs(normalize(${p}cameraPosition-at).z),0.,1.);
  return .0204+.9796*pow(1.-cosV,5.);
}
${sig('lakeT', 'at:vec3f,depth:f32', 'vec3 at,float depth', v)}{
  ${f} cv=abs(normalize(${p}cameraPosition-at).z);${f} cs=clamp(${p}sunDir.z,0.,1.);
  // Refracted view and sun rays (air/water IOR 1.333), not the whole camera-to-bed distance.
  ${f} path=max(0.,depth)*(inverseSqrt(.4375+.5625*cv*cv)+inverseSqrt(.4375+.5625*cs*cs));
  ${c} extinction=(${v}(.067,.036,.030)+.045*(1.-clamp(${D}waterBase.rgb,${v}(0.),${v}(1.))))*mix(1.7,.40,${p}receiverMode.w);
  return exp(-extinction*path);
}
${sig('lakeLd', 'at:vec3f,depth:f32,refl:vec3f', 'vec3 at,float depth,vec3 refl', v)}{
  ${f} fr=lakeF(at);${c} tr=lakeT(at,depth);
  ${c} sky=${p}orbitPos[2]*(1.-.16*${p}forestWeather.x);
  ${c} scatter=(${v}(.052,.10,.11)*sky+.036*${p}landGround.rgb*${p}sunColor)*${D}waterBase.rgb;
  return pow(max(${v}(0.),pow(max(refl,${v}(0.)),${v}(2.2))*fr+scatter*(1.-tr)*(1.-fr)),${v}(1./2.2));
}`.replaceAll('inverseSqrt', wg ? 'inverseSqrt' : 'inversesqrt');
}
