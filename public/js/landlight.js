// One color contract for lit land meshes and terrain. This is diffuse environment fill,
// not a screen grade: do not apply it to emitters, HUD, fog, or the map sun color.
export function groundFillShader(wg) {
  const p = wg ? 'P.' : '',
    f = wg ? 'let' : 'float',
    c = wg ? 'let' : 'vec3';
  return `${wg ? 'fn groundFill(n:vec3f)->vec3f' : 'vec3 groundFill(vec3 n)'} {
 ${f} up=clamp(0.5+0.5*n.z,0.0,1.0);
 if(${p}landProbeOn>0.0){
   ${c} pos=max(n,${wg?'vec3f':'vec3'}(0.)); ${c} neg=min(n,${wg?'vec3f':'vec3'}(0.));
   ${c} hemi=${p}orbitPos*(pos*pos)+${p}orbitNeg*(neg*neg);
   ${c} soil=${p}landGround.rgb*${p}landGround.rgb*(.72*${p}orbitPos[2]+.58*${p}sunColor*max(0.,${p}sunDir.z));
   ${f} cloud=${p}forestWeather.x;
   return hemi*(1.-.12*cloud)+soil*(1.-up)+${p}fillColor2*max(0.,dot(n,${p}fillDir2));
 }
 ${c} sky=${p}ambient*0.95+${p}fillColor*(0.22+0.38*max(0.0,dot(n,${p}fillDir)));
 ${c} soil=${p}landGround.rgb*(${p}ambient*0.72+${p}sunColor*(0.58*max(0.0,${p}sunDir.z)));
 return mix(soil,sky,up)+${p}fillColor2*max(0.0,dot(n,${p}fillDir2));
 }`;
}
// Project the actual texture planes onto the receiver. Unlike two independently
// normalised XY tangents this preserves tilt, handedness and grazing foreshortening.
// The same normal drives direct light and sky fill; only the former sees the shadow map.
export function terrainSurfaceShader(wg) {
  const M=wg?'mat3x3f':'mat3', d=wg?'let':'vec3';
  return `${wg?'fn terrainFrame(n:vec3f,U:vec3f,V:vec3f)->mat3x3f':'mat3 terrainFrame(vec3 n,vec3 U,vec3 V)'} {
    ${d} u=normalize(U); ${d} v=normalize(V);
    return ${M}(u-n*dot(u,n),v-n*dot(v,n),n);
  }
  ${wg?'fn terrainFill(sn:vec3f)->vec3f':'vec3 terrainFill(vec3 sn)'} {
    if(${wg?'P.':''}landGround.w>0.){return groundFill(sn)*terrainSky;}
    return soft;
  }`;
}
// Fine-map visibility fades to the existing wide map across a band, not a hard split.
export function nearGroundShader(wg, terrain = false) {
  const p = wg ? 'P.' : '',
    V = wg ? 'vec3f' : 'vec3',
    v4 = wg ? 'vec4f' : 'vec4',
    f = wg ? 'let' : 'float',
    c = wg ? 'let' : 'vec3';
  const v2 = wg ? 'vec2f' : 'vec2';
  const tap = (x, y, z = 'd') => {
    const offset = `${v2}(${x},${y})`, depth = `${z}+dot(gradient,${offset})`;
    return wg ? `textureSampleCompareLevel(hullShadowMap,shadowS,q.xy+${offset},${depth})` : `texture(hullShadowMap,vec3(q.xy+${offset},${depth}))`;
  };
  // Terrain has no separate use for wide visibility. Only sample it outside the
  // near cascade or in its blend band. Models can reuse their existing wide result.
  const wide = terrain ? 'sunlit(wp,n)' : 'wide';
  return `${wg ? `fn groundSun(wp:vec3f,n:vec3f${terrain?'':',wide:f32'})->f32` : `float groundSun(vec3 wp,vec3 n${terrain?'':',float wide'})`}{
 if (${p}landGround.w<1.5){return ${wide};}
 ${wg?'var':'vec2'} gradient=${v2}(0.0);
 ${wg?'var':'vec3'} q=(${p}hullShadowMatrix*${v4}(wp+n*(0.48*${p}hullShadowParams.x),1.0)).xyz;
 if (${p}landGround.w>2.5) {
 ${c} at=(${p}hullShadowMatrix*${v4}(wp,1.0)).xyz;
 // Compare each tap at the depth of the receiving triangle there, not the depth at
 // the kernel centre. Otherwise a grazing surface blocks its own light in stripes.
 ${c} dx=${wg?'dpdx':'dFdx'}(at); ${c} dy=${wg?'dpdy':'dFdy'}(at);
 ${f} det=dx.x*dy.y-dx.y*dy.x;
 ${f} limitSlope=8.0*${p}hullShadowParams.y/${p}hullShadowParams.z;
 gradient=clamp(${v2}(dx.z*dy.y-dy.z*dx.y,dx.x*dy.z-dy.x*dx.z)*sign(det)/max(abs(det),1e-16),${v2}(-limitSlope),${v2}(limitSlope));
 q=at+(${p}hullShadowMatrix*${v4}(n*(0.2*${p}hullShadowParams.x),0.0)).xyz;
 }
 ${c} edge=min(q,${V}(1.0)-q); ${f} w=smoothstep(0.0,0.08,min(edge.x,min(edge.y,edge.z)));
 if(w<=0.0){return ${wide};}
 // Bilinear depth comparison touches up to one more texel beyond each tap.
 ${f} d=q.z-0.42*${p}hullShadowParams.y-dot(abs(gradient),${v2}(${p}hullShadowParams.z)); ${f} o=0.68*${p}hullShadowParams.z;
 // Compare at two depths towards the sun. Boots stay sharp; a high crown can
 // subtend a wider penumbra. Keep the disk in light space (no screen noise).
 ${wg?'var nearVis:f32':'float nearVis'};
 if(${p}landProbeOn>0.0){
   ${f} invDepth=${p}hullShadowParams.y/max(.001,${p}hullShadowParams.x);
   ${f} blocker=18.*(1.-${tap('o','-o','d-12.*invDepth')})+83.*(1.-${tap('-o','o','d-75.*invDepth')});
   ${f} r=min(5.0,.70+blocker*.006/max(.001,${p}hullShadowParams.x))*${p}hullShadowParams.z;
   nearVis=(${[[-.76,-.36],[.51,-.75],[.83,.25],[-.34,.81],[-.17,-.23],[.18,.27]].map(([x,y])=>tap(`${x}*r`,`${y}*r`)).join('+')})/6.;
 } else { nearVis=0.25*(${tap('-o', '-o')}+${tap('o', '-o')}+${tap('-o', 'o')}+${tap('o', 'o')}); }
 ${terrain?'if(w>=1.0){return nearVis;}':''}
 return mix(${wide},nearVis,w);
 }`;
}
