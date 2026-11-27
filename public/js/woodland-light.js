// The stand field affects indirect skylight and local root contact only. Direct visibility
// is already filtered by the sun's shadow maps for terrain, foliage, and moving models.
export function woodFunctions(wg) {
  const v=wg?'vec3f':'vec3';
  return `${wg?'fn woodFill(cover:vec3f,k:f32)->vec3f':'vec3 woodFill(vec3 cover,float k)'} {
    return ${v}(1.)-k*(${v}(.41,.32,.24)*cover.g+${v}(.24)*cover.b);
  }`;
}
export function woodGround(wg){const field=wg?'T.forest.y':'fullTerrain', sample=wg?'textureSampleLevel(canopyT,canopyS,vWorld.xy/T.side.x,0.0)':'texture(canopyMap,vWorld.xy/side)',k=wg?'P.landStyle.x':'landStyle.x';return `if(${field}>.5){${wg?'let':'vec3'} cover=${sample}.rgb;terrainSky=woodFill(cover,${k});soft*=terrainSky;}`;}
export function woodMist(wg,col,pos){const p=wg?'P.':'',v=wg?'vec3f':'vec3';return `${col}=mix(${col},mix(${v}(.27,.36,.38),${p}fogTint,.38),${p}landStyle.y*.48*(1.0-exp(-max(0.0,distance(${p}cameraPosition,${pos})-max(130.0,${p}landStyle.z*.91))*.0014)));`;}
// Raw sRGB scans are decoded ONCE. Diffuse skylight is not a view-dependent white rim.
// Normal alpha on the trunk/log and scanned rock is roughness; grass has no gloss map.
export function woodColor(wg,cutout,rough){
  const p=wg?'P.':'', c=wg?'let':'vec3', f=wg?'let':'float', V=wg?'vec3f':'vec3', at=wg?'v.vWorldPos':'vWorldPos',height=wg?'v.stemHeight':'stemHeight',k=p+'landStyle.x',
    sample=pos=>wg?`textureSampleLevel(glossT,glossS,${pos}/max(P.fowSide,1.),0.0)`:`texture2D(glossMap,${pos}/max(fowSide,1.))`;
  return `${f} h=max(0.0,${height});
    ${c} cover=${sample(at+'.xy')}.rgb;
    ${f} below=1.-smoothstep(52.,175.,h);
    ${f} beam=sun;
    ${c} fill=(indirect+soilBounce(${at},gn))*woodFill(cover,${k}*below);
    ${f} nl=max(0.,dot(n,${p}sunDir));
    ${f} transmitted=${cutout?`(.14+.38*max(0.,-dot(n,${p}sunDir)))*(.55+.45*max(0.,dot(-vv,${p}sunDir)))`:'0.'};
    ${f} damp=${p}forestWeather.z*(1.-.55*cover.g*below);
    ${f} rgh=${rough?'clamp(nt.a,.28,1.)':'.94'}*(1.-.18*damp);
    ${f} nh=max(0.,dot(n,normalize(${p}sunDir+vv)));
    ${f} fibre=.018*(1.-.75*rgh)*pow(nh,2.+14.*(1.-rgh))*nl*beam;
    ${wg?'var':'vec3'} col=orbitEncode(orbitDecode(albedo)*(1.-${cutout?'.22':'.34'}*damp)*ls.rgb*(fill+${p}sunColor*((nl+transmitted)*beam)+min(boltSum,${V}(1.4)))+${p}sunSpecular*fibre);`;
}
export function highlightKnee(wg){const d=wg?'let':'float',p=wg?'P.':'';return `if(${p}landStyle.w>0.){${d} top=max(max(col.r,col.g),col.b);${d} toe=.72;${d} x=max(0.,top-toe);col*=mix(1.,(min(top,toe)+x/(1.+x/(1.-toe)))/max(top,.0001),${p}landStyle.w);}`;}
