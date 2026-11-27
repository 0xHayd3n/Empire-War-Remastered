// Land presentation only. The forecast (including its ease-out clock) belongs to LandWorld.
import { Vector4 } from 'three';
import { sampleFormations } from './sky-formations.js';

// Zenith RGB + fog tint weight; horizon RGB + cloud cover; key-light RGB gains +
// solar glare; diffuse-light RGB gains + clear distance; horizontal stretch of airborne layers.
const look = (zenith, horizon, sun, fill, stretch = 1) => ({ zenith, horizon, sun, fill, stretch });
export const weatherLooks = {
  clear: look([0.1, 0.36, 0.72, 0.96], [0.67, 0.83, 0.95, 0.035], [1.48, 1.39, 1.22, 1], [0.65, 0.76, 0.94, 1.2]),
  lowSun: look([0.24, 0.43, 0.66, 0.68], [0.94, 0.69, 0.48, 0.07], [1.24, 1.12, 0.95, 0.78], [0.78, 0.83, 0.98, 1.1]),
  overcast: look([0.36, 0.42, 0.49, 0.9], [0.72, 0.76, 0.79, 0.49], [0.62, 0.67, 0.72, 0.09], [1, 1.04, 1.08, 0.91]),
  fog: look([0.59, 0.65, 0.69, 0.95], [0.77, 0.81, 0.82, 0.22], [0.53, 0.59, 0.64, 0.06], [1.03, 1.06, 1.08, 0.65]),
  haze: look([0.4, 0.54, 0.67, 0.87], [0.86, 0.81, 0.7, 0.12], [1.09, 1.05, 0.96, 0.6], [1.07, 1.06, 1.02, 0.76]),
  mist: look([0.43, 0.56, 0.63, 0.88], [0.78, 0.83, 0.81, 0.21], [0.89, 0.91, 0.88, 0.34], [1.04, 1.07, 1.09, 0.77]),
  drizzle: look([0.39, 0.48, 0.52, 0.89], [0.67, 0.73, 0.74, 0.36], [0.65, 0.7, 0.71, 0.16], [0.96, 1.05, 1.09, 0.85]),
  downpour: look([0.18, 0.255, 0.3, 0.94], [0.55, 0.62, 0.64, 0.61], [0.27, 0.34, 0.38, 0.045], [0.94, 1.03, 1.1, 0.72]),
  thunderstorm: look([0.125, 0.16, 0.235, 0.95], [0.48, 0.52, 0.6, 0.69], [0.28, 0.3, 0.39, 0.04], [0.92, 0.97, 1.13, 0.76]),
  flurries: look([0.43, 0.59, 0.74, 0.89], [0.81, 0.87, 0.92, 0.22], [0.84, 0.88, 0.98, 0.4], [0.99, 1.06, 1.18, 0.91]),
  sleet: look([0.32, 0.39, 0.49, 0.91], [0.65, 0.72, 0.79, 0.42], [0.47, 0.56, 0.68, 0.11], [0.94, 1.02, 1.13, 0.76]),
  rain: look([0.17, 0.22, 0.28, 0.9], [0.49, 0.58, 0.64, 0.44], [0.31, 0.36, 0.43, 0.035], [0.87, 0.98, 1.12, 0.82]),
  snow: look([0.53, 0.64, 0.76, 0.86], [0.82, 0.87, 0.92, 0.16], [0.65, 0.72, 0.83, 0.16], [0.98, 1.08, 1.18, 0.84]),
  blizzard: look([0.65, 0.73, 0.8, 0.96], [0.86, 0.91, 0.94, 0.21], [0.19, 0.23, 0.28, 0.018], [1.02, 1.12, 1.2, 0.61], 2.8),
  // The direct beam softens, but scattered daylight still reaches the sand and white armour.
  sandstorm: look([0.64, 0.69, 0.72, 0.96], [0.87, 0.82, 0.71, 0.15], [1.04, 1.02, 0.99, 0.52], [1.18, 1.17, 1.14, 0.68], 4.5),
  ash: look([0.22, 0.2, 0.22, 0.85], [0.53, 0.43, 0.38, 0.49], [0.52, 0.35, 0.28, 0.08], [0.86, 0.78, 0.79, 0.76], 1.6)
};
for (const [family, recipe] of Object.entries(weatherLooks)) recipe.family = family;
const mapLight = (family, zenith, horizon, contrast, sun = 0.55) => ({
  family,
  ...look([...zenith, 1], [...horizon, contrast], [1, 1, 1, sun], [1, 1, 1, 1])
});
function skySeed(text) {
  let hash = 2166136261;
  for (const c of text) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}
