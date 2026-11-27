import { tileShader } from './endor-tiles.js';
// Verified stock Endor bare earth. DirtRock00 actually contains green plants; it isn't a match.
const maps = {
  foc: '63e89b0f57d88e108a2947993319e923c671e85a38b33dc20d76670c4768bf08',
  eaw: 'baf81f94d782a6aed6237262071b845ae70429d90f526c054f468768b8b04cf3'
};
const sources = [
  '0ee3bfc9d65d954d5a7d2a8dd3839e8d2010af8a4c5c609ff4cf48500a69a8c2',
  'c96fa8cebf140cb81fed1dbb8bb105bf447487477d7b2b78fe00694ebd93e691'
];
export function forestSlot(profile, file, layers) {
  if (profile !== 'stock' || file?.toUpperCase() !== '_MP_LAND_ENDOR.TED') return -1;
  return layers.findIndex(
    l => l.texture?.toUpperCase() === 'W_SMOOTHDIRT00.TGA' && l.bump?.toUpperCase() === 'W_SMOOTHDIRT00_B.TGA' && l.tile === 215 && !l.hole
  );
}
export function reviewedEndor(edition, map) {
  return Object.hasOwn(maps, edition) && map === maps[edition];
}
export function reviewedForest(edition, map, hashes) {
  return reviewedEndor(edition, map) && sources.every((s, i) => hashes[i] === s);
}
export function soilMip(textureDetail, maxSize) {
  let first = Math.max(0, Math.min(2, textureDetail | 0));
  while (first < 12 && 4096 >> first > maxSize) first++;
  return first;
}

