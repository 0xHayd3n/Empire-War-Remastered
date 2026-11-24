// Presentation units at whole-galaxy fit, shared by every era. Both labels and
// portraits follow the camera's actual zoom; never feed these back into gameplay.
export const tileSize = 128,
  sheetColumns = 4,
  planetDiameter = 6,
  nameSize = 4.5,
  contextNameSize = 3.75;
export function planetArt(profile, world) {
  const cell = world[9];
  return cell && profile.sheets?.[cell[0]] ? [profile.sheets[cell[0]], cell[1]] : null;
}
export function portraitBank(repaint) {
  const pages = new Map(),
    pending = new Set();
  let running = 0,
    closed = false;
  function pump() {
    while (!closed && running < 4 && pending.size) {
      const key = pending.values().next().value;
      pending.delete(key);
      const row = pages.get(key);
      running++;
      const img = new Image();
      img.src = '/api/universal/portraits/' + key + '.png';
      img
        .decode()
        .then(
          () => {
            if (!closed) row.img = img;
          },
          () => {}
        )
        .finally(() => {
          row.resolve();
          running--;
          if (!closed) {
            repaint();
            pump();
          }
        });
    }
  }
  function load(keys, priority = false) {
    const rows = [];
    for (const key of new Set(keys.filter(Boolean))) {
      let row = pages.get(key);
      if (!row) {
        let resolve;
        const ready = new Promise(r => (resolve = r));
        row = { ready, resolve };
        pages.set(key, row);
        pending.add(key);
      }
      rows.push(row);
    }
    if (priority) {
      const rest = [...pending];
      pending.clear();
      for (const key of keys) if (rest.includes(key)) pending.add(key);
      for (const k of rest) pending.add(k);
    }
    pump();
    return Promise.all(rows.map(r => r.ready));
  }
  // The fallback is only for a missing/unsupported source model or the first few frames of decode.
  const orb = document.createElement('canvas');
  orb.width = orb.height = 96;
  const c = orb.getContext('2d'),
    g = c.createRadialGradient(29, 25, 3, 51, 52, 51);
  g.addColorStop(0, '#e7ebed');
  g.addColorStop(0.48, '#a2a8ae');
  g.addColorStop(0.85, '#424850');
  g.addColorStop(1, '#252a31');
  c.fillStyle = g;
  c.beginPath();
  c.arc(48, 48, 46, 0, Math.PI * 2);
  c.fill();
  return {
    load,
    has(a) {
      return !!(a && pages.get(a[0])?.img);
    },
    draw(ctx, a, x, y, size) {
      const img = a && pages.get(a[0])?.img;
      if (img)
        ctx.drawImage(
          img,
          (a[1] % sheetColumns) * tileSize,
          Math.floor(a[1] / sheetColumns) * tileSize,
          tileSize,
          tileSize,
          x - size / 2,
          y - size / 2,
          size,
          size
        );
      else ctx.drawImage(orb, x - size / 2, y - size / 2, size, size);
    },
    close() {
      closed = true;
      for (const r of pages.values()) r.resolve();
      pages.clear();
      pending.clear();
    }
  };
}
