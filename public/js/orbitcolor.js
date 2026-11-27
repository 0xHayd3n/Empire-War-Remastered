// Hull shaders meet the legacy display-referred effects pipeline at the opaque surface boundary.
// Alpha, gloss, tangent normals, and the additive engine/laser shaders are not colour textures.
export const toLinear = x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
export function orbitShader(lang) {
  const wg = lang === 'wgsl', v = wg ? 'vec3f' : 'vec3';
  const fn = (name, body) => wg ? `fn ${name}(x: vec3f) -> vec3f { ${body} }` : `vec3 ${name}(vec3 x) { ${body} }`;
  const channels = (lo, hi, threshold) => wg ? `select(${hi}, ${lo}, x <= vec3f(${threshold}))` : `mix(${hi}, ${lo}, lessThanEqual(x, vec3(${threshold})))`;
  return [
    fn('orbitDecode', `return ${channels('x / 12.92', `pow(max((x + 0.055) / 1.055, ${v}(0.0)), ${v}(2.4))`, '0.04045')};`),
    fn('orbitEncode', `return ${channels('12.92 * x', `1.055 * pow(max(x, ${v}(0.0)), ${v}(1.0 / 2.4)) - 0.055`, '0.0031308')};`),
    // Leave the half-light reference and midtones alone. Roll off high luminances without changing hue.
    fn('orbitShoulder', `${wg ? 'let' : 'float'} m = max(x.r, max(x.g, x.b)); if (m <= 0.72) { return x; } return x * ((1.0 - 0.0784 / (m - 0.44)) / m);`)
  ].join('\n');
}

// Six signed axis averages, linear RGB; approximate a broad rough reflection without per-ship captures.
export function measureOrbitFaces(bytes, size) {
  // Six RGB lobes, plus direction and radiance of the brightest extended patch. Averaging a tile
  // before ranking keeps one white star from lighting the fleet like a second sun.
  const faces = new Float32Array(24);
  const tile = Math.max(1, Math.floor(size/4));
  let brightest = 0;
  for (let face = 0; face < 6; face++) {
    let sum = 0;
    for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
      const s = (x + 0.5) * 2 / size - 1, t = (y + 0.5) * 2 / size - 1;
      const weight = (1 + s*s + t*t) ** -1.5; // cubemap texel solid angle
      const at = (y*size*6 + face*size + x)*4;
      for (let c=0;c<3;c++) faces[face*3+c] += weight * toLinear(bytes[at+c]/255);
      sum += weight;
    }
    for (let c=0;c<3;c++) faces[face*3+c] /= sum;
    for (let y=0; y+tile<=size; y+=tile) for (let x=0; x+tile<=size; x+=tile) {
      const rgb = [0,0,0];
      for (let j=y; j<y+tile; j++) for (let i=x; i<x+tile; i++) {
        const at = (j*size*6 + face*size + i)*4;
        for (let c=0; c<3; c++) rgb[c] += toLinear(bytes[at+c]/255)/(tile*tile);
      }
      const lum = 0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
      if (lum <= brightest) continue;
      brightest = lum;
      const u=(2*x+tile)/size-1, v=(2*y+tile)/size-1;
      const dir=[[1,-u,v],[-1,u,v],[u,1,v],[-u,-1,v],[-u,v,1],[u,v,-1]][face];
      const len=Math.hypot(...dir);
      faces.set(dir.map(k => k/len),18);
      faces.set(rgb,21);
    }
  }
  // The broad lobe already includes the sky average. An even overcast or uniformly bright
  // sky must not invent a directional light at the first sampled tile.
  for (let c=0;c<3;c++) {
    let mean=0;
    for (let i=0;i<6;i++) mean+=faces[3*i+c]/6;
    faces[21+c]=Math.max(0, faces[21+c]-mean);
  }
  return faces;
}
