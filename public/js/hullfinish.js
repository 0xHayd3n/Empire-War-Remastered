// Material response for the signature-matched stock hull only. Positions are in its authored
// local space; the map and team paint supply color, never a guessed metalness from brightness.
export function hullFinish(wg, orbital) {
  const V = wg ? 'vec3f' : 'vec3',
    U = wg ? 'vec2f' : 'vec2',
    F = wg ? 'let' : 'float',
    C = wg ? 'let' : V,
    p = wg ? 'v.vObjPos' : 'vObjPos',
    view = wg ? 'vv' : 'v',
    L = wg ? 'P.' : '',
    M = wg ? 'D.' : '',
    sample = uv => (wg ? `textureSampleLevel(skyT,skyS,${uv},0.0).rgb` : `textureLod(skyAtlas,${uv},0.0).rgb`);
  const orbitalLight = `
    ${C} up=max(n,${V}(0.0)); ${C} down=min(n,${V}(0.0));
    ${C} skyDiffuse=${L}orbitPos*(up*up)+${L}orbitNeg*(down*down);
    ${wg ? 'let' : U} skyCoord=skyUV(reflect(-${view},n));
    ${F} band=2.0*rough;
    ${C} lo=orbitDecode(${sample(`${U}(skyCoord.x,(skyCoord.y+floor(band))/3.0)`)});
    ${C} hi=orbitDecode(${sample(`${U}(skyCoord.x,(skyCoord.y+min(floor(band)+1.0,2.0))/3.0)`)});
    ${C} edgeF=coatF0+(1.0-coatF0)*pow(1.0-nv,5.0);
    col += 2.0*skyDiffuse*coatBase + mix(lo,hi,fract(band))*edgeF*(1.0-0.35*rough);`;
  return `
    ${C} hp=${p};
    // The equatorial trench and three annular nozzle collars are structural alloy. Keep
    // the deck dielectric, including white armor and colored team markings. Soften mask edges in screen space.
    ${F} aa=clamp(fwidth(hp.z)*0.55,0.65,4.0);
    ${F} trench=(1.0-smoothstep(4.0,4.0+aa,abs(hp.z-52.0)))*smoothstep(28.0,43.0,abs(hp.x));
    ${F} dx=min(abs(hp.x),abs(abs(hp.x)-87.2));
    ${F} lip=(1.0-smoothstep(3.0,3.0+aa,abs(length(${U}(dx,hp.z-50.6))-22.0)))*smoothstep(280.0,297.0,hp.y);
    ${F} alloy=max(trench,lip);
    ${F} rough=mix(0.82-0.22*clamp(gloss,0.0,1.0),0.31,alloy);
    ${C} coatF0=mix(${V}(0.042),${V}(0.51,0.54,0.58),alloy);
    ${C} coatBase=albedo*${M}diffuse*ls.rgb*(1.0-0.87*alloy);
    ${C} halfDir=(${view}+${L}sunDir)/max(length(${view}+${L}sunDir),0.001);
    ${F} nv=clamp(dot(n,${view}),0.001,1.0); ${F} nl=max(dot(n,${L}sunDir),0.0);
    ${F} nh=clamp(dot(n,halfDir),0.0,1.0); ${F} vh=clamp(dot(${view},halfDir),0.0,1.0);
    ${F} a2=rough*rough*rough*rough; ${F} denom=nh*nh*(a2-1.0)+1.0;
    ${F} k=(rough+1.0)*(rough+1.0)/8.0;
    ${C} fresnel=coatF0+(1.0-coatF0)*pow(1.0-vh,5.0);
    ${C} spec=fresnel*(a2/(3.14159*denom*denom))*nl/max(4.0*mix(nv,1.0,k)*mix(nl,1.0,k),0.001);
    ${C} keyVis=${wg ? `select(${V}(sun),mix(${L}shadowTint,${V}(1.0),shadowLit)*sun,mapShadow)` : `mapShadow ? mix(shadowTint,${V}(1.0),shadowLit)*sun : ${V}(sun)`};
    mapShadow=false; // only the sun is occluded; environment, blasts and emission stay independent
    col=coatBase*(${wg ? `select(indirect,0.14*indirect,vacuum)` : '(vacuum ? 0.14*indirect : indirect)'}+min(boltSum,${V}(1.4))) + keyVis*(${L}sunColor*nl*coatBase*(1.0-fresnel)+${L}sunSpecular*spec) + albedo*${M}emissive*2.0;
    ${orbital ? orbitalLight : ''}`;
}
