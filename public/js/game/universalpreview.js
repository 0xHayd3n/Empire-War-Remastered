import { overviewView } from './universalviewcamera.js';

// Only paint a still of the chosen preset. For a quick selection change the new names/owners
// appear immediately; late results never repaint a different campaign's map.
export function strategicPreview(host) {
  host.innerHTML = `<div class="uc-map" role="group" aria-label="Starting galaxy map" tabindex="0"><div class="uc-plane"><canvas></canvas><div class="uc-worlds"></div></div></div><div class="uc-key" aria-label="Faction key"></div>`;
  const map = host.querySelector('.uc-map'),
    plane = host.querySelector('.uc-plane'),
    canvas = host.querySelector('canvas'),
    ctx = canvas.getContext('2d'),
    labels = host.querySelector('.uc-worlds'),
    key = host.querySelector('.uc-key');
  let selection,
    worker,
    timer,
    sequence = 0,
    zoom = 1,
    x = 0,
    y = 0,
    drag,
    cache = new Map(),
    requestKey = '';
  const move = () => (plane.style.transform = `translate(${x}px,${y}px) scale(${zoom})`);
  function scale(f, px, py) {
    const z = Math.min(5, Math.max(1, zoom * f));
    x = px - ((px - x) * z) / zoom;
    y = py - ((py - y) * z) / zoom;
    zoom = z;
    if (z === 1) x = y = 0;
    move();
  }
  map.onwheel = e => {
    e.preventDefault();
    const r = map.getBoundingClientRect();
    scale(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top);
  };
  map.onpointerdown = e => {
    if (e.button === 0) {
      drag = [e.clientX - x, e.clientY - y];
      map.setPointerCapture(e.pointerId);
    }
  };
  map.onpointermove = e => {
    if (drag) {
      x = e.clientX - drag[0];
      y = e.clientY - drag[1];
      move();
    }
  };
  map.onlostpointercapture = () => (drag = null);
  map.onkeydown = e => {
    if (e.key === 'Home') {
      zoom = 1;
      x = y = 0;
      move();
    } else if (['+', '=', '-'].includes(e.key)) scale(e.key === '-' ? 1 / 1.18 : 1.18, map.clientWidth / 2, map.clientHeight / 2);
    else return;
    e.preventDefault();
  };
  function stop() {
    sequence++;
    clearTimeout(timer);
    worker?.terminate();
    worker = null;
  }
  function clear() {
    stop();
    selection = null;
    requestKey = '';
    labels.replaceChildren();
    key.replaceChildren();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    delete host.dataset.scene;
  }
  function layout() {
    if (!selection || !map.clientWidth || !map.clientHeight) return;
    const { p, m, worlds, variant } = selection,
      w = map.clientWidth,
      h = map.clientHeight,
      view = overviewView(worlds, p.camera, w, h),
      id = [p.id, p.revision, variant.map, w, h].join(':');
    labels.style.setProperty('--planet-type', JSON.stringify(p.overlay.font));
    labels.style.setProperty('--planet-size', Math.max(8, p.overlay.pt * 1.6 * Math.min(w / 1024, h / 768)) + 'px');
    if (requestKey === id) return;
    stop();
    requestKey = id;
    const gen = sequence;
    view.labels.forEach(([u, v], i) => {
      const el = labels.children[i];
      el.style.left = u * 100 + '%';
      el.style.top = v * 100 + '%';
    });
    const factor = Math.min(devicePixelRatio || 1, 1.5, 1600 / w, 1400 / h);
    canvas.width = Math.max(1, Math.round(w * factor));
    canvas.height = Math.max(1, Math.round(h * factor));
    function paint(pic) {
      ctx.drawImage(pic, 0, 0, canvas.width, canvas.height);
      host.dataset.scene = 'native';
    }
    if (cache.has(id)) {
      paint(cache.get(id));
      return;
    }
    host.dataset.scene = 'loading';
    timer = setTimeout(() => {
      try {
        worker = new Worker(new URL('./universalviewworker.js', import.meta.url), { type: 'module' });
        const failed = e => {
          if (gen !== sequence) return;
          console.warn('Galaxy preview:', e.message);
          host.dataset.scene = 'unavailable';
          stop();
        };
        worker.onerror = failed;
        worker.onmessage = ({ data }) => {
          if (gen !== sequence) {
            data.bitmap?.close();
            return;
          }
          if (data.error) {
            failed(new Error(data.error));
            return;
          }
          paint(data.bitmap);
          cache.set(id, data.bitmap);
          if (cache.size > 3) {
            const k = cache.keys().next().value;
            cache.get(k).close();
            cache.delete(k);
          }
          host.dataset.models = String(data.placed);
          stop();
        };
        worker.postMessage({
          profile: p.id,
          revision: p.revision,
          w: canvas.width,
          h: canvas.height,
          worlds,
          overlay: p.overlay,
          colors: m.worlds.map(([, o]) => p.facts[o]?.color || '#bbb'),
          scenery: m.scenery.map(i => p.planets[i]),
          routes: m.routes,
          looks: p.looks,
          camera: p.camera
        });
      } catch (e) {
        host.dataset.scene = 'unavailable';
        stop();
      }
    }, 180);
  }
  const observer = new ResizeObserver(layout);
  observer.observe(map);
  return {
    clear,
    dispose() {
      clear();
      observer.disconnect();
      for (const pic of cache.values()) pic.close();
      cache.clear();
    },
    show(p, variant) {
      clear();
      const m = p.maps[variant.map],
        worlds = m.worlds.map(([i]) => p.planets[i]);
      if (!worlds.length) return;
      selection = { p, m, worlds, variant };
      zoom = 1;
      x = y = 0;
      move();
      const counts = new Map();
      for (const [i, o] of m.worlds) {
        const planet = p.planets[i],
          fact = p.facts[o],
          el = document.createElement('span');
        el.dataset.planet = planet[0];
        el.dataset.owner = o || '';
        el.style.setProperty('--owner', fact?.color || '#bbb');
        if (fact?.ink?.length === 3) el.style.setProperty('--ink', `rgb(${fact.ink.join(',')})`);
        el.textContent = planet[1] || planet[0];
        el.title = el.textContent + ' — ' + (fact?.label || o || 'Unclaimed');
        labels.append(el);
        counts.set(o, (counts.get(o) || 0) + 1);
      }
      for (const [o, n] of [...counts].sort((a, b) => b[1] - a[1])) {
        const chip = document.createElement('span');
        chip.style.setProperty('--owner', p.facts[o]?.color || '#bbb');
        chip.textContent = (p.facts[o]?.label || o || 'Unclaimed') + ' · ' + n;
        key.append(chip);
      }
      layout();
    }
  };
}
