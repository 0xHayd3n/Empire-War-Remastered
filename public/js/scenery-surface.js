// Only used for rigid map props on an active remaster. No XML hint is required.
// 'auto' means consult each mounted material; '' means *keep authored*, even if its atlas is rock.
import { BLAST_SLOTS } from './blastlight.js';
// Filenames, not enclosing directories: many Workshop props share one texture directory.
const tokens = name =>
  String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z]+/);
const special =
  /^(?:ice(?:$|rock|cliff)|crystal|polish|glass|metal|chrome|steel|statue|house|tomb|door|wall|roof|panel|window|lamp|light|street|urban|crate|pipe|rocket|tile|glow|armor|armour|skull|bone|ribs|fissure|sandstorm|storm|effect)/;
const plant =
  /^(?:(?:swamp|endr)?(?:tree|leaf|leaves|bush|shrub|fern|frond|grass|vine)|foliage|palm|cact|mangrove|bracken|sapling|stump|reed|redwood|cattail|canopy|underbrush|groundcover|grndcvr|bark$)/;
const mineral =
  /^(?:(?:temp|tat|endr|lava)?(?:rock(?!et)|rckslide)|boulder|cliff|outcrop|stone|sandstone|basalt|granite|limestone|shale|slate|stalag|mesa|scarp|gravel)/;
function namedRole(parts) {
  const plants = parts.some(s => plant.test(s)),
    stone = parts.some(s => mineral.test(s));
  return stone === plants ? 'auto' : stone ? 'stone' : 'vegetation';
}
export function sceneryRole(type, model, hint) {
  const explicit = hint?.trim().toLowerCase();
  if (explicit) return ['stone', 'vegetation'].includes(explicit) ? explicit : '';
  const names = [...tokens(type), ...tokens(model)];
  return names.some(s => special.test(s)) ? '' : namedRole(names);
}
export function naturalSlot(role, shader, texture) {
  if (!role || !/^(?:tree|grass|(?:terrainmesh|batchmesh|mesh)(?:bump|alpha|gloss)?(?:colorize)?)\.fx$/i.test(shader)) return '';
  // Glass, fittings, polished and emissive submaterials keep their authored response,
  // even on a compound scenery model. Never infer a finish just from a gloss shader.
  const names = tokens(texture);
  if (names.some(s => special.test(s))) return '';
  if (/^(?:grass|tree)\.fx$/i.test(shader)) return 'vegetation';
  const slot = namedRole(names);
  if (slot !== 'auto') return slot;
  return role === 'auto' ? '' : role;
}
// The authored normal supplies relief; a white legacy alpha channel on a rock is
// not a polished coating. Diffuse lighting already includes the map sun, sky,
// cloud/cast visibility, soil and bolt lights. A wet dielectric still isn't metal.
export function naturalShade(wg, leaf) {
  const p = wg ? 'P.' : '',
    d = wg ? 'D.' : '',
    V = wg ? 'vec3f' : 'vec3',
    f = wg ? 'let' : 'float',
    c = wg ? 'let' : 'vec3',
    v = wg ? 'vv' : 'v';
  return `${f} wet=clamp(${p}sceneryWet,0.,1.)*smoothstep(-.3,.7,gn.z);
    ${c} paint=orbitDecode(albedo)*${d}diffuse*ls.rgb*(1.-wet*${leaf ? '.08' : '.17'});
    ${f} nh=max(0.,dot(n,normalize(${p}sunDir+${v}))); ${f} nl=max(0.,dot(n,${p}sunDir));
    ${f} sheen=mix(${leaf ? '.009' : '.003'},${leaf ? '.042' : '.032'},wet)*clamp(gloss,0.,1.)*pow(nh,mix(4.,18.,wet))*nl*sun;
    ${wg ? 'var' : 'vec3'} radiance=paint*(light+2.*${d}emissive)+${p}sunSpecular*clamp(${d}specular,${V}(0.),${V}(1.))*sheen;
    if (${p}receiverMode.x<1.5) {
      for (${wg ? 'var i=0' : 'int i=0'}; i<${BLAST_SLOTS}; i++){if (${wg ? 'f32' : 'float'}(i)>=${p}blastCount) {break;}
        radiance+=blastBounce(${p}blastSource[i].xyz-${wg ? 'v.vWorldPos' : 'vWorldPos'},${p}blastSource[i].w,${p}blastEnergy[i].rgb,n,${v},paint,${V}(.015),.08);
      }
    }
    ${wg ? 'var' : 'vec3'} col=orbitEncode(${wg ? 'select(orbitShoulder(radiance),radiance,P.orbitHDR>.5)' : '(orbitHDR>.5?radiance:orbitShoulder(radiance))'});`;
}
