// Remap a painted transition, never a categorical slot. The warp is zero normal to
// every cell edge: two adjacent cells still agree exactly on their shared edge.
// The last factor lets raised leaves win against lower soil without tarring the
// whole blend the average colour of the two. Only active replacement layers sampled.
export function landscapeBlend(wg,mixed=false) {
  const v2 = wg ? 'vec2f' : 'vec2',
    v4 = wg ? 'vec4f' : 'vec4',
    body = `${wg ? 'let' : 'vec2'} p = vWorld.xy * 0.092;
    ${wg ? 'let' : 'vec2'} wind = ${v2}(sin(p.y + sin(p.x*.43)) + .48*sin(p.y*2.8+p.x*.71), cos(p.x*.84 + cos(p.y*.56)) + .48*sin(p.x*2.37-p.y*.63));
    ${wg ? 'let' : 'vec2'} edge = smoothstep(${v2}(0.0),${v2}(1.0),q + wind * q*(1.0-q)*.61);
    return ${v4}((1.0-edge.x)*(1.0-edge.y),edge.x*(1.0-edge.y),(1.0-edge.x)*edge.y,edge.x*edge.y);`,
    t = wg ? 'T.' : '',
    tex = `patchColor(uv,gx,gy,id,scanPatch(uv,${mixed?(wg?'select(id,-1,T.texV[i].w<0.)':'texV[i].w<0.?-1:id'):'id'}))`,
    h = `${wg ? 'let' : 'int'} i=${wg ? 'i32' : 'int'}(slot+.5);
    ${wg ? 'let' : 'vec3'} U=${t}texU[i].xyz; ${wg ? 'let' : 'vec3'} V=${t}texV[i].xyz;
    ${wg ? 'let' : 'float'} r=abs(${t}texV[i].w); ${wg ? 'let' : 'int'} id=${wg ? 'i32' : 'int'}(${t}texU[i].w${mixed?'-1.5':'+.5'});
    ${wg ? 'let' : 'vec2'} uv=${v2}(dot(U,vWorld),dot(V,vWorld))*r;
    ${wg ? 'let' : 'vec2'} gx=${v2}(dot(U,dPx),dot(V,dPx))*r*2.5;${wg ? 'let' : 'vec2'} gy=${v2}(dot(U,dPy),dot(V,dPy))*r*2.5;
    return mix(.44,1.64,smoothstep(.14,.86,${tex}.a));`;
  return wg
    ? `fn forestWeights(q:vec2f)->vec4f{${body}}\nfn forestRank(slot:f32)->f32{${h}}`
    : `vec4 forestWeights(vec2 q){${body}}\nfloat forestRank(float slot){${h}}`;
}
export function applyLandscapeBlend(wg,mixed=false) {
  const on = wg ? 'T.forest.y' : 'fullTerrain',
    L = wg ? 'Ly' : 'vLayers';
  const V = wg ? 'vec4f' : 'vec4';
  // A skipped donor must fade to zero, not take its fraction of the light with it.
  return `if(${mixed?'true':`${on}>1.5`}){${['x', 'y', 'z', 'w'].map(c => `if(w.${c}>0.0 && w.${c}<1.0${mixed?` && keep.${c}<.5`:''}){ w.${c} *= forestRank(${L}.${c}); }`).join(' ')}}
    w=max(w-${V}(.004),${V}(0.));w/=dot(w,${V}(1.));`;
}
