// Tactical colour pass only. The same subpixel pattern through every overlapping
// crown opens a sightline instead of successively blending it shut. Surviving
// pixels keep their ordinary lighting, alpha test and depth; no sorted draws.
export function canopyWindowShader(wg) {
  const u = wg ? 'P.canopyView' : 'canopyView',
    fc = wg ? 'v.pos' : 'gl_FragCoord';
  const decl = (type, name) => `${wg ? 'let' : type} ${name}`;
  return `if (${u}.w > 0.0) {
    ${decl('vec2', 'screen')} = ${fc}.xy * ${u}.xy - ${wg ? 'vec2f' : 'vec2'}(1.0);
    ${decl('float', 'radius2')} = dot(screen,screen);
    if (radius2 < 1.0) {
      ${decl('float', 'depthRatio')} = 1.0 / (${fc}.w * ${u}.z);
      ${decl('float', 'fade')} = ${u}.w * (1.0-smoothstep(0.18,1.0,radius2)) * (1.0-smoothstep(0.89,1.05,depthRatio));
      if (bayer4(${fc}.xy) + 0.03125 < fade) { discard; }
    }
  }`;
}
