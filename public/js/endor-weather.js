// A renderer-only response to the mounted liquid phases. No RNG, phase writes or new lightning.
import { rainfall } from './groundrain.js';
const unit = x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
export class ForestWeather {
  cover = 0;
  rain = 0;
  wet = 0;
  update(wx, dt, saturation) {
    this.rain = rainfall(wx);
    // A diffuse sky outlasts the falling drops. Frozen and paused frames cannot age it.
    if (dt > 0 && Number.isFinite(dt)) this.cover += (this.rain - this.cover) * -Math.expm1(-dt / (this.rain > this.cover ? 3.6 : 12));
    if (this.rain === 0 && this.cover < 0.0001) this.cover = 0;
    this.wet = unit(saturation);
  }
  begin(L, amount, allowMist, allowWet = true, lightWorld = true) {
    const k = unit(amount),
      c = this.cover * k;
    L.forestWeather.value.set(c, k * this.rain, allowWet ? k * this.wet : 0, allowMist ? k : 0);
    if (c <= 0 || !lightWorld) return; // The weather library can own incident light while we still supply canopy wetness.
    // Light only the world pass (including water reflection). Do not accumulate transforms,
    // touch the authored sky angle, or steal fillColor2 from bombardment/lightning flashes.
    const colors = (this.colors ||= ['sunColor', 'sunSpecular', 'fillColor', 'ambient', 'fogTint'].map(key => [
      L[key].value,
      L[key].value.clone()
    ]));
    for (const [color, saved] of colors) saved.copy(color);
    this.bound = true;
    colors[0][0].multiplyScalar(1 - 0.8 * c);
    colors[1][0].multiplyScalar(1 - 0.83 * c);
    const sky = colors[0][1];
    colors[2][0].setRGB(
      colors[2][1].r * (1 - 0.2 * c) + sky.r * 0.045 * c,
      colors[2][1].g * (1 - 0.13 * c) + sky.g * 0.09 * c,
      colors[2][1].b + sky.b * 0.19 * c
    );
    colors[3][0].setRGB(colors[3][1].r * (1 - 0.22 * c), colors[3][1].g * (1 - 0.1 * c), colors[3][1].b * (1 + 0.06 * c));
    if (allowMist) {
      const fog = colors[4][0],
        y = 0.2126 * fog.r + 0.7152 * fog.g + 0.0722 * fog.b;
      fog.setRGB(fog.r * (1 - 0.72 * c) + 0.51 * y * c, fog.g * (1 - 0.72 * c) + 0.62 * y * c, fog.b * (1 - 0.72 * c) + 0.68 * y * c);
    }
  }
  end(L) {
    if (this.bound) {
      for (const [color, saved] of this.colors) color.copy(saved);
      this.bound = false;
    }
    L.forestWeather.value.set(0, 0, 0, 0);
  }
}
// Authored sky is still visible underneath. This is a dome response, not a screen overlay.
export function showerSky(wg) {
  const p = wg ? 'P.' : '',
    v = wg ? 'vec3f' : 'vec3';
  return `mix(sky,${v}(.60,.68,.74)*(.20+.68*dot(sky,${v}(.2126,.7152,.0722))),.84*${p}forestWeather.x)`;
}
// One fixed-budget sample of incident light along each third of a short view ray. Trace
// the wide sun map (one depth comparison per sample). Accumulate scattering
// up to the receiver only. Low view angles give the clearest read through layers of trees.
export function forestAir(wg, leaf, pos, col) {
  const p = wg ? 'P.' : '',
    f = wg ? 'let' : 'float',
    V = wg ? 'let' : 'vec3',
    h = leaf ? (wg ? 'v.stemHeight' : 'stemHeight') : '0.0';
  return `if(${p}forestWeather.w>0. && ${p}landStyle.y>0.){
    ${V} path=${pos}-${p}cameraPosition; ${f} d=length(path);
    ${f} lengthInAir=min(d,360.)*(1.-smoothstep(280.,730.,${p}landStyle.z));
    if(lengthInAir>1.){
      ${V} ray=path/max(d,.01); ${wg ? 'var scatter=0.0' : 'float scatter=0.0'};
      for(${wg ? 'var j=0' : 'int j=0'}; j<3; j++){
        ${f} travel=lengthInAir*(${wg ? 'f32' : 'float'}(j)+.5)/3.;
        ${V} point=${pos}-ray*travel;
        ${f} height=max(0.,${h}-ray.z*travel);
        ${wg ? 'var lit=1.0' : 'float lit=1.0'};
        if(${p}shadowOn>.5){
          ${V} q=(${p}shadowMatrix*${wg?'vec4f':'vec4'}(point,1.)).xyz;
          if(${wg?'all(q>=vec3f(0.)) && all(q<=vec3f(1.))':'all(greaterThanEqual(q,vec3(0.))) && all(lessThanEqual(q,vec3(1.)))'}){
            lit=${wg?'textureSampleCompareLevel(shadowMap,shadowS,q.xy,q.z)':'texture(shadowMap,q)'};
          }
        }
        scatter+=lit*(1.-smoothstep(84.,190.,height));
      }
      ${f} cloud=${p}forestWeather.x;
      ${f} facing=.22+.78*pow(max(0.,dot(ray,${p}sunDir)),3.);
      ${f} fog=(1.-exp(-lengthInAir*(.00048+.0019*cloud)))*${p}forestWeather.w*sqrt(${p}landStyle.y);
      ${col}=mix(${col},${p}fogTint,min(.31,fog*(.27+.60*cloud)))+${p}sunColor*(fog*scatter/3.*facing*(1.-cloud));
    }
  }`;
}
// Rain impacts live in water-plane coordinates. Fade before the rings are subpixel at command zoom.
export function ringShader(wg) {
  const f = wg ? 'let' : 'float',
    v = wg ? 'vec2f' : 'vec2',
    V = wg ? 'let' : 'vec2';
  return `${wg ? 'fn showerRing(pos:vec2f,t:f32)->vec2f' : 'vec2 showerRing(vec2 pos,float t)'}{
 ${V} grid=pos*.19; ${V} id=floor(grid);
 ${V} seed=fract(sin(${v}(dot(id,${v}(27.13,43.71)),dot(id,${v}(17.91,71.18))))*4137.53);
 ${V} delta=fract(grid)-(.34+.32*seed); ${f} r=length(delta); ${f} phase=fract(t*(.88+seed.y*.53)+seed.x);
 ${f} pulse=(r-.30*phase)*37.; ${f} fade=1.-smoothstep(.032,.12,max(fwidth(grid).x,fwidth(grid).y));
 return (delta/max(.012,r))*(sin(pulse)*exp(-pulse*pulse*.52)*(1.-phase)*smoothstep(.02,.18,phase)*fade);
}`;
}
