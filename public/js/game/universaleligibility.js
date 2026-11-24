// Only these two single-player openings have been checked against the native
// plots. Display families and dates are not launch identities.
export const equalFooting = 'Sandbox_Equal_Footing_Rebel';
export const canonStart = 'KnownSmall_Era_1_Rebel';
export const thrawnRevision = '5b2ceff618f502cf23a6d052d18d2cc895720a36462f9b4d28c5094515f311c4';
export const canonEligible = (p, r, v) =>
  p?.id === '1125571106' &&
  p.revision === thrawnRevision &&
  !r?.scripted &&
  r?.id === canonStart &&
  r.faction === 'Rebel' &&
  v?.id === canonStart;
export const fractalStart = faction => (['Empire', 'Greater_Maldrood'].includes(faction) ? `KnownSmall_Era_1_${faction}` : null);
export const fractalEligible = (p, r, v) =>
  p?.id === '1125571106' &&
  p.revision === thrawnRevision &&
  !r?.scripted &&
  !!fractalStart(r?.faction) &&
  r.id === fractalStart(r.faction) &&
  v?.id === r.id;
export const equalFootingStart = (p, r, v) =>
  !r?.scripted &&
  p?.id === 'stock' &&
  p.combat?.rescue === true &&
  r?.id === equalFooting &&
  r.faction === 'Rebel' &&
  v?.id === equalFooting;
export const envoyStart = equalFootingStart;
