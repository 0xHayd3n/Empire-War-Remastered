// A terrain texture is not a land-use map. Only a reviewed apron or an actual construction
// paint event can authorize manufactured ground. Never change TED paint or the building system.
export function groundZones(t, used, recipe, props) {
  const policy = recipe.zones,
    rules = new Map(),
    built = new Set();
  if (!policy) throw Error('Missing land-use review');
  for (const [s, i] of used.entries()) if (recipe.slots[i]?.use === 'built') built.add(s);
  for (const rule of policy) {
    const s = used.indexOf(rule.slot),
      fallback = used.indexOf(rule.natural);
    if (!built.has(s) || fallback < 0 || recipe.slots[rule.natural].use !== 'natural' || rules.has(s))
      throw Error('Invalid built-ground fallback');
    for (const a of rule.aprons) {
      if (!props.some(p => p.modelFile.toUpperCase() === a.model && Math.hypot(p.x - a.anchor[0], p.y - a.anchor[1]) < 1))
        throw Error('Missing reviewed apron landmark');
    }
    rules.set(s, { ...rule, fallback });
  }
  if (rules.size !== built.size) throw Error('Unzoned manufactured ground');
  const authorized = (i, s) => {
    const rule = rules.get(s);
    if (!rule) return false;
    if (rule.construction && t.paint.construction?.[i] === rule.slot + 1) return true;
    const x = (i % t.size) * 20,
      y = Math.floor(i / t.size) * 20;
    // Inset one terrain cell: even interpolated corner weights cannot bleed into wilderness.
    return rule.aprons.some(({ rect: [l, b, r, h] }) => x >= l + 20 && x <= r - 20 && y >= b + 20 && y <= h - 20);
  };
  return {
    built,
    authorized,
    slotAt(i, s) {
      const rule = rules.get(s);
      return !rule || authorized(i, s) ? s : rule.fallback;
    }
  };
}
