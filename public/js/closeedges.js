// A close flyby can afford more spatial samples than a fleet-wide camera. Don't undo a
// performance preset, stack with full-scene SSAA, or allocate above the existing UHD ceiling.
import { battleScale } from './imagesampling.js';
export function closeEdgeDensity(near, prefs, width, height, maxDimension = 8192, fallback = false) {
  if (
    !near ||
    prefs.closeHullEdges !== true ||
    prefs.aa === false ||
    battleScale(prefs) !== 1 ||
    Number(prefs.supersample) > 1 ||
    Number(prefs.scale) < 1 ||
    !(width > 0 && height > 0)
  )
    return 1;
  const budget = Math.min(fallback ? 4 / 3 : 1.5, Math.sqrt((3840 * 2160) / (width * height)), maxDimension / Math.max(width, height));
  return budget >= 1.125 ? budget : 1;
}

// Integrate the actual high-resolution texels covered by ONE destination pixel. At
// 1–1.5x that is at most 3x3 texels. Fold the first two weights on each axis into
// one linear read. No history, jitter, negative lobes, gamma conversion or HDR clamp.
export function closeAreaShader(wg) {
  const v = wg ? 'vec2f' : 'vec2',
    def = wg ? 'let' : v;
  const read = coord => (wg ? `textureSampleLevel(mapT,mapS,${coord},0.0).rgb` : `textureLod(map,${coord},0.0).rgb`);
  const size = wg ? 'vec2f(textureDimensions(mapT,0))' : 'vec2(textureSize(map,0))';
  const span = wg ? 'D.sourceSpan' : 'sourceSpan';
  return `${wg ? 'fn areaResolve(uv:vec2f)->vec3f' : 'vec3 areaResolve(vec2 uv)'} {
  ${def} size=${size}; ${def} span=${span};
  ${def} start=uv*size-0.5*span; ${def} cell=floor(start);
  ${def} w0=min(span,1.0-fract(start)); ${def} w1=clamp(span-w0,${v}(0.0),${v}(1.0));
  ${def} mix2=clamp((span-w0-w1)/span,${v}(0.0),${v}(1.0));
  ${def} a=(cell+0.5+w1/(w0+w1))/size; ${def} b=(cell+2.5)/size;
  return mix(mix(${read('a')},${read(`${v}(b.x,a.y)`)},mix2.x),mix(${read(`${v}(a.x,b.y)`)},${read('b')},mix2.x),mix2.y);
}`;
}
export const CLOSE_RESOLVE = `// close-up area resolve\nuniform sampler2D map; uniform vec2 sourceSpan; varying vec2 vUv;\n${closeAreaShader(false)}\nvoid main(){gl_FragColor=vec4(areaResolve(vUv),1.0);}`;
