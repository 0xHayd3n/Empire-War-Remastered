// Serialized by Playwright: read the actual drawn quad attributes, not the placement helper's verdict.
module.exports = async function auditGroundUse() {
  const g = game,
    t = g.terrain,
    P = t.paint,
    r = window.reviewRecipe;
  const rawOf = [...P.slot.keys()],
    seen = new Int16Array(t.layerIndex.length).fill(-1),
    attr = P.geo.attributes.layers;
  const counts = { checked: 0, built: 0, construction: 0, natural: 0, rerouted: 0, illegal: 0, oldIllegal: 0 };
  for (let y = 0; y < t.height - 1; y++)
    for (let x = 0; x < t.width - 1; x++) {
      const q = 2 * (y * (t.width - 1) + x),
        o = P.triAt[q];
      if (o < 0) continue;
      for (let c = 0; c < 4; c++) {
        const X = x + (c & 1),
          Y = y + (c >> 1),
          i = Y * t.size + X,
          raw = t.layerIndex[i],
          actual = rawOf[attr.array[o * 4 + c]];
        if (!P.slot.has(raw)) continue;
        if (seen[i] !== -1) {
          if (seen[i] !== actual) throw Error('Inconsistent material across cell boundary');
          continue;
        }
        seen[i] = actual;
        counts.checked++;
        const rule = r.zones.find(z => z.slot === raw),
          made = r.slots[actual]?.use === 'built',
          receipt = rule?.construction && P.construction?.[i] === raw + 1,
          permitted =
            rule &&
            (receipt ||
              rule.aprons.some(
                a => X * 20 >= a.rect[0] + 20 && Y * 20 >= a.rect[1] + 20 && X * 20 <= a.rect[2] - 20 && Y * 20 <= a.rect[3] - 20
              ));
        if (rule && !permitted) counts.oldIllegal++;
        if (made) {
          counts.built++;
          if (receipt) counts.construction++;
          if (!permitted || actual !== raw) counts.illegal++;
        } else {
          counts.natural++;
          if (rule && !permitted && r.slots[actual]?.use==='natural') counts.rerouted++;
        }
      }
    }
  if (counts.illegal || (r.zones.some(z=>z.aprons.length) && !counts.built) || !counts.natural || counts.oldIllegal !== counts.rerouted)
    throw Error('Ground use failed: ' + JSON.stringify(counts));
  return counts;
};
