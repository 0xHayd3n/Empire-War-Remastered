// Screen-space context, not gameplay objects. Never attach routes, owners or hit actions
// to these worlds. At wide zoom prioritize active labels; hover can name a crowded dot.
export function inactiveWorlds(catalog, excluded, activeNames) {
  // Regional variants (e.g. a separate Mandalore_Big) may have the same display name.
  // Never show a second gray Mandalore next to the active one. Only background labels
  // coalesce here; exact active IDs, positions, routes and counts stay untouched.
  const seen = new Set(activeNames.map(n => n.trim().toLowerCase()));
  return catalog.filter(p => {
    const name = p.name.trim().toLowerCase();
    if (excluded.has(p.id) || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
export function contextWorlds(canvas) {
  const ctx = canvas.getContext('2d');
  let points = [],
    active = [],
    index = [],
    raf = 0,
    hover = null,
    view;
  function draw() {
    raf = 0;
    if (!view) return;
    const { w, h, x, y, z } = view,
      d = Math.min(devicePixelRatio || 1, 2),
      W = Math.round(w * d),
      H = Math.round(h * d);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    index = [];
    if (!points.length) return;
    const occupied = new Set(),
      foreground = new Set();
    function cells(s, l, t, width, height, mark) {
      for (let i = Math.floor(l / 8); i <= Math.floor((l + width) / 8); i++)
        for (let j = Math.floor(t / 9); j <= Math.floor((t + height) / 9); j++) {
          const k = i + ',' + j;
          if (mark) s.add(k);
          else if (s.has(k)) return true;
        }
      return false;
    }
    for (const [u, v, width] of active) {
      const X = u * w * z + x,
        Y = v * h * z + y;
      cells(occupied, X - 4, Y - 6, width + 12, 12, true);
      cells(foreground, X - 4, Y - 6, width + 12, 12, true);
    }
    ctx.font = '10px system-ui';
    ctx.textBaseline = 'middle';
    for (const p of points) {
      const X = p.u * w * z + x,
        Y = p.v * h * z + y;
      if (X < 0 || Y < 0 || X > w || Y > h || cells(foreground, X - 1, Y - 1, 2, 2, false)) continue;
      index.push([X, Y, p.name]);
      ctx.fillStyle = '#434951';
      ctx.beginPath();
      ctx.arc(X, Y, 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#858b91';
      ctx.fillRect(X - 1, Y - 1, 1.4, 1.4);
      const left = X + 4,
        width = p.width;
      if (!cells(occupied, left, Y - 5, width, 10, false)) {
        cells(occupied, left, Y - 5, width, 10, true);
        ctx.fillStyle = '#92959a';
        ctx.strokeStyle = 'rgba(10,13,17,.72)';
        ctx.lineWidth = 2;
        ctx.strokeText(p.name, left, Y);
        ctx.fillText(p.name, left, Y);
      }
    }
    if (hover) {
      const [X, Y, name] = hover,
        width = ctx.measureText(name).width;
      const left = Math.max(3, Math.min(w - width - 5, X + 6));
      ctx.fillStyle = '#14171c';
      ctx.fillRect(left - 2, Y - 8, width + 4, 16);
      ctx.fillStyle = '#c3c6cb';
      ctx.fillText(name, left, Y);
    }
  }
  function schedule() {
    if (!raf) raf = requestAnimationFrame(draw);
  }
  return {
    set(catalog, excluded, labels, names) {
      ctx.font = '10px system-ui';
      points = inactiveWorlds(catalog, excluded, names.slice(0, labels.length));
      for (const p of points) p.width ??= ctx.measureText(p.name).width;
      active = labels.map(([u, v], i) => [u, v, Math.min(260, 12 + names[i].length * 7)]);
      hover = null;
      canvas.dataset.inactive = String(points.length);
      schedule();
    },
    move(w, h, x, y, z) {
      view = { w, h, x, y, z };
      hover = null;
      schedule();
    },
    point(x, y) {
      const next = index.find(([X, Y]) => Math.abs(X - x) < 5 && Math.abs(Y - y) < 5);
      if (hover?.[2] !== next?.[2]) {
        hover = next;
        schedule();
      }
    },
    clear() {
      cancelAnimationFrame(raf);
      raf = 0;
      view = hover = null;
      points = active = index = [];
      canvas.dataset.inactive = '0';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };
}
