// Screen-space context, never gameplay objects or hit targets. Compose the entire layer
// at 20% in CSS so overlapping marker, name and hover ink cannot build up opacity.
export function inactiveWorlds(catalog, excluded, activeNames) {
  // Different regional IDs can share a display name. Never put a gray copy next to the active one.
  const seen = new Set(activeNames.map(n => n.trim().toLowerCase()));
  return catalog.filter(p => {
    const name = p.name.trim().toLowerCase();
    if (excluded.has(p.id) || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
export function contextWorlds(canvas, labels) {
  const ctx = canvas.getContext('2d');
  let points = [],
    centers = [],
    models = [],
    index = [],
    raf = 0,
    hover,
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
    if (!points.length || !W || !H) return;
    // Reserve active footprints first. The native still contains opaque sky pixels and cannot
    // simply be layered over this canvas. Never paint a context pixel in a foreground box.
    const cols = Math.ceil(w / 8),
      rows = Math.ceil(h / 8),
      grid = new Uint8Array(rows * cols),
      ACTIVE = 2,
      NAME = 1;
    function cells(left, top, right, bottom, mask, write = false) {
      const i0 = Math.max(0, Math.floor(left / 8)),
        i1 = Math.min(cols - 1, Math.floor(right / 8)),
        j0 = Math.max(0, Math.floor(top / 8)),
        j1 = Math.min(rows - 1, Math.floor(bottom / 8));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const n = j * cols + i;
          if (write) grid[n] |= mask;
          else if (grid[n] & mask) return true;
        }
      return false;
    }
    const rect = canvas.getBoundingClientRect();
    for (const el of labels.children) {
      const r = el.getBoundingClientRect();
      cells(r.left - rect.left - 2, r.top - rect.top - 2, r.right - rect.left + 2, r.bottom - rect.top + 2, ACTIVE, true);
    }
    for (const [u, v] of centers) {
      const X = x + u * w * z,
        Y = y + v * h * z;
      cells(X - 7, Y - 7, X + 7, Y + 7, ACTIVE, true); // Includes the fallback marker while native art loads.
    }
    for (const [l, t, r, b] of models) cells(x + l * w * z - 2, y + t * h * z - 2, x + r * w * z + 2, y + b * h * z + 2, ACTIVE, true);
    ctx.font = '10px system-ui';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    function nameAt(p, left, Y) {
      if (left < 2 || left + p.width > w - 2 || Y < 8 || Y > h - 8 || cells(left - 2, Y - 8, left + p.width + 2, Y + 8, ACTIVE | NAME))
        return false;
      cells(left - 2, Y - 8, left + p.width + 2, Y + 8, NAME, true);
      ctx.fillStyle = '#eee';
      ctx.strokeText(p.name, left, Y);
      ctx.fillText(p.name, left, Y);
      return true;
    }
    for (const p of points) {
      const X = x + p.u * w * z,
        Y = y + p.v * h * z;
      if (X < 0 || Y < 0 || X > w || Y > h || cells(X - 3, Y - 3, X + 3, Y + 3, ACTIVE)) continue;
      index.push([X, Y, p]);
      ctx.fillStyle = '#aaa';
      ctx.beginPath();
      ctx.arc(X, Y, 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#eee';
      ctx.fillRect(X - 1, Y - 1, 1.4, 1.4);
    }
    // Hover has priority only among *inactive* names. Try the other side or above/below;
    // if no slot fits, do not cover an active name, ring or model with a tooltip.
    for (const [X, Y, p] of index)
      if (p === hover) {
        if (!nameAt(p, X + 4, Y) && !nameAt(p, X - p.width - 4, Y) && !nameAt(p, X - p.width / 2, Y - 10))
          nameAt(p, X - p.width / 2, Y + 10);
      }
    for (const [X, Y, p] of index) if (p !== hover) nameAt(p, X + 4, Y);
  }
  function schedule() {
    if (view && !raf) raf = requestAnimationFrame(draw);
  }
  // A pack font can finish loading without a map resize. Re-read the actual label boxes.
  document.fonts.addEventListener('loadingdone', schedule);
  return {
    set(catalog, excluded, positions, names) {
      ctx.font = '10px system-ui';
      points = inactiveWorlds(catalog, excluded, positions.length ? names : []);
      for (const p of points) p.width ??= ctx.measureText(p.name).width;
      centers = positions;
      models = [];
      hover = undefined;
      canvas.dataset.inactive = String(points.length);
      schedule();
    },
    protectModels(bounds) {
      models = bounds;
      schedule();
    },
    move(w, h, x, y, z) {
      view = { w, h, x, y, z };
      hover = undefined;
      schedule();
    },
    point(x, y) {
      const p = index.find(([X, Y]) => Math.abs(X - x) < 5 && Math.abs(Y - y) < 5)?.[2];
      if (hover !== p) {
        hover = p;
        schedule();
      }
    },
    clear() {
      cancelAnimationFrame(raf);
      raf = 0;
      view = hover = undefined;
      points = centers = models = index = [];
      canvas.dataset.inactive = '0';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    dispose() {
      document.fonts.removeEventListener('loadingdone', schedule);
    }
  };
}