const clamp = x => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
// Use metadata, not the presence of a working ALO, texture, or reviewed terrain binding.
// A Workshop dome name we have never seen is still an outdoor sky. Its fog supplies a
// local horizon tint; named special atmospheres are not flattened to Earth-blue at noon.
export function weatherContext(env, skyNames = '', map = {}) {
  const name = env?.name || '',
    tags = [name, skyNames, ...Object.keys(env?.skyAngles || {}), ...(env?.landSkies || []).map(t => t.name)].join(' ');
  if (
    /cinematic|interior|indoor|underground|girder_sky/i.test(tags) ||
    /(?:^|[_-])(?:interior|indoor|underground)(?:[_\-.]|$)/i.test(map.file || '')
  )
    return null;
  const night = /night|midnight|star_backdrop/i.test(tags) || (env?.lights?.[0]?.dir?.[2] < -0.12 && !/noon|day/i.test(name));
  const low = /sunrise|sunset|morning|dusk|dawn/i.test(name) || (!/noon/i.test(name) && /evening|dusk|twilight|sunset|sunrise/i.test(tags));
  let base = low ? weatherLooks.lowSun : weatherLooks.clear;
  if (/volcanic|lava/i.test(tags)) base = mapLight('volcanic', [0.28, 0.16, 0.19], [0.91, 0.49, 0.3], 0.23);
  else if (/thin_atmosphere/i.test(tags)) base = mapLight('thin', [0.075, 0.12, 0.23], [0.57, 0.64, 0.73], 0.035, 0.92);
  else if (/smog|murk|kamino/i.test(tags) && !/clear|noon|sunrise/i.test(name))
    base = mapLight('overcast', [0.24, 0.32, 0.37], [0.66, 0.72, 0.69], 0.35, 0.15);
  else if (/bespin/i.test(tags)) base = mapLight('cloudSea', [0.36, 0.46, 0.64], [0.99, 0.77, 0.57], 0.42);
  else if (/overcast|cloudy/i.test(name)) base = weatherLooks.overcast;
  else if (/fog/i.test(name)) base = weatherLooks.fog;
  else if (/mist/i.test(name)) base = weatherLooks.mist;
  else if (/haze|hazy/i.test(name)) base = weatherLooks.haze;
  if (night) base = mapLight('night', [0.05, 0.075, 0.14], [0.22, 0.27, 0.36], 0.13, 0);
  const fog = env?.fog;
  if (fog?.on && fog.color?.length === 3) {
    const tint = !night && !low && !/day_|noon|clear/i.test(tags) ? 0.32 : 0.12;
    base = { ...base, horizon: base.horizon.map((c, i) => (i === 3 ? c : c + (clamp(fog.color[i]) * (night ? 0.38 : 1) - c) * tint)) };
  }
  const place = String(map.planet || map.file || tags),
    climate = [place, map.file, tags].join(' ');
  return {
    base,
    night,
    rings: /planet_rings/i.test(tags),
    seed: skySeed(place),
    patternSeed: skySeed(`${place}|${map.file || ''}|${name}`),
    polar: /(?:^|[^a-z])(?:hoth|polus|polar|aurora|arctic)(?![a-z])/i.test(climate),
    arid: /tatooine|desert|arid|sandstorm/i.test([place, map.file, name].join(' ')),
    woodland: /endor|yavin|kashyyyk|woodland|jungle|forest/i.test(climate),
    scenario: String(env?.weather || '').toUpperCase()
  };
}
export function useWeatherLibrary(mode, stock, remastered) {
  return mode === 'all' || (!!stock && (mode === 'stock' || (mode === 'remasters' && !!remastered)));
}
function phaseLook(name, blizzard, base, strength, lightning) {
  switch (name) {
    case 'clear':
      return base;
    case 'snow':
    case 'snowfall':
      return blizzard ? weatherLooks.blizzard : strength > 0 && strength < 0.3 ? weatherLooks.flurries : weatherLooks.snow;
    case 'flurries':
    case 'light_snow':
      return weatherLooks.flurries;
    case 'sleet':
    case 'freezing_rain':
      return weatherLooks.sleet;
    case 'blizzard':
    case 'whiteout':
      return weatherLooks.blizzard;
    case 'drizzle':
    case 'light_rain':
      return weatherLooks.drizzle;
    case 'downpour':
    case 'heavy_rain':
    case 'squall':
      return weatherLooks.downpour;
    case 'thunderstorm':
    case 'electrical_storm':
      return weatherLooks.thunderstorm;
    case 'rainfall':
    case 'rain':
      return lightning > 0 ? weatherLooks.thunderstorm : strength > 0 && strength < 0.4 ? weatherLooks.drizzle : weatherLooks.rain;
    case 'dust_storm':
      return weatherLooks.sandstorm;
    case 'ashfall':
      return weatherLooks.ash;
    case 'cloudy':
    case 'overcast':
      return weatherLooks.overcast;
    case 'mist':
      return weatherLooks.mist;
    case 'haze':
    case 'hazy':
      return weatherLooks.haze;
    case 'fog':
      return weatherLooks.fog;
    case 'sandstorm':
    case 'ash':
      return weatherLooks[name];
    default:
      return null;
  }
}

