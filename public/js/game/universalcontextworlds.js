import { portraitBank, planetDiameter, contextNameSize, nameSize, labelPixels } from './universalplanetart.js';
// Regional aliases may share a display name. Coalesce only background worlds, never the map's actual locations.
export function inactiveWorlds(catalog, excluded, activeNames) {
  const seen = new Set(activeNames.map(n => n.trim().toLowerCase()));
  return catalog.filter(p => {
    const name = p.name.trim().toLowerCase();
    if (excluded.has(p.id) || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
export function contextWorlds(canvas, front, labels) {
  const ctx = canvas.getContext('2d'),
    fg = front.getContext('2d'),
    art = portraitBank(schedule);
  let points = [],
    centers = [],
    active = null,
    preload,
    opening,
    models = [],
    index = [],
    raf = 0,
    hover,
    view;
  function prepare(c, context, w, h, d) {
    const W = Math.round(w * d),
      H = Math.round(h * d);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    context.setTransform(d, 0, 0, d, 0, 0);
    context.clearRect(0, 0, w, h);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
  }
  function draw() {
    raf = 0;
    if (!view) return;
    canvas.hidden = front.hidden = false;
    const { w, h, x, y, z } = view,
      d = Math.min(devicePixelRatio || 1, 2),
      size = planetDiameter * z,
      r = size / 2,
      pt = (labelPixels(z) * contextNameSize) / nameSize;
    prepare(canvas, ctx, w, h, d);
    prepare(front, fg, w, h, d);
    index = [];
    if (!w || !h) return;
    const cols = Math.ceil(w / 8),
      rows = Math.ceil(h / 8),
      grid = new Uint8Array(cols * rows),
      protectedRects = [];
    function cells(l, t, r, b, write) {
      const i0 = Math.max(0, Math.floor(l / 8)),
        i1 = Math.min(cols - 1, Math.floor(r / 8)),
        j0 = Math.max(0, Math.floor(t / 8)),
        j1 = Math.min(rows - 1, Math.floor(b / 8));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const k = j * cols + i;
          if (write) grid[k] = 1;
          else if (grid[k]) return true;
        }
      return false;
    }
    function protect(l, t, r, b) {
      if (r < 0 || b < 0 || l > w || t > h) return;
      protectedRects.push([l, t, r - l, b - t]);
      cells(l, t, r, b, true);
    }
    const rect = canvas.getBoundingClientRect();
    for (const el of labels.children) {
      const b = el.getBoundingClientRect();
      protect(b.left - rect.left - 1.5, b.top - rect.top - 1.5, b.right - rect.left + 1.5, b.bottom - rect.top + 1.5);
    }
    for (const [l, t, R, b] of models) protect(x + l * w * z - 1, y + t * h * z - 1, x + R * w * z + 1, y + b * h * z + 1);
    let detailed = 0;
    for (let i = 0; i < centers.length; i++) {
      const [u, v] = centers[i],
        X = x + u * w * z,
        Y = y + v * h * z;
      if (active) {
        art.draw(fg, active[i], X, Y, size);
        if (art.has(active[i])) detailed++;
      }
      const pad = r + 2;
      protect(X - pad, Y - pad, X + pad, Y + pad);
    }
    front.dataset.diameter = String(size);
    front.dataset.detailed = String(detailed);
    front.dataset.worlds = String(centers.length);
    ctx.textBaseline = 'middle';
    ctx.font = `${pt}px system-ui`;
    ctx.fillStyle = '#eee';
    let visible = 0,
      withArt = 0;
    for (const p of points) {
      const X = x + p.u * w * z,
        Y = y + p.v * h * z;
      if (X + r < 0 || Y + r < 0 || X - r > w || Y - r > h) continue;
      art.draw(ctx, p.art, X, Y, size);
      visible++;
      if (art.has(p.art)) withArt++;
      index.push([X, Y, p]);
    }
    // The opaque native route plate sits below both globe layers. Punch the foreground footprints
    // out of the dim layer; never suppress a whole background globe just because its name won't fit.
    for (const [l, t, width, height] of protectedRects) ctx.clearRect(l, t, width, height);
    canvas.dataset.visible = String(visible);
    canvas.dataset.detailed = String(withArt);
    function nameAt(p, left, Y) {
      const width = p.em * pt,
        pad = Math.max(1, pt * 0.16),
        half = pt * 0.65;
      if (
        left < pad ||
        left + width > w - pad ||
        Y < half ||
        Y > h - half ||
        cells(left - pad, Y - half, left + width + pad, Y + half, false)
      )
        return false;
      cells(left - pad, Y - half, left + width + pad, Y + half, true);
      ctx.fillText(p.name, left, Y);
      return true;
    }
    for (const [X, Y, p] of index)
      if (p === hover) {
        const gap = r + z;
        if (!nameAt(p, X + gap, Y) && !nameAt(p, X - p.em * pt - gap, Y) && !nameAt(p, X - (p.em * pt) / 2, Y - gap - pt * 0.5))
          nameAt(p, X - (p.em * pt) / 2, Y + gap + pt * 0.5);
      }
    for (const [X, Y, p] of index) if (p !== hover) nameAt(p, X + r + z, Y);
  }
  function schedule() {
    if (view && !raf) raf = requestAnimationFrame(draw);
  }
  document.fonts.addEventListener('loadingdone', schedule);
  return {
    openingImages() {
      return art.keep(opening || []);
    },
    library(profiles, images) {
      art.restore(images);
      preload = [...new Set(profiles.flatMap(p => p.sheets || []))];
      canvas.dataset.sheetCount = String(preload.length);
    },
    set(catalog, excluded, positions, names, activeArt) {
      // A slow decode or a selection arriving inside rAF must not leave the previous
      // map's portrait pixels visible beside the incoming owners and names.
      canvas.hidden = front.hidden = true;
      ctx.font = '32px system-ui';
      points = inactiveWorlds(catalog, excluded, positions.length ? names : []);
      for (const p of points) p.em ??= ctx.measureText(p.name).width / 32;
      centers = positions;
      active = activeArt;
      models = [];
      hover = undefined;
      canvas.dataset.inactive = String(points.length);
      const keys = (active || []).map(a => a?.[0]).filter(Boolean);
      if (!opening && keys.length) opening = keys;
      const ready = art.load(keys, true);
      schedule();
      return ready.then(() => {
        if (!view || centers !== positions) return;
        cancelAnimationFrame(raf);
        draw();
        // Give the initially visible globes the disk/decode bandwidth first. Launch the
        // remaining library once, not a new thousand-entry Promise.all on every switch.
        if (preload) {
          const all = preload;
          preload = null;
          art.load([...points.map(p => p.art?.[0]), ...all]).then(() => {
            canvas.dataset.loadedSheets = String(all.filter(s => art.has([s])).length);
          });
        }
      });
    },
    protectModels(bounds) {
      if (!bounds.length && !models.length) return;
      models = bounds;
      schedule();
    },
    move(w, h, x, y, z, frame) {
      view = { w, h, x, y, z };
      hover = undefined;
      // A camera frame already runs in rAF. Draw at its exact pose, not a frame
      // behind the transformed native plate and DOM names.
      if (frame) {
        cancelAnimationFrame(raf);
        draw();
      } else schedule();
    },
    point(x, y) {
      const r = (planetDiameter * (view?.z || 1)) / 2 + 1,
        p = index.find(([X, Y]) => Math.hypot(X - x, Y - y) < r)?.[2];
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
      active = null;
      canvas.dataset.inactive = '0';
      for (const c of [canvas, front]) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    },
    dispose() {
      document.fonts.removeEventListener('loadingdone', schedule);
      art.close();
    }
  };
}
