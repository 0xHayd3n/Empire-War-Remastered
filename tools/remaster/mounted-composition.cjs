// Test-only previous-layout replay. Hold army, light, weather, donor arrays, shade and cameras fixed.
// Command distance only (no near-patch displacement). Never part of normal gameplay.
module.exports = async function previousLayout(_, previous) {
  const g = game,
    t = g.terrain,
    P = t.paint,
    U = g.ground.material.uniforms,
    { drawFloorSlots } = await import('/js/game/endor-habitat.js');
  if (g.view.dist <= 225) throw Error('Layout comparison needs a coarse view');
  if (previous) {
    const floor = P.floorLayout,
      open = new Set([0, 3, 10, 58].map(i => P.slot.get(i))),
      leaf = P.slot.get(22),
      { groundZones } = await import('/js/game/ground-zones.js'),
      r = window.reviewRecipe,
      z = groundZones(t, [...P.slot.keys()], r, g.props);
    window.restoreReviewLayout = () => {
      P.floorLayout = floor;
      U.groundMixB.value.w = 1;
      drawFloorSlots(t);
    };
    P.floorLayout = {
      slotAt(i, raw) {
        const s = z.slotAt(i, raw);
        return r.canopy && open.has(s) && floor.coverAt(i) > 0.27 ? leaf : s;
      }
    };
    U.groundMixB.value.w = 0;
    drawFloorSlots(t);
  } else {
    window.restoreReviewLayout();
    delete window.restoreReviewLayout;
  }
};
module.exports.readField = async function () {
  const g = game,
    t = g.terrain,
    P = t.paint,
    U = g.ground.material.uniforms,
    recipe = window.reviewRecipe,
    { width: actualW, height: h, data: bytes } = U.canopyMap.value.image,
    w = actualW / 2,
    rawOf = [...P.slot.keys()],
    compact = [...U.groundMixA.value.toArray(), ...U.groundMixB.value.toArray().slice(0, 3)],
    idx = s => Math.round(U.texU.value[s].w - 2),
    palette = Object.fromEntries(compact.map(s => [idx(s), U.matSpecular.value[s].toArray()])),
    legacy = P.floorLayout;
  if (U.groundMixB.value.w !== 1 || w !== t.width || h !== t.height || bytes.length !== w * h * 8)
    throw Error('No mounted spatial cover field');
  return recipe.composition.regions.map(r => {
    const [x, y, W, H] = r.grid,
      prior = [],
      modern = [],
      mask = [],
      rgb = [],
      oldRGB = [], substrate = [], pair = recipe.composition.variation?.pair?.map(slot => recipe.composition.channels.indexOf(slot));
    if (x < 0 || y < 0 || x + W > w || y + H > h) throw Error('Invalid composition control');
    for (let j = y; j < y + H; j++)
      for (let i = x; i < x + W; i++) {
        const v = j * t.size + i,
          raw = t.layerIndex[v],
          compactRaw = P.slot.get(raw),
          permitted = legacy.authorized(v, compactRaw),
          legacyRaw = permitted ? raw : (recipe.zones.find(z => z.slot === raw)?.natural ?? raw),
          was = recipe.canopy && [0, 3, 10, 58].includes(legacyRaw) && legacy.coverAt(v) > 0.27 ? 22 : legacyRaw;
        mask.push(+(!permitted && compactRaw !== undefined && !t.layers[raw]?.hole));
        const before = idx(P.slot.get(was));
        prior.push(before);
        oldRGB.push(palette[before] ?? [0, 0, 0]);
        const o = 4 * (j * 2 * w + i),
          q = Array.from({ length: 7 }, (_, c) => bytes[o + (c < 4 ? c : 4 * w + c - 4)]);
        if (q.reduce((a, b) => a + b, 0) !== 255) throw Error('Cover weights not normalized');
        // Measure one substrate, not the contrast between a road, a cliff and a field.
        if(pair){const a=q[pair[0]],b=q[pair[1]];substrate.push(mask.at(-1) && a+b>=.70*255 ? a/(a+b) : null);}
        const major = compact[q.indexOf(Math.max(...q))];
        modern.push(idx(major));
        rgb.push([0, 1, 2].map(k => q.reduce((s, b, c) => s + (b / 255) * palette[idx(compact[c])][k], 0)));
        if (mask.at(-1) && legacy.slotAt(v, compactRaw) !== major) throw Error('Relief/draw layout disagrees with bound weights');
      }
    return { name: r.name, grid: r.grid, mask, prior, modern, rgb, oldRGB, palette, substrate };
  });
};