// One material equation in both backends. Return before sampling any legacy diffuse, bump or gloss.
// Albedo is stored sRGB in a non-sRGB BC3 texture: decode once; return to the land pass's display-like working convention once.
export function scanSamplers(wg, mixed=false) {
  return ['Color', 'Surface']
    .map(k => {
      const arr = k === 'Color' ? 'map' : 'bump',
        single = 'soil' + k;
      if(mixed)return wg?`fn scan${k}(uv:vec2f,sx:vec2f,sy:vec2f,id:i32)->vec4f{return textureSampleGrad(${single}T,${single}S,uv,id,sx,sy);}`:`vec4 scan${k}(vec2 uv,vec2 sx,vec2 sy,int id){return textureGrad(${single},vec3(uv,float(id)),sx,sy);}`;
      return wg
        ? `fn scan${k}(uv:vec2f,sx:vec2f,sy:vec2f,id:i32)->vec4f {
      if(id>=0){return textureSampleGrad(${arr}T,${arr}S,uv,id,sx,sy);} return textureSampleGrad(${single}T,${single}S,uv,sx,sy);}`
        : `vec4 scan${k}(vec2 uv,vec2 sx,vec2 sy,int id){if(id>=0)return textureGrad(${arr},vec3(uv,float(id)),sx,sy);return textureGrad(${single},uv,sx,sy);}`;
    })
    .join('\n')+'\n'+tileShader(wg,mixed);
}
export function forestShader(wg,mixed=false) {
  const f = wg ? 'let' : 'float',
    v = wg ? 'let' : 'vec3',
    v2 = wg ? 'vec2f' : 'vec2',
    v3 = wg ? 'vec3f' : 'vec3',
    v4 = wg ? 'let' : 'vec4',
    p = wg ? 'P.' : '',
    sample = (id, uv) => `patch${id.slice(4)}(${uv},sx,sy,scanID,chart)`,
    full = wg ? 'T.forest.y' : 'fullTerrain',
    us = wg ? 'T.texU[i]' : 'texU[i]',
    vs = wg ? 'T.texV[i]' : 'texV[i]',
    mut2 = wg ? 'var' : 'vec2',
    mut = wg ? 'var' : 'float',
    target = wg ? 'T.forest.x' : 'forestSlot';
  return `if (${mixed?`${us}.w>=2.0`:`${full}>0.5 || ${target} == slot + 1.0`}) {
    ${wg ? 'var' : 'int'} scanID=-1; ${wg ? 'var' : 'float'} repeat=7.0;
    ${mixed?`scanID=${wg?'i32':'int'}(${us}.w-1.5);repeat=abs(${vs}.w);`:`if(${full}>0.5){scanID=${wg ? 'i32' : 'int'}(${us}.w+0.5);repeat=${vs}.w;}`}
    ${wg?'let':'mat3'} frame=terrainFrame(n,U,V);
    ${v} viewTS=transpose(frame)*toEye;
    ${v} lightTS=transpose(frame)*${p}sunDir;
    ${wg ? 'let' : 'vec2'} sx=gx*repeat; ${wg ? 'let' : 'vec2'} sy=gy*repeat;
    ${mut2} uv=${wg ? 'at' : 'at.xy'}*repeat;
    ${wg?'let':'ScanPatch'} chart=scanPatch(uv,${mixed?(wg?`select(scanID,-1,${vs}.w<0.)`:`${vs}.w<0.?-1:scanID`):'scanID'});
    // Height is only worth tracing where pebbles cover pixels. Mip gradients stay continuous at intersections.
    ${f} nearRelief=1.0-smoothstep(0.003,0.019,max(length(sx),length(sy)));
    ${f} relief=0.024*nearRelief;
    if (nearRelief>0.01) {
      ${wg ? 'let' : 'vec2'} ray=clamp(viewTS.xy/max(0.28,viewTS.z),${v2}(-2.2),${v2}(2.2))*relief/6.0;
      // The entry height is only used when the very first step crosses the surface.
      // Keep the original UV (adding ray back could round differently on a tile edge).
      ${wg ? 'let' : 'vec2'} entryUV=uv;
      ${mut} gap=0.0;
      for (${wg ? 'var k=1' : 'int k=1'}; k<=6; k++) {
        ${mut} previous=gap; uv-=ray;
        gap=1.0-${sample('soilColor', 'uv')}.a-${wg ? 'f32' : 'float'}(k)/6.0;
        if (gap<=0.0) {
          if(k==1){previous=1.0-${sample('soilColor', 'entryUV')}.a;}
          uv+=ray*clamp(-gap/max(previous-gap,0.00001),0.0,1.0); break;
        }
      }
    }
    ${v4} albedoHeight=${sample('soilColor', 'uv')}; ${v4} surface=${sample('soilSurface', 'uv')};
    ${v} b=surface.rgb*2.0-1.0;
    // Independent patches lose variance by sum(w²) at every overlap. Correct the
    // colour deviations and tangent slopes, not the mean colour, height or gloss.
    ${f} grainGain=mix(${wg?'inverseSqrt':'inversesqrt'}(dot(chart.w,chart.w)),1.,smoothstep(.125,.5,max(length(sx),length(sy))));
    ${v} sn=normalize(frame*${v3}(b.xy*grainGain,max(.01,b.z)));
    ${f} wet=${wg ? 'T.side.w' : 'groundWet'}*smoothstep(0.12,0.82,n.z)*step(${wg ? 'T.cloudAt.w' : 'waterLine'},vWorld.z);
    ${wg?'var':'vec3'} scanPaint=albedoHeight.rgb;
    scanPaint=clamp(scanPaint+(scanPaint-${wg?'T.':''}matSpecular[i].rgb)*(grainGain-1.),${v3}(0.),${v3}(1.));
    ${v} albedo=mix(scanPaint/12.92,pow((scanPaint+${v3}(0.055))/1.055,${v3}(2.4)),step(${v3}(0.04045),scanPaint))*(1.0-0.30*wet);
    ${f} rough=clamp(surface.a*(1.0-0.3*wet),0.16,1.0);
    ${f} nl=max(0.0,dot(sn,${p}sunDir)); ${f} nv=max(0.02,dot(sn,toEye));
    ${v} halfDir=normalize(toEye+${p}sunDir+${v3}(0.0,0.0,0.00001));
    ${f} nh=max(0.0,dot(sn,halfDir)); ${f} vh=clamp(dot(toEye,halfDir),0.0,1.0);
    ${f} a2=rough*rough*rough*rough; ${f} d=1.0+nh*nh*(a2-1.0);
    ${f} distribution=a2/max(0.00001,3.14159*d*d);
    ${f} visibility=0.5/max(0.001,nl*sqrt(nv*nv*(1.0-a2)+a2)+nv*sqrt(nl*nl*(1.0-a2)+a2));
    ${f} fresnel=0.04+0.96*pow(1.0-vh,5.0);
    ${mut} contact=1.0;
    // Height self-shadowing modulates only direct*nl, never the sky or soil fill.
    if (nearRelief>0.01 && lightTS.z>0.04 && nl>0.0 && any(${wg?'direct!='+v3+'(0.)':'notEqual(direct,'+v3+'(0.))'})) {
      ${wg ? 'let' : 'vec2'} along=lightTS.xy*relief;
      ${f} rim=max(${sample('soilColor', 'uv+along*0.28')}.a-albedoHeight.a-0.28*lightTS.z, ${sample('soilColor', 'uv+along*0.65')}.a-albedoHeight.a-0.65*lightTS.z);
      contact-=nearRelief*0.66*smoothstep(0.025,0.16,rim);
    }
    ${v} lit=max(${v3}(0.0),albedo*terrainFill(sn)+direct*contact*nl*(albedo*(1.0-fresnel)+${v3}(distribution*visibility*fresnel)));
    // Full landscape blends lit layers (including the bed) before display encoding.
    ${mixed?'return lit;':`if (${full}>.5) { return lit; }return orbitEncode(lit);` }
  }`;
}
