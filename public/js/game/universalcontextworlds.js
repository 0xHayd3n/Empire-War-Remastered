import { contextNames } from './universalcontextnames.js';
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
    art = portraitBank(schedule),
    names = contextNames(),
    reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let points = [],
    centers = [],
    active = null,
    preload,
    opening,
    models = [],
    index = [],
    raf = 0,
    hover,
    pointer,
    view;
  function hovered() {
    if (!pointer || !view) return;
    const r = (planetDiameter * view.z) / 2 + 1,
      [x, y] = pointer;
    let best,
      dist = r * r;
    for (const [X, Y, p] of index) {
      const d = (X - x) ** 2 + (Y - y) ** 2;
      if (p === hover && d < (r + 2) ** 2) return p;
      if (d < dist) {
        dist = d;
        best = p;
      }
    }
    return best;
  }
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
    const protectedRects = [];
    function protect(l, t, r, b) {
      if (r < 0 || b < 0 || l > w || t > h) return;
      protectedRects.push([l, t, r - l, b - t]);
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
    hover = hovered();
    const fading = names.paint(ctx, index, hover, protectedRects, w, h, r + z, pt, reduced.matches);
    canvas.toggleAttribute('data-names-fading', fading);
    if (fading) schedule();
    // Mask last: even a departing, partially visible name yields to active ink.
    for (const [l, t, width, height] of protectedRects) ctx.clearRect(l, t, width, height);
    canvas.dataset.visible = String(visible);
    canvas.dataset.detailed = String(withArt);
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
      // Re-hit-test the last pointer against the new pose inside draw().
      // A camera frame already runs in rAF. Draw at its exact pose, not a frame
      // behind the transformed native plate and DOM names.
      if (frame) {
        cancelAnimationFrame(raf);
        draw();
      } else schedule();
    },
    point(x, y) {
      pointer = x < 0 || y < 0 ? null : [x, y];
      const p = hovered();
      if (hover !== p) {
        hover = p;
        schedule();
      }
    },
    clear() {
      cancelAnimationFrame(raf);
      raf = 0;
      names.clear();
      canvas.removeAttribute('data-names-fading');
      view = hover = pointer = undefined;
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
