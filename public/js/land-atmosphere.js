// All sky geometry, radiance and cloud detail are generated locally. Same equations on both
// backends; no cube-face UV seams, texture fetches, history buffers, or per-pixel ray march.
export function skyAtmosphereShader(wg) {
  const d = wg ? 'D.' : '',
    p = wg ? 'P.' : '',
    f = wg ? 'let' : 'float',
    colorVar = wg ? 'var' : 'vec3',
    v = wg ? 'let' : 'vec2',
    V = wg ? 'let' : 'vec3',
    v2 = wg ? 'vec2f' : 'vec2',
    v3 = wg ? 'vec3f' : 'vec3';
  return `${wg ? 'fn skyHash(q:vec3f)->f32' : 'float skyHash(vec3 q)'}{
    ${V} a=fract(q*.1031); ${V} b=a+${v3}(dot(a,a.yzx+${v3}(33.33))); return fract((b.x+b.y)*b.z);
  }
  ${wg ? 'fn skyNoise(q:vec2f)->f32' : 'float skyNoise(vec2 q)'}{
    ${v} i=floor(q); ${v} a=fract(q); ${v} s=a*a*(3.-2.*a);
    return mix(mix(skyHash(${v3}(i,1.)),skyHash(${v3}(i+${v2}(1.,0.),1.)),s.x),
               mix(skyHash(${v3}(i+${v2}(0.,1.),1.)),skyHash(${v3}(i+${v2}(1.),1.)),s.x),s.y);
  }
  ${wg ? 'fn landAtmosphere(ray:vec3f)->vec3f' : 'vec3 landAtmosphere(vec3 ray)'}{
    ${f} h=max(0.,ray.z); ${f} dust=${d}wxOptics.z; ${f} seed=${d}skyFlow.z;
    ${V} horizon=${d}wxHorizon.rgb; ${V} zenith=${d}wxZenith.rgb;
    ${f} mu=max(0.,dot(ray,${p}sunDir));
    // A downward tactical view covers many pixels below all cloud/optics masks. The
    // exact non-dust result there is the horizon and solar term, with no noise lookups.
    if(ray.z<=-.10 && dust==0.){return horizon+${v3}(1.,.93,.81)*(${d}wxOptics.x*(.25*pow(mu,30.)+.88*smoothstep(.99945,.99988,mu)));}
    ${V} air=mix(horizon,zenith,mix(sqrt(h),smoothstep(.03,.68,h),dust));
    ${v} plane=ray.xy/(.20+h); ${v} q=(plane*2.4+${d}skyFlow.xy)/${v2}(${d}wxOptics.y,1.)+${v2}(seed,-.47*seed);
    // A high sheared layer and a lower bank advect at different rates. Change the density
    // field, not just its tint: round cloud tops, parallel rolls, high fibres or a flat lid.
    ${V} morph=${d}wxFormation.xyz; ${f} deck=${d}wxFormation.w;
    ${f} body=skyNoise(q); ${f} warp=skyNoise(q*.51+${v2}(4.7,-2.));
    ${f} fine=skyNoise(3.8*q); ${f} core=.55*body+.30*skyNoise(1.94*q)+.15*fine;
    ${v} high=plane*${v2}(.96,6.3)+${d}skyFlow.xy*.48+${v2}(seed,warp*2.);
    ${f} fibres=skyNoise(high+.6*fine); ${f} rolls=.5+.5*cos(5.8*q.y+5.2*warp+body);
    ${f} towers=1.-abs(2.*core-1.);
    ${f} bank=clamp(core+.58*morph.x*(fibres-.5)+.47*morph.z*(rolls-.5)+.26*morph.y*(towers-.56),0.,1.);
    ${f} cover=clamp(${d}wxHorizon.w+.23*deck+.07*morph.y,0.,.91);
    ${f} cloud=smoothstep(.72-.66*cover,.85-.50*cover,bank)*smoothstep(-.08,.04,ray.z);
    ${V} lit=mix(horizon,${v3}(1.,.98,.94),.46*${d}wxOptics.x);
    ${f} relief=.62+.35*bank+.15*mu+.13*morph.y*(fine-.32);
    ${V} layer=mix(air,lit*relief,cloud*(1.-dust)*(.61+.32*cover));
    ${f} glare=${d}wxOptics.x*mix(.25*pow(mu,30.)+.88*smoothstep(.99945,.99988,mu),.26*pow(mu,6.)+.12*pow(mu,44.),dust)*(1.-.78*cloud);
    ${f} veil=dust*(bank-.48)*.11*(1.-smoothstep(.03,.42,h));
    // Uniform branches: don't evaluate stars, rings or curtains on worlds where they're absent.
    ${colorVar} accents=${v3}(0.);
    if(${d}wxOptics.w>0.){
      ${V} lattice=ray*145.+${v3}(seed); ${f} star=skyHash(floor(lattice));
      ${f} pin=(1.-smoothstep(.035,.23,length(fract(lattice)-${v3}(.5))))*smoothstep(.64,1.,star);
      accents+=${v3}(.78,.86,1.)*(${d}wxOptics.w*pin*smoothstep(.015,.28,h)*(1.-cloud));
    }
    if(${d}skyFlow.w>0.){
      ${f} band=abs(dot(ray,normalize(${v3}(.46,-.36,.81)))-.17);
      accents+=${v3}(.30,.27,.23)*(${d}skyFlow.w*smoothstep(.012,.019,band)*(1.-smoothstep(.038,.052,band))*smoothstep(.0,.13,h)*(1.-cloud));
    }
    // Effects occupy the sky only: distant falling columns below a cloud bank, low mist,
    // a 22-degree ice halo about the authored sun, and a polar curtain behind night clouds.
    ${f} low=(1.-smoothstep(.015,.26,h))*smoothstep(-.10,.025,ray.z);
    ${f} shafts=${d}wxPhenomena.x*low*smoothstep(.43,.73,body)*(.18+.42*fibres);
    ${f} haze=${d}wxPhenomena.w*low*(.24+.18*warp);
    ${f} halo=${d}wxPhenomena.y*(1.-smoothstep(.001,.012,abs(mu-.9272)))*smoothstep(.015,.12,h)*(1.-.78*cloud);
    if(${d}wxPhenomena.z>0.){
      ${f} bow=.30+.095*sin(3.5*ray.x+seed)+.035*sin(9.*ray.y+.45*${d}skyFlow.x);
      ${f} arc=h-bow; ${f} curtain=smoothstep(-.025,.009,arc)*(1.-smoothstep(.016,.21,arc));
      ${f} aurora=${d}wxPhenomena.z*${d}wxOptics.w*curtain*(.35+.65*fibres)*(1.-cloud);
      accents+=mix(${v3}(.035,.31,.21),${v3}(.12,.09,.27),smoothstep(.02,.15,arc))*aurora;
    }
    ${V} radiance=mix(layer,horizon,min(.72,shafts+haze))+${v3}(veil)+${v3}(1.,.93,.81)*glare;
    return max(${v3}(0.),radiance+accents+${v3}(.19,.16,.12)*halo);
  }`;
}
