// The grid is a lookup accelerator, not the collision boundary: a fraction-of-a-pixel
// pan across a cell edge should not swap two labels that actually fit side by side.
function nameGrid(w, h) {
  const cols = Math.ceil(w / 32),
    rows = Math.ceil(h / 32),
    bins = [];
  return (box, insert) => {
    const [l, t, r, b] = box,
      x1 = Math.min(cols - 1, Math.floor(r / 32)),
      y1 = Math.min(rows - 1, Math.floor(b / 32));
    for (let y = Math.max(0, Math.floor(t / 32)); y <= y1; y++)
      for (let x = Math.max(0, Math.floor(l / 32)); x <= x1; x++) {
        const i = y * cols + x;
        if (insert) (bins[i] ??= []).push(box);
        else if (bins[i]?.some(a => l < a[2] && r > a[0] && t < a[3] && b > a[1])) return true;
      }
    return false;
  };
}
const duration = 145;
function opacity(s, goal, now, instant) {
  if (instant) {
    s.from = s.to = s.alpha = goal;
    s.start = now;
    return goal;
  }
  if (s.to !== goal) {
    s.from = s.alpha;
    s.to = goal;
    s.start = now;
  }
  const distance = Math.abs(goal - s.from);
  const t = distance ? Math.min(1, (now - s.start) / (duration * distance)) : 1;
  return (s.alpha = t === 1 ? goal : s.from + (goal - s.from) * t);
}
export function contextNames() {
  const states = new Map();
  return {
    clear() {
      states.clear();
    },
    paint(ctx, visible, hover, protectedRects, w, h, gap, pt, instant) {
      const grid = nameGrid(w, h),
        now = performance.now(),
        wanted = new Map(),
        live = new Set();
      for (const [l, t, width, height] of protectedRects) grid([l, t, l + width, t + height], true);
      const pad = Math.max(1, pt * 0.16),
        half = pt * 0.65;
      function anchor(X, Y, width, side) {
        if (side === 1) return [X - width - gap, Y];
        if (side >= 2) return [X - width / 2, Y + (side === 2 ? -1 : 1) * (gap + pt * 0.5)];
        return [X + gap, Y];
      }
      function reserve([X, Y, p], side) {
        const width = p.em * pt,
          [l, y] = anchor(X, Y, width, side),
          box = [l - pad, y - half, l + width + pad, y + half];
        if (box[0] < 0 || box[1] < 0 || box[2] > w || box[3] > h || grid(box, false)) return false;
        grid(box, true);
        wanted.set(p, side);
        return true;
      }
      // Prefer a hovered name's last usable side, then already admitted ordinary names.
      const hot = hover && visible.find(e => e[2] === hover);
      if (hot) {
        const side = states.get(hover)?.side ?? 0;
        if (!reserve(hot, side)) for (const next of [0, 1, 2, 3]) if (next !== side && reserve(hot, next)) break;
      }
      for (const e of visible) if (e !== hot && states.get(e[2])?.regular) reserve(e, 0);
      for (const e of visible) if (e !== hot && !wanted.has(e[2])) reserve(e, 0);
      // If the next name needs the same space, let the departing word clear first
      // rather than superimposing two sets of half-transparent glyphs.
      let retiring;
      if (!instant)
        for (const [X, Y, p] of visible) {
          const s = states.get(p);
          if (s?.alpha > 0 && wanted.get(p) !== s.side) {
            const width = p.em * pt,
              [l, y] = anchor(X, Y, width, s.side);
            (retiring ??= nameGrid(w, h))([l - pad, y - half, l + width + pad, y + half], true);
          }
        }
      let moving = false;
      for (const [X, Y, p] of visible) {
        const side = wanted.get(p);
        let s = states.get(p);
        if (!s) {
          if (side === undefined) continue;
          states.set(p, (s = { side, alpha: 0, from: 0, to: 0, start: now }));
        }
        s.regular = p !== hover && side === 0;
        // Relocate at zero opacity, never jump a visible word across its planet.
        if (side !== undefined && (instant || s.alpha === 0)) s.side = side;
        const width = p.em * pt,
          [l, y] = anchor(X, Y, width, s.side);
        if (retiring && side === s.side && !s.alpha && retiring([l - pad, y - half, l + width + pad, y + half], false)) {
          live.add(p);
          moving = true;
          continue;
        }
        const goal = Number(side === s.side),
          a = opacity(s, goal, now, instant);
        if (!a && side === undefined) {
          states.delete(p);
          continue;
        }
        live.add(p);
        if (a !== goal || (side !== undefined && s.side !== side)) moving = true;
        if (a) {
          ctx.globalAlpha = a;
          ctx.fillText(p.name, l, y);
        }
      }
      ctx.globalAlpha = 1;
      for (const p of states.keys()) if (!live.has(p)) states.delete(p);
      return moving;
    }
  };
}
