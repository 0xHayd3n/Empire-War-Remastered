// Coarse TED cells are 20 world units wide. Close relief replaces entire cells.
export const CELL = 20;

// Shade is normally 0..1. Locally refined scar tiles use 2..3 for their soot
// mask. Modulate the existing lit terrain (including its grain and normals),
// before battle fog, blast lights and weather. Same material on both backends.
export function scorchedSoil(wg) {
  const shade = wg ? 'v.vShade' : 'vShade', v3 = wg ? 'vec3f' : 'vec3';
  const variable = (name,value) => `${wg ? 'let' : 'float'} ${name} = ${value};`;
  return `if (${shade} > 2.0) {
    ${variable('charMask', `clamp(${shade}-2.0,0.0,1.0)`)}
    ${variable('grain', 'sin(vWorld.x*1.7+sin(vWorld.y*.81))*sin(vWorld.y*1.1+vWorld.x*.36)')}
    c *= mix(${v3}(1.0),${v3}(0.23,0.19,0.17)*(1.0+0.18*grain),charMask);
  }`;
}
export function reliefCutVertex(wg) {
  // The three vertices of each coarse triangle recover the same origin. Move all
  // three outside clip space. A fragment discard cannot own an MSAA sample edge.
  const at = wg ? 'i.position.xy-i.corner' : 'position.xy-corner';
  return wg
    ? `let cellAt=${at}*${CELL.toFixed(1)};
    if(i.shade < 2. && all(cellAt>=T.reliefPatch.xy) && all(cellAt<T.reliefPatch.zw)){o.pos=vec4f(2.,2.,2.,1.);}`
    : `vec2 cellAt=${at}*${CELL.toFixed(1)};
    if(shade < 2. && all(greaterThanEqual(cellAt,reliefPatch.xy)) && all(lessThan(cellAt,reliefPatch.zw))) gl_Position=vec4(2.,2.,2.,1.);`;
}
