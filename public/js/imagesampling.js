// Battle image reconstruction. No learned detail, render history, or enlarged texture allocations.
export const postVertex = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
export const imageDefaults = Object.freeze({
  textureCubic: false,
  battleScale: 1,
  postAA: 'auto',
  upscaleBlend: 0.85,
  upscaleMethod: 'fsr1',
  nativeSharpen: false
});
export const battleScale = prefs => ([0.9, 0.77, 0.67, 0.5].includes(prefs.battleScale) ? prefs.battleScale : 1);
export const upscaleMethod = prefs => (['fsr1', 'lanczos', 'bilinear'].includes(prefs.upscaleMethod) ? prefs.upscaleMethod : 'bicubic');
export const nativeSharpen = prefs => prefs.nativeSharpen === true && battleScale(prefs) === 1 && prefs.upscaleBlend > 0;
export const imagePostNeeded = prefs => battleScale(prefs) < 1 || nativeSharpen(prefs) || prefs.postAA === 'fxaa';

// Separable Catmull–Rom: fold the two positive middle weights into one hardware bilinear read per axis.
// Cache the taps so a local min/max limiter does not need additional fetches (also preserves extended HDR range).
export function cubicShader(lang, array = false) {
  const wg = lang === 'wgsl',
    v = wg ? 'vec2f' : 'vec2',
    def = wg ? 'let' : v,
    fn = wg
      ? `fn cubicRGB(uv:vec2f, size:vec2f${array ? ', slice:i32' : ''})->vec3f`
      : `vec3 cubicRGB(vec2 uv,vec2 size${array ? ',float slice' : ''})`,
    read = p =>
      wg
        ? `textureSampleLevel(mapT,mapS,${p},${array ? 'slice,' : ''}0.0).rgb`
        : `textureLod(map,${array ? `vec3(${p},slice)` : p},0.0).rgb`;
  let code = `${fn} {
  ${def} cell=floor(uv*size-0.5)+0.5;
  ${def} f=uv*size-cell;
  ${def} w0=f*(-0.5+f*(1.0-0.5*f));
  ${def} w1=1.0+f*f*(-2.5+1.5*f);
  ${def} w3=0.5*f*f*(f-1.0);
  ${def} w2=1.0-w0-w1-w3;
  ${def} wm=w1+w2;
  ${def} a=(cell-1.0)/size; ${def} b=(cell+w2/wm)/size; ${def} c=(cell+2.0)/size;\n`;
  const names = [],
    terms = [],
    weights = { a: 'w0', b: 'wm', c: 'w3' };
  for (const y of 'abc')
    for (const x of 'abc') {
      const n = `t${x}${y}`;
      code += `  ${wg ? 'let' : 'vec3'} ${n}=${read(`${v}(${x}.x,${y}.y)`)};\n`;
      names.push(n);
      terms.push(`${n}*${weights[x]}.x*${weights[y]}.y`);
    }
  const bounds = op => names.reduce((a, b) => `${op}(${a},${b})`);
  return code + `  return clamp(${terms.join('+')},${bounds('min')},${bounds('max')});\n}\n`;
}