export class ImmersiveWeather {
  // Shared by this battle's dome materials, never the HUD or an unrelated sky atlas.
  uniforms = {
    wxZenith: { value: new Vector4(0, 0, 0, 0) },
    wxHorizon: { value: new Vector4() },
    wxOptics: { value: new Vector4() },
    wxFormation: { value: new Vector4() },
    wxPhenomena: { value: new Vector4() }
  };
  dustAir = { value: new Vector4(0, 0, 0, 0) }; // RGB of scattered light + optical weight for the forecast's dust sprites.
  sun = new Vector4();
  fill = new Vector4();
  sample(ctx, wx = { name: 'clear', level: 0 }, time = 0) {
    if (!ctx) return false;
    wx ||= { name: 'clear', level: 0 };
    const { base, night, scenario } = ctx;
    const transition = wx.out && wx.ease > 0 && wx.phases?.length;
    const a = transition ? wx.phases[wx.i] : wx,
      b = transition ? wx.phases[(wx.i + 1) % wx.phases.length] : a;
    if (!a || !b) return this.sample(ctx, { name: 'clear', level: 0 }, time);
    // A script can switch the sky without restarting the active forecast. Its mounted
    // snow emitter distinguishes sleet from a blizzard; it never turns a clear phase into snow.
    const blizzard = wx.emitter ? /^p_snowblizzard\.alo$/i.test(wx.emitter) : scenario.startsWith('BLIZZARD_');
    const A = phaseLook(a.name, blizzard, base, transition ? a.strength : wx.level, a.lightning) || base,
      B = transition ? phaseLook(b.name, blizzard, base, b.strength, b.lightning) || base : A; // Custom weather keeps local daylight, particles, fog and audio.
    const t = transition ? clamp(1 - wx.left / wx.ease) : 0;
    const ka = A === base ? 0 : (1 - t) * clamp(transition ? a.strength : wx.level),
      kb = B === base ? 0 : t * clamp(b.strength);
    const k = 1 - ka - kb,
      U = this.uniforms,
      top = U.wxZenith.value,
      air = U.wxHorizon.value;
    const blend = (out, field) => {
      const x = base[field],
        y = A[field],
        z = B[field];
      return out.set(
        k * x[0] + ka * y[0] + kb * z[0],
        k * x[1] + ka * y[1] + kb * z[1],
        k * x[2] + ka * y[2] + kb * z[2],
        k * x[3] + ka * y[3] + kb * z[3]
      );
    };
    sampleFormations(U, ctx, time, base, A, B, k, ka, kb);
    blend(top, 'zenith');
    blend(air, 'horizon');
    blend(this.sun, 'sun');
    blend(this.fill, 'fill');
    const dust = (A === weatherLooks.sandstorm ? ka : 0) + (B === weatherLooks.sandstorm ? kb : 0);
    U.wxOptics.value.set(night ? 0 : this.sun.w, k * base.stretch + ka * A.stretch + kb * B.stretch, dust, night ? k : 0);
    if (night) {
      for (const c of [top, air]) {
        c.x *= 0.29;
        c.y *= 0.32;
        c.z *= 0.39;
      }
      top.w *= 0.65;
    }
    return true;
  }
  begin(L, ctx, wx) {
    return this.sample(ctx, wx) && this.bind(L);
  }
  bind(L) {
    const top = this.uniforms.wxZenith.value,
      air = this.uniforms.wxHorizon.value,
      dust = this.uniforms.wxOptics.value.z;
    // Change the actual incident light, including measured sky fill. Leave sun direction,
    // flashes, fog of war and the simulation alone. Every draw starts from authored values.
    const saved = (this.saved ||= Object.fromEntries(
      ['sunColor', 'sunSpecular', 'ambient', 'fillColor', 'fogTint', 'fogRange', 'orbitPos', 'orbitNeg'].map(n => [n, L[n].value.clone()])
    ));
    for (const n in saved) saved[n].copy(L[n].value);
    const gain = (c, g) => c.setRGB(c.r * g.x, c.g * g.y, c.b * g.z);
    gain(L.sunColor.value, this.sun);
    gain(L.sunSpecular.value, this.sun);
    gain(L.fillColor.value, this.fill);
    gain(L.ambient.value, this.fill);
    for (const n of ['orbitPos', 'orbitNeg']) {
      const e = L[n].value.elements;
      for (let i = 0; i < 9; i += 3) {
        e[i] *= this.fill.x;
        e[i + 1] *= this.fill.y;
        e[i + 2] *= this.fill.z;
      }
    }
    const fog = L.fogTint.value,
      tint = top.w * (0.65 + 0.34 * dust);
    fog.setRGB(fog.r + (air.x - fog.r) * tint, fog.g + (air.y - fog.g) * tint, fog.b + (air.z - fog.b) * tint);
    const range = L.fogRange.value.multiplyScalar(this.fill.w);
    // Scatter along the sightline instead of laying a brown filter over nearby surfaces.
    if (dust > 0 && range.y > 0) range.x += (Math.min(range.x, 0.055 * range.y) - range.x) * dust;
    this.dustAir.value.set(air.x, air.y, air.z, dust);
    return true;
  }
  end(L) {
    for (const n in this.saved) L[n].value.copy(this.saved[n]);
    this.dustAir.value.w = 0;
  }
}

// The archive uses a smoke tile for airborne sand. Keep its alpha and small internal
// variations, but illuminate the grains with the same air as the horizon instead of soot.
export function dustSpriteShader(wg) {
  const v = wg ? 'vec4f' : 'vec4',
    rgb = wg ? 'vec3f' : 'vec3';
  return `${wg ? 'fn dustSprite(raw:vec4f,air:vec4f,mask:f32)->vec4f' : 'vec4 dustSprite(vec4 raw,vec4 air,float mask)'}{
    ${wg ? 'let' : 'float'} k=air.w*mask;
    if(k<=0.){return raw;}
    ${wg ? 'let' : 'float'} grain=.86+.14*dot(raw.rgb,${rgb}(.2126,.7152,.0722));
    return ${v}(mix(raw.rgb,air.rgb*grain,.90*k),raw.a*(1.-.58*k));
  }`;
}
