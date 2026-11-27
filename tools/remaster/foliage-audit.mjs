// Enforce measured continuity, not a rule that every planet must have several plant types.
export function checkFoliageAudit(direction, report) {
  const review = direction.foliage?.review,
    a = report.foliageAudit;
  if (!review || review.status === 'unreviewed' || !a) throw Error('Need reference-reviewed foliage and mounted foliage evidence');
  const living = review.forms.filter(f => f.disposition !== 'absent').map(f => f.id);
  if (review.disposition === 'absent') {
    if (living.length || a.drawn !== 0 || a.allocated !== 0 || !a.clearView || !report.views[a.clearView])
      throw Error('An absent class must allocate and draw no foliage');
    return a;
  }
  if (
    !Number.isFinite(a.maximum) ||
    a.maximum <= 0 ||
    !Array.isArray(a.roles) ||
    !a.roles.length ||
    new Set(a.roles).size !== a.roles.length ||
    a.roles.some(k => !living.includes(k)) ||
    living.some(k => !a.roles.includes(k))
  )
    throw Error('Audit every evidenced foliage class');
  if(a.mode==='retained-draws'){
    if(review.forms.some(f=>f.disposition==='replace'))throw Error('Retained-mesh evidence cannot release a replacement stream');
    for(const role of living){const s=a.samples.filter(x=>x.role===role),first=s[0],last=s.at(-1);if(!first||first.d>=a.maximum||last.d!==first.d||new Set(s.map(x=>x.d)).size<4||!s.some(x=>x.d===a.maximum)||s.some(x=>!x.same||!Number.isInteger(x.roots)||x.roots<=0||x.roots!==first.roots))throw Error('No same-root retained draw at every height: '+role);
      for(const d of [first.d,a.maximum])if(!a.controls.some(c=>c.role===role&&c.d===d&&Number.isFinite(c.pixels)&&c.pixels>=25&&/^[a-z0-9-]+$/.test(c.stem)))throw Error('Missing retained-class visibility control: '+role);}
    return a;
  }
  if (a.uploads?.unused !== 0 || !(a.uploads.written > 0)) throw Error('Check real foliage upload ranges during pan and zoom');
  for (const role of living) {
    const samples = a.samples.filter(s => s.role === role),
      controls = a.controls.filter(c => c.role === role);
    const first = samples[0],
      last = samples.at(-1);
    if (
      !first ||
      new Set(samples.map(s => s.d)).size < 4 ||
      first.d >= a.maximum ||
      last.d !== first.d ||
      !samples.some(s => s.d === a.maximum) ||
      samples.some(
        s =>
          s.same !== true ||
          s.roots !== first.roots ||
          !(s.roots > 0 && s.live >= s.roots && s.capacity >= s.live && s.triangles > 0) ||
          s.plans !== first.plans ||
          !s.streams?.length ||
          s.streams.some(x => !(x.peak >= x.active && x.peak <= x.capacity && x.capacity <= Math.ceil(x.peak * 1.25)))
      )
    )
      throw Error('Missing foliage or placement rebuilt during fixed-root zoom: ' + role);
    for (const d of [first.d, a.maximum])
      if (!controls.some(c => c.d === d && Number.isFinite(c.pixels) && c.pixels >= 25 && /^[a-z0-9-]+$/.test(c.stem)))
        throw Error('Need visible foliage-on/off controls at both ends: ' + role);
  }
  return a;
}
