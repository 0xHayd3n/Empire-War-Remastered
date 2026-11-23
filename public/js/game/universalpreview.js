// A chart of the authored starting state, not a galaxy simulation. World coordinates never depend on the skin.
const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}
export function strategicPreview(host) {
  host.innerHTML = `<div class="uc-chart-bounds" aria-hidden="true"></div><div class="uc-chart-hud"><div class="uc-map-tools" role="group" aria-label="Map controls"></div><details class="uc-owners"><summary>Faction key</summary><div class="uc-map-key"></div></details><span class="uc-map-readout"></span></div>`;
  const bounds = host.querySelector('.uc-chart-bounds'),
    bar = host.querySelector('.uc-map-tools'),
    readout = host.querySelector('.uc-map-readout'),
    legend = host.querySelector('.uc-map-key');
  const map = svg('svg', { class: 'uc-starmap', 'aria-label': 'Starting galaxy map', role: 'group', tabindex: 0 }),
    guides = svg('g', { class: 'uc-guides', 'aria-hidden': 'true' }),
    layer = svg('g');
  host.prepend(map);
  const camera = svg('g');
  camera.append(guides, layer);
  map.append(camera);
  let zoom = 1,
    panX = 0,
    panY = 0,
    drag = null,
    worlds = [],
    routes = [],
    lane = null,
    extent = null,
    frame;
  // Dragging changes one transform; only fitting/zooming recomputes paths and label collisions.
  function pan() {
    camera.setAttribute('transform', `translate(${panX} ${panY})`);
  }
  // The SVG always covers the viewport. Fit into the visible area instead of clipping the chart to a panel.
  function layout() {
    const w = map.clientWidth,
      h = map.clientHeight;
    if (!w || !h) return;
    map.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const b = { x: bounds.offsetLeft, y: bounds.offsetTop, w: bounds.clientWidth, h: bounds.clientHeight };
    frame = { cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
    if (!extent) return;
    const size = Math.min(Math.max(1, b.w - 62) / extent.w, Math.max(1, b.h - 28) / extent.h);
    pan();
    const { cx, cy } = frame;
    guides.setAttribute('transform', `translate(${cx} ${cy}) scale(${(Math.max(1, Math.min(b.w, b.h)) / 600) * zoom})`);
    const taken = [];
    for (const a of worlds) {
      a.x = cx + (a.wx - extent.cx) * size * zoom;
      a.y = cy - (a.wy - extent.cy) * size * zoom;
      a.g.setAttribute('transform', `translate(${a.x} ${a.y})`);
      const width = Math.min(220, a.name.length * 6.4 + 7);
      const left = a.x + panX + 9 + width > b.x + b.w && a.x + panX - 9 - width >= b.x;
      const x = left ? a.x - 9 - width : a.x + 9;
      a.text.setAttribute('x', left ? -9 : 9);
      a.text.setAttribute('text-anchor', left ? 'end' : 'start');
      const clash = taken.some(o => Math.abs(a.y - o.y) < 15 && x < o.x + o.w && o.x < x + width);
      a.text.classList.toggle('uc-label-muted', clash);
      if (!clash) taken.push({ x, y: a.y, w: width });
    }
    lane.setAttribute('d', routes.map(([i, j]) => `M${worlds[i].x} ${worlds[i].y}L${worlds[j].x} ${worlds[j].y}`).join(''));
  }
  function setZoom(f, x = frame?.cx, y = frame?.cy) {
    if (!extent || !frame) return;
    const z = Math.max(1, Math.min(10, zoom * f));
    panX = x - frame.cx - ((x - frame.cx - panX) * z) / zoom;
    panY = y - frame.cy - ((y - frame.cy - panY) * z) / zoom;
    zoom = z;
    if (z === 1) panX = panY = 0;
    layout();
  }
  function fit() {
    zoom = 1;
    panX = panY = 0;
    layout();
  }
  for (const [label, name, fn] of [
    ['−', 'Zoom out', () => setZoom(1 / 1.4)],
    ['+', 'Zoom in', () => setZoom(1.4)],
    ['Fit', 'Fit map', fit]
  ]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-label', name);
    b.onclick = fn;
    bar.append(b);
  }
  for (const r of [125, 225, 300]) guides.append(svg('circle', { r }));
  guides.append(svg('path', { d: 'M-324 0h30 M294 0h30 M0 -324v30 M0 294v30' }));
  map.onwheel = e => {
    e.preventDefault();
    const rect = map.getBoundingClientRect();
    setZoom(e.deltaY < 0 ? 1.22 : 1 / 1.22, e.clientX - rect.left, e.clientY - rect.top);
  };
  map.onpointerdown = e => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX - panX, y: e.clientY - panY };
    map.setPointerCapture(e.pointerId);
  };
  map.onpointermove = e => {
    if (drag?.id !== e.pointerId) return;
    panX = e.clientX - drag.x;
    panY = e.clientY - drag.y;
    pan();
  };
  map.onlostpointercapture = () => (drag = null);
  map.onkeydown = e => {
    if (e.key === '+' || e.key === '=') setZoom(1.4);
    else if (e.key === '-') setZoom(1 / 1.4);
    else if (e.key === 'Home') fit();
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      panX += e.key === 'ArrowLeft' ? 42 : e.key === 'ArrowRight' ? -42 : 0;
      panY += e.key === 'ArrowUp' ? 42 : e.key === 'ArrowDown' ? -42 : 0;
      pan();
    } else return;
    e.preventDefault();
  };
  const obs = new ResizeObserver(layout);
  obs.observe(bounds);
  obs.observe(map);
  function clear() {
    extent = null;
    worlds = [];
    routes = [];
    lane = null;
    layer.replaceChildren();
    legend.replaceChildren();
    guides.style.display = 'none';
    readout.textContent = 'No campaign map available';
  }
  return {
    clear,
    dispose: () => obs.disconnect(),
    show(profile, variant) {
      clear();
      const data = profile.maps[variant.map],
        counts = new Map();
      if (!data.worlds.length) return;
      guides.style.display = '';
      lane = svg('path', { class: 'uc-trade-lanes' });
      layer.append(lane);
      const hint = `${data.worlds.length} worlds  /  ${data.routes.length} trade routes`;
      readout.textContent = hint;
      for (const [i, owner] of data.worlds) {
        const p = profile.planets[i],
          f = profile.facts[owner],
          name = p[1] || p[0],
          side = f?.label || owner || 'Unclaimed';
        const g = svg('g', { tabindex: 0, role: 'img', 'aria-label': `${name} — ${side}`, 'data-planet': p[0], 'data-owner': owner || '' });
        g.style.setProperty('--owner', f?.color || '#939aa0');
        const text = svg('text', { class: 'uc-star-name', x: 9, y: 4 }, name);
        g.append(
          svg('title', {}, `${name} — ${side}`),
          svg('circle', { r: 7, class: 'uc-world-corona' }),
          svg('circle', { r: 3.4, class: 'uc-world-disc' }),
          text
        );
        g.onmouseenter = g.onfocus = () => {
          readout.textContent = `${name}  /  ${side}`;
        };
        g.onmouseleave = g.onblur = () => {
          readout.textContent = hint;
        };
        worlds.push({ wx: p[2], wy: p[3], name, g, text });
        layer.append(g);
        counts.set(owner, (counts.get(owner) || 0) + 1);
      }
      routes = data.routes.filter(([a, b]) => worlds[a] && worlds[b]);
      const xs = worlds.map(a => a.wx),
        ys = worlds.map(a => a.wy),
        x0 = Math.min(...xs),
        x1 = Math.max(...xs),
        y0 = Math.min(...ys),
        y1 = Math.max(...ys);
      extent = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
      for (const [owner, n] of [...counts].sort((a, b) => b[1] - a[1])) {
        const f = profile.facts[owner],
          chip = document.createElement('span'),
          count = document.createElement('b');
        chip.style.setProperty('--owner', f?.color || '#939aa0');
        chip.textContent = f?.label || owner || 'Unclaimed';
        count.textContent = n;
        chip.append(count);
        legend.append(chip);
      }
      fit();
    }
  };
}
