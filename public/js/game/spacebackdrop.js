// Expose the distant sky for a sunlit subject. Keep authored point stars, separately modeled
// suns/planets, and the map's orientation. No noise, moving stars, or full-screen grade.
export function backdropLayer(mesh) {
  const m = mesh.material;
  if (!m?.isShaderMaterial || m.uniforms?.orbitalAir || !m.uniforms?.map) return false;
  for (let p = mesh; p; p = p.parent) if (/^(sun|solar|corona|planet|moon)/i.test(p.name || '')) return false;
  // Separate additive star/sun cards stay at their authored intensity. Gas can itself be additive.
  return !!m.defines?.NEBULA || !m.userData?.additive;
}

export class SpaceBackdrop {
  constructor() { this.layers = []; this.deep = false; }
  add(mesh) { if (backdropLayer(mesh)) this.layers.push({ mesh, original:mesh.material, dark:null }); }
  use(deep) {
    if (this.deep === deep) return;
    this.deep = deep;
    for (const row of this.layers) {
      if (deep && !row.dark) {
        const m = row.original.clone();
        m.uniforms = row.original.uniforms; // one mounted texture and animation clock for both exposures
        m.defines = { ...row.original.defines, DEEP_BACKDROP:1 };
        row.dark = m;
      }
      row.mesh.material = deep ? row.dark : row.original;
    }
  }
  dispose() { this.use(false); for (const row of this.layers) row.dark?.dispose(); this.layers.length = 0; }
}

// The broad texture sample estimates local sky brightness. Small hot points above that level
// retain their energy while diffuse dust stays faint. Works with baked star fields too.
export function backdropExposure(wgsl) {
  const vec = wgsl ? 'vec3f' : 'vec3';
  const decl = (type,name,value) => `${wgsl ? 'let' : type} ${name} = ${value};`;
  return [
    decl(vec,'surround',wgsl ? 'textureSampleLevel(mapT,mapS,v.vUv,4.0).rgb' : 'textureLod(map,vUv,4.0).rgb'),
    decl('float','peak','max(base.r,max(base.g,base.b))'),
    decl('float','local','max(surround.r,max(surround.g,surround.b))'),
    decl('float','point','smoothstep(0.035,0.30,peak-local)'),
    decl('float','exposure','mix(0.19,1.0,max(point,smoothstep(0.40,0.96,peak)))'),
    wgsl ? 'base = vec4f(base.rgb * exposure, base.a);' : 'base.rgb *= exposure;'
  ].join('\n');
}
