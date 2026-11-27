// The finite terrain rectangle and the camera pivot limits are different. Inventory both;
// neither terrain paint nor the planet name decides what belongs on the horizon.
export const rimViews = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
export function edgeIntake(t, map) {
  const w = t.width ?? t.size,
    h = t.height ?? t.size,
    span = [(w - 1) * 20, (h - 1) * 20],
    lo = map.playMin?.slice(0, 2) ?? [0, 0],
    hi = map.playMax?.slice(0, 2) ?? [(t.size - 1) * 20, (t.size - 1) * 20]; // Same fallback as the land camera, not the unpadded rectangle.
  let holes = 0,
    wet = 0,
    min = Infinity,
    max = -Infinity;
  function at(x, y) {
    const i = y * t.size + x,
      z = t.heights[i];
    min = Math.min(min, z);
    max = Math.max(max, z);
    holes += +!!t.layers[t.layerIndex[i]]?.hole;
    wet += +(t.water?.mode === 1 && z < t.water.level);
  }
  for (let x = 0; x < w; x++) {
    at(x, 0);
    at(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    at(0, y);
    at(w - 1, y);
  }
  return { span, pivot: [...lo, ...hi], margins: [lo[0], lo[1], span[0] - hi[0], span[1] - hi[1]], edgeHeight: [min, max], holes, wet };
}
export function checkOutskirtsBrief(d) {
  const a = d.outskirts;
  if (
    !a ||
    !['flat', 'foothills', 'mountains', 'coastal', 'authored'].includes(a.treatment) ||
    !['skyline', 'join', 'reject'].every(k => typeof a[k] === 'string' && a[k].trim().length >= 12) ||
    !Array.isArray(a.evidence) ||
    new Set(a.evidence).size < 2 ||
    a.evidence.some(h => !d.views.some(v => v.sha256 === h))
  )
    throw Error('Need a referenced outskirts treatment, join and rejected alternative');
  if (!Array.isArray(a.foliage) || a.foliage.some(id => !d.foliage.review?.forms.some(f => f.id === id && f.disposition !== 'absent')))
    throw Error('Scenic foliage must be a reviewed living class or explicitly empty');
  return a;
}
export function checkOutskirtsAudit(d, report) {
  const brief = checkOutskirtsBrief(d),
    a = report.outskirtsAudit;
  if (
    !a ||
    a.treatment !== brief.treatment ||
    !(Number.isFinite(a.maximum) && a.maximum > 0) ||
    !Array.isArray(a.pivot) ||
    a.pivot.length !== 4 ||
    !a.pivot.every(Number.isFinite) ||
    a.boundsUnchanged !== true ||
    !a.rollback ||
    a.rollback.changed > 40 ||
    !Number.isInteger(a.rollback.changed) ||
    a.rollback.changed < 0 ||
    !Array.isArray(a.samples) ||
    a.samples.length !== 16
  )
    throw Error('Need mounted perimeter, camera limits and rollback evidence');
  for (const view of rimViews)
    for (const band of ['maximum', 'oblique']) {
      const s = a.samples.find(s => s.view === view && s.band === band);
      const [x0, y0, x1, y1] = a.pivot,
        x = view.includes('w') ? x0 : view.includes('e') ? x1 : (x0 + x1) / 2,
        y = view.includes('s') ? y0 : view.includes('n') ? y1 : (y0 + y1) / 2;
      if (
        !s ||
        !Array.isArray(s.c) ||
        s.c[0] !== x ||
        s.c[1] !== y ||
        s.c[2] !== s.dist ||
        !(s.tested > 0 && Number.isFinite(s.exposed) && s.exposed >= 0 && s.exposed <= s.tested && s.exposed / s.tested <= 0.0001) ||
        !(band === 'maximum' ? s.dist === a.maximum : s.dist > 0 && s.dist < a.maximum)
      )
        throw Error('Exposed or untested battlefield outskirts: ' + view + ' ' + band);
    }
  if (
    brief.treatment !== 'authored' &&
    rimViews.some(v => !a.skyline?.some(s => s.view === v && Number.isInteger(s.changed) && s.changed >= 0 && s.changed <= 8))
  )
    throw Error('The outermost strip is visible or the far horizon was not checked');
  if (
    brief.treatment !== 'authored' &&
    !(a.control?.before > 100 && a.control.after >= 0 && a.control.after < a.control.before * 0.01 && a.triangles > 0)
  )
    throw Error('Missing positive edge exposure control');
  return a;
}
