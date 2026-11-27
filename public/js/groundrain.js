// Only liquid precipitation wets the ground. A shared scenario emitter is not a rain flag:
// it may remain mounted through clear phases (and e.g. rain_of_ash isn't water).
const clamp = x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const liquid = name => /^(?:(?:light|heavy|moderate)[ _-]?)?(?:rain(?:fall)?|drizzle|downpour|thunderstorm)$/i.test(name || '');
export function rainfall(wx) {
  if (!wx) return 0;
  const phases = wx.phases;
  if (wx.out && phases?.length && wx.ease > 0) {
    const a = phases[wx.i],
      b = phases[(wx.i + 1) % phases.length],
      t = clamp(1 - wx.left / wx.ease);
    return (liquid(a.name) ? clamp(a.strength) * (1 - t) : 0) + (liquid(b.name) ? clamp(b.strength) * t : 0);
  }
  return liquid(wx.name) ? clamp(wx.level) : 0;
}
// A scene-local reservoir. Rain fills the remaining capacity; drying is slower and linear
// down to exactly zero. Closed-form integration makes the response independent of FPS.
export function wetStep(amount, rain, dt) {
  if (!(dt > 0) || !Number.isFinite(dt)) return amount;
  rain = clamp(rain);
  const gain = rain / 13,
    loss = (1 - rain) / 70;
  return clamp(gain > 1e-8 ? amount + (1 - loss / gain - amount) * -Math.expm1(-gain * dt) : amount - loss * dt);
}
export class GroundRain {
  amount = 0;
  update(wx, dt) {
    this.amount = wetStep(this.amount, rainfall(wx), dt);
    return this.amount;
  }
}
// TED physical kinds first; names disambiguate default/rule-only layers. Unknown art is
// slightly absorbent and matte, never an invented metal or a bright reflection.
export function wetSurface(layer) {
  const k = layer?.kind,
    name = String(layer?.texture || '')
      .split(/[\\/]/)
      .pop()
      .toLowerCase();
  if (!name || layer.hole || [3, 4, 7, 8].includes(k) || /snow|glacier|lava/.test(name)) return [0, 0];
  if (k === 5) return [0.17, 0.82];
  if (k === 1) return [0.29, 0.045];
  if (k === 2 || k === 6) return [0.42, 0.045];
  if (/rock|cliff|gravel|rubble/.test(name)) return [0.19, 0.07];
  if (/concrete|pavement|paving|asphalt|tarmac|polished|metalplate/.test(name)) return [0.17, 0.67];
  if (/grass|moss|litter|leaf/.test(name)) return [0.29, 0.045];
  if (/soil|dirt|mud|sand|tempgrnd/.test(name)) return [0.42, 0.045];
  return [0.14, 0.035];
}
// Deterministic thinning of eligible authored movement puffs. Decals, sounds and non-dust
// FX never enter this budget. No gameplay RNG; each mover has its own fractional carry.
export class MovementDust {
  carry = new WeakMap();
  emit(unit, particle, wet) {
    if (
      !(wet > 0) ||
      unit.dead ||
      !/dust|foot[_ -]?puff/i.test(particle) ||
      /water|splash|wake|snow|ice|ash|smoke|fire|spark/i.test(particle)
    )
      return true;
    const n = (this.carry.get(unit) || 0) + 1 - 0.86 * clamp(wet);
    this.carry.set(unit, n % 1);
    return n >= 1;
  }
}
// Add a broad, view-dependent sky sheen to smooth surfaces, not a mirrored scene. Preserve
// the archive bump, diffuse and gloss underneath; do nothing at all on a dry frame.
export function wetLayerShader(wg) {
  const p = wg ? 'T.' : '',
    f = wg ? 'let' : 'float',
    v = wg ? 'let' : 'vec3',
    amount = wg ? 'T.side.w' : 'groundWet',
    level = wg ? 'T.cloudAt.w' : 'waterLine',
    sky = wg ? 'P.ambient' : 'ambient',
    fill = wg ? 'P.fillColor' : 'fillColor',
    v3 = wg ? 'vec3f' : 'vec3';
  return `
 if (${amount}>0.0 && vWorld.z>=${level}) {
  ${f} film=${amount}*smoothstep(0.12,0.82,n.z);
  ${f} grazing=1.0-clamp(dot(toEye,sn),0.0,1.0);
  ${f} sheen=film*${p}texV[i].w*(0.023+0.62*grazing*grazing*grazing);
  ${v} sky=max(${sky}+0.45*${fill},${v3}(0.0));
  result=result*(1.0-film*${p}texU[i].w)+sky*sheen;
 }`;
}
