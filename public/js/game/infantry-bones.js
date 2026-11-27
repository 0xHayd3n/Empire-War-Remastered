// Match named anatomy, not nearest points or bone order: a tail, wing or second
// head must not be silently bound as a human limb. Stock ALO names always win.
const roles = new Map();
for (const [role, names] of Object.entries({ Pelvis: ['pelvis', 'hips'], Head: ['head'], Chest: ['chest', 'upperchest', 'spine2'] }))
  for (const name of names) roles.set(name, role);
for (const [side, word] of [
  ['L', 'left'],
  ['R', 'right']
]) {
  for (const [role, names] of Object.entries({
    Bicep: ['bicep', 'upperarm', 'arm'],
    FArm: ['farm', 'forearm', 'lowerarm'],
    Hand: ['hand', 'wrist'],
    Thigh: ['thigh', 'upperleg', 'upleg'],
    Calf: ['calf', 'shin', 'lowerleg', 'leg'],
    Foot: ['foot', 'ankle']
  })) {
    for (const n of names)
      for (const s of [side.toLowerCase(), word]) for (const name of [s + n, n + s]) roles.set(name, role + '_' + side);
  }
}
const rigs = new WeakMap();
export function infantryBone(inst, role) {
  const stock = inst.bone?.('B_' + role);
  if (stock) return stock;
  return namedRig(inst).get(role);
}
function namedRig(inst) {
  let rig = rigs.get(inst);
  if (!rig) {
    rig = new Map();
    rigs.set(inst, rig);
    for (const b of inst.bones || []) {
      const name = (b?.name || '')
        .split(':')
        .pop()
        .toLowerCase()
        .replace(/^valvebiped\./, '')
        .replace(/^mixamorig\d*|^bip\d*|^b_/, '')
        .replace(/[^a-z0-9]/g, '');
      const key = roles.get(name);
      if (key) rig.set(key, rig.has(key) ? null : b); // ambiguous -> keep authored animation
    }
  }
  return rig;
}
// True when the rig carries any recognised anatomy label, usable or not. Such a
// rig declares what it meant to be, so an ambiguous or broken humanoid keeps its
// authored death instead of being re-read as an arbitrary articulated skeleton.
export function hasNamedRoles(inst) {
  return namedRig(inst).size > 0;
}
export function hasLimbChains(rig) {
  const under = (child, parent) => {
    for (let n = child.parent; n; n = n.parent) if (n === parent) return true;
    return false;
  };
  return ['L', 'R'].every(s =>
    ['Bicep,FArm,Hand', 'Thigh,Calf,Foot'].every(chain => {
      const [top, mid, end] = chain.split(',').map(n => rig[n + '_' + s]);
      return under(mid, top) && under(end, mid);
    })
  );
}
