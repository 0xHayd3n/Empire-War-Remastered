// Strategic chart, not a second galaxy: only static starting positions, control and authored trade routes.
const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}
export function strategicPreview(host) {
  const map = svg('svg', { viewBox: '0 0 820 640', 'aria-label': 'Starting galaxy map', role: 'group', tabindex: 0 }),
    legend = document.createElement('div'),
    readout = document.createElement('div'),
    bar = document.createElement('div');
  map.classList.add('uc-starmap');
  legend.className = 'uc-map-key';
  bar.className = 'uc-map-tools';
  readout.className = 'uc-map-readout';
  host.append(map, bar, readout, legend);
  let scale = 1,
    dx = 0,
    dy = 0,
    layer,
    drag = null,
    labels = [];
  function transform() {
    if (!layer) return;
    layer.setAttribute('transform', `translate(${dx} ${dy}) scale(${scale})`);
    const taken = [];
    for (const { el, x, y, name } of labels) {
      const w = Math.min(160, name.length * 5.7),
        sx = x * scale,
        sy = y * scale;
      el.setAttribute('font-size', 11 / scale);
      el.setAttribute('x', x + 6 / scale);
      el.setAttribute('y', y + 3 / scale);
      const clash = taken.some(b => Math.abs(sy - b.y) < 12 && sx < b.x + b.w && b.x < sx + w);
      el.style.opacity = clash ? '0' : '1';
      if (!clash) taken.push({ x: sx, y: sy, w });
    }
  }
  function zoom(f, x = 410, y = 320) {
    const z = Math.max(1, Math.min(8, scale * f));
    dx = x - ((x - dx) * z) / scale;
    dy = y - ((y - dy) * z) / scale;
    scale = z;
    if (z === 1) dx = dy = 0;
    transform();
  }
  for (const [s, title, fn] of [
    ['−', 'Zoom out', () => zoom(1 / 1.4)],
    ['+', 'Zoom in', () => zoom(1.4)],
    [
      'Fit',
      'Fit map',
      () => {
        scale = 1;
        dx = dy = 0;
        transform();
      }
    ]
  ]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s;
    b.setAttribute('aria-label', title);
    b.onclick = fn;
    bar.append(b);
  }
  function xy(e) {
    const p = map.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(map.getScreenCTM().inverse());
  }
  map.onwheel = e => {
    e.preventDefault();
    const p = xy(e);
    zoom(e.deltaY < 0 ? 1.22 : 1 / 1.22, p.x, p.y);
  };
  map.onpointerdown = e => {
    const p = xy(e);
    drag = [p.x - dx, p.y - dy];
    map.setPointerCapture(e.pointerId);
  };
  map.onpointermove = e => {
    if (drag) {
      const p = xy(e);
      dx = p.x - drag[0];
      dy = p.y - drag[1];
      transform();
    }
  };
  map.onpointerup = map.onpointercancel = () => (drag = null);
  return {
    clear() {
      layer = null;
      labels = [];
      map.replaceChildren();
      legend.replaceChildren();
      readout.textContent = 'No campaign map available.';
    },
    show(profile, variant) {
      scale = 1;
      dx = dy = 0;
      labels = [];
      const data = profile.maps[variant.map],
        worlds = data.worlds.map(([i, owner]) => ({ p: profile.planets[i], owner }));
      legend.replaceChildren();
      map.replaceChildren();
      layer = svg('g');
      map.append(layer);
      const hint = `${worlds.length} planets · ${data.routes.length} trade routes`;
      readout.textContent = hint;
      if (!worlds.length) {
        readout.textContent = 'No authored planet positions';
        return;
      }
      const xs = worlds.map(w => w.p[2]),
        ys = worlds.map(w => w.p[3]),
        x0 = Math.min(...xs),
        x1 = Math.max(...xs),
        y0 = Math.min(...ys),
        y1 = Math.max(...ys),
        s = Math.min(730 / Math.max(1, x1 - x0), 550 / Math.max(1, y1 - y0));
      for (const w of worlds) {
        w.x = 410 + (w.p[2] - (x0 + x1) / 2) * s;
        w.y = 320 - (w.p[3] - (y0 + y1) / 2) * s;
      }
      let lines = '';
      for (const [a, b] of data.routes) {
        const u = worlds[a],
          v = worlds[b];
        if (u && v) lines += `M${u.x},${u.y}L${v.x},${v.y}`;
      }
      layer.append(
        svg('path', {
          d: lines,
          fill: 'none',
          stroke: '#80b6c4',
          'stroke-width': 0.85,
          opacity: 0.53,
          'vector-effect': 'non-scaling-stroke'
        })
      );
      const counts = new Map();
      for (const { p, owner, x, y } of worlds) {
        const f = profile.facts[owner],
          color = f?.color || '#909ba2',
          name = p[1] || p[0],
          side = f?.label || owner || 'Unclaimed',
          g = svg('g', { tabindex: 0, role: 'img', 'aria-label': `${name} — ${side}`, 'data-planet': p[0], 'data-owner': owner || '' });
        g.append(
          svg('title', {}, `${name} — ${side}`),
          svg('circle', { cx: x, cy: y, r: 6.8, fill: color, opacity: 0.19 }),
          svg('circle', { cx: x, cy: y, r: 3.3, fill: color, stroke: '#cedde4', 'stroke-width': 0.7 }),
          svg('circle', { cx: x - 1, cy: y - 1, r: 1.1, fill: '#fff', opacity: 0.6 })
        );
        const txt = svg('text', { class: 'uc-star-name' }, name);
        g.append(txt);
        labels.push({ el: txt, x, y, name });
        const inspect = () => {
          readout.textContent = name + ' · ' + side;
        };
        g.onmouseenter = g.onfocus = inspect;
        g.onmouseleave = g.onblur = () => {
          readout.textContent = hint;
        };
        layer.append(g);
        counts.set(owner, (counts.get(owner) || 0) + 1);
      }
      for (const [owner, n] of [...counts].sort((a, b) => b[1] - a[1])) {
        const f = profile.facts[owner],
          chip = document.createElement('span');
        chip.style.setProperty('--owner', f?.color || '#909ba2');
        chip.textContent = (f?.label || owner || 'Unclaimed') + ' · ' + n;
        legend.append(chip);
      }
      transform();
    }
  };
}
