// Scene-local presentation; world units are Z-up. Never feed camera- or weather-dependent
// values back to the simulation. fieldLook = (air density, lowland elevation, footprint filter, authored clear distance).
export function lowland(t) {
  const h = t?.heights;
  if (!h?.length) return 0;
  const values = [];
  for (let i = 0; i < h.length; i += Math.max(1, Math.ceil(h.length / 1024))) if (Number.isFinite(h[i])) values.push(h[i]);
  values.sort((a, b) => a - b);
  return values[values.length >> 2] ?? 0;
}
export function airDensity(fog, level) {
  if (!fog?.on || !(fog.end > 0)) return 0;
  return (1 + 0.32 * Math.min(1, Math.max(0, level || 0))) / Math.max(1150, Math.min(5400, fog.end * 0.84));
}
// Average three densities along the actual eye ray (Simpson weights). Close subjects retain
// contrast; a long ray through low terrain scatters more than one above the ridge.
export function airShader(wg) {
  const p = wg ? 'P.' : '',
    f = wg ? 'let' : 'float';
  return `
${wg ? 'fn airDepth(at: vec3f) -> f32' : 'float airDepth(vec3 at)'} {
 if (${p}fieldLook.x<=0.0){return 0.0;}
 ${f} eye=${p}cameraPosition.z-${p}fieldLook.y;
 ${f} endZ=at.z-${p}fieldLook.y;
 ${f} column=1.0-(smoothstep(0.0,270.0,eye)+4.0*smoothstep(0.0,270.0,0.5*(eye+endZ))+smoothstep(0.0,270.0,endZ))/6.0;
 ${f} optical=max(0.0,distance(${p}cameraPosition,at)-max(110.0,${p}fieldLook.w))*${p}fieldLook.x*(0.2+0.8*column);
 return min(0.42,1.0-exp(-optical));
}`;
}
// Pixel footprint in source texels. Increase the reconstruction footprint only where a
// source texel no longer occupies a full pixel. No history, jitter, screen-space blur or
// neighbor across a silhouette. Color/normal use the same LOD; leave alpha masks untouched.
export function footprintShader(wg) {
  return wg
    ? `fn detailWidth(dx:vec2f,dy:vec2f,dims:vec2f)->f32 { return 1.0+P.fieldLook.z*0.88*smoothstep(0.78,2.8,max(length(dx*dims),length(dy*dims))); }`
    : `float detailWidth(vec2 dx,vec2 dy,vec2 dims){return 1.0+fieldLook.z*0.88*smoothstep(0.78,2.8,max(length(dx*dims),length(dy*dims)));}`;
}
// The cloud UVs scroll by +drift, so the shadows travel in -drift. Preserve an explicitly
// still or untextured sky, rather than manufacturing a breeze inside an unknown mod map.
export function windVector(clouds, time, weather, out) {
  const d = clouds?.drift,
    x = -Number(d?.[0] || 0),
    y = -Number(d?.[1] || 0),
    n = Math.hypot(x, y);
  if (!clouds?.texture || !(n > 0)) {
    out.fill(0);
    return out;
  }
  const speed = Math.min(28, n * 0.64) * (1 + 0.35 * Math.min(1, Math.max(0, weather?.level || 0)));
  out[0] = (x / n) * speed;
  out[1] = (y / n) * speed;
  out[2] = time;
  out[3] = 1;
  return out;
}
// Shared travelling gust in world coordinates. Sampled once per emitter step or plant
// anchor, not per particle/leaf fragment. Direction and amplitude survive camera turns.
export function gust(x, y, w) {
  return 0.79 + 0.21 * Math.sin(0.009 * x + 0.014 * y - w[2] * 1.37) + 0.13 * Math.sin(-0.018 * x + 0.007 * y - w[2] * 0.67);
}
export function bendShader(wg) {
  const p = wg ? 'P.fieldWind' : 'fieldWind',
    f = wg ? 'let' : 'float';
  return `
 if (${p}.w>0.0){
  ${f} gust=0.79+0.21*sin(0.009*wp.x+0.014*wp.y-${p}.z*1.37)+0.13*sin(-0.018*wp.x+0.007*wp.y-${p}.z*0.67);
  ${f} tip=clamp((wp.z-mm[3].z)*0.045,0.0,2.8);
  wp.x+=${p}.x*gust*tip*0.105; wp.y+=${p}.y*gust*tip*0.105;
 }`;
}
export function leafy(shader, texture) {
  return (
    /^(?:grass|tree)\.fx$/i.test(shader) ||
    (/alpha/i.test(shader) && /leaf|leaves|foliage|fern|grass|shrub|bush|frond|canopy/i.test(texture || ''))
  );
}
export function airborne(e, key) {
  const label = [key, e.name, e.texture].join(' ');
  if (
    e.heat ||
    e.weather ||
    e.objectSpace ||
    e.stretch ||
    e.trail ||
    e.slave ||
    /laser|bolt|muzzle|engine|spark|debris|splash|water|snow|wake/i.test(label)
  )
    return false;
  return /smoke|dust|foot[_-]?puff/i.test(label) || (e.wind && e.blend !== 1 && e.blend !== 4);
}
