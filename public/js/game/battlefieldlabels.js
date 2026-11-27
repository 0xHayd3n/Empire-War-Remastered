import { nameGrid } from './universalcontextnames.js';

// Screen-space lettering only. Never move a globe or use label positions for a launch.
export function placeNames(points, w, h, r, previous, priority) {
  const grid = nameGrid(w, h),
    accepted = [];
  for (const p of points) grid([p.x - r - 1, p.y - r - 1, p.x + r + 1, p.y + r + 1], true);
  const reserve = p => {
    const gap = r + 3,
      half = 5.5,
      width = p.width;
    const sides = [
      [gap, 0],
      [-gap - width, 0],
      [-width / 2, -gap - half],
      [-width / 2, gap + half],
      [gap, -gap - half],
      [-gap - width, -gap - half],
      [gap, gap + half],
      [-gap - width, gap + half]
    ];
    const trySide = i => {
      const [dx, dy] = sides[i],
        x = p.x + dx,
        y = p.y + dy,
        box = [x - 1.5, y - half - 1, x + width + 1.5, y + half + 1];
      if (box[0] < 1 || box[1] < 1 || box[2] > w - 1 || box[3] > h - 1 || grid(box, false)) return false;
      grid(box, true);
      accepted.push({ p, i, x, y, box });
      return true;
    };
    const old = previous.get(p.id)?.i;
    if (old !== undefined && trySide(old)) return;
    for (let i = 0; i < sides.length; i++) if (i !== old && trySide(i)) break;
  };
  // Previously legible neighbours keep their place unless it actually conflicts.
  for (const p of points) if (p.id === priority) reserve(p);
  for (const p of points) if (p.id !== priority && previous.has(p.id)) reserve(p);
  for (const p of points) if (p.id !== priority && !previous.has(p.id)) reserve(p);
  return accepted;
}
export function battlefieldLabels(map, reduced) {
  const canvas = document.createElement('canvas');
  canvas.className = 'op-planet-names';
  canvas.setAttribute('aria-hidden', 'true');
  map.append(canvas);
  const ctx = canvas.getContext('2d'),
    font = '10px system-ui';
  let worlds = [],
    view,
    prior = new Map(),
    hits = [],
    raf = 0,
    hover = null,
    picked = null,
    wasVisible = false;
  function queue() {
    if (!raf) raf = requestAnimationFrame(draw);
  }
  function draw(now) {
    raf = 0;
    if (!view) return;
    const { w, h, x, y, z } = view,
      d = Math.min(devicePixelRatio || 1, 2),
      alpha = Math.max(0, Math.min(1, (z - 1.4) / 0.85));
    if (!alpha && !hover && !picked && !wasVisible) return;
    if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) {
      canvas.width = Math.round(w * d);
      canvas.height = Math.round(h * d);
    }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = font;
    ctx.textBaseline = 'middle';
    const r = 1.75 * z,
      points = [];
    for (const p of worlds) {
      p.x = x + p.u * w * z;
      p.y = y + p.v * h * z;
      if (p.x >= -r && p.y >= -r && p.x <= w + r && p.y <= h + r) points.push(p);
    }
    const target = hover || picked,
      all = placeNames(points, w, h, r, prior, target),
      next = new Map();
    hits = [];
    for (const n of all) {
      const focus = n.p.id === target;
      if (!alpha && !focus) continue;
      const state = prior.get(n.p.id),
        since = state?.since ?? now,
        fade = reduced.matches ? 1 : Math.min(1, (now - since) / 145);
      ctx.globalAlpha = fade * (focus ? 1 : alpha);
      ctx.strokeStyle = '#0a101ae6';
      ctx.lineWidth = 2.6;
      ctx.lineJoin = 'round';
      ctx.strokeText(n.p.name, n.x, n.y);
      ctx.fillStyle = focus ? '#ffe5a8' : '#e2e9ec';
      ctx.fillText(n.p.name, n.x, n.y);
      next.set(n.p.id, { i: n.i, since });
      hits.push(n);
      if (fade < 1) queue();
    }
    prior = next;
    wasVisible = hits.length > 0;
    ctx.globalAlpha = 1;
    canvas.dataset.labels = String(hits.length);
  }
  return {
    set(ids, names, positions) {
      ctx.font = font;
      worlds = positions.map(([u, v], i) => ({ id: ids[i], name: names[i], width: ctx.measureText(names[i]).width, u, v }));
      prior.clear();
      queue();
    },
    move(w, h, x, y, z) {
      view = { w, h, x, y, z };
      queue();
    },
    hit(x, y) {
      return hits.find(({ box: b }) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])?.p.id;
    },
    hover(id) {
      if (hover !== id) {
        hover = id;
        queue();
      }
    },
    select(id) {
      picked = id;
      queue();
    },
    close() {
      cancelAnimationFrame(raf);
      worlds = [];
      hits = [];
      canvas.remove();
    }
  };
}
