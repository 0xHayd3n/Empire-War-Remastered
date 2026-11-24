import { contextWorlds } from './universalcontextworlds.js';
import { planetPool } from './universalplanetpool.js';
import { crest } from './universalcontrols.js';
import { overviewView } from './universalviewcamera.js';

import { galaxyChart, sectorView } from './universalgalaxychart.js';
function renderPass(query, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./universalviewworker.js', import.meta.url), { type: 'module' });
    const clean = () => {
      worker.terminate();
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      clean();
      reject(signal.reason);
    };
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => {
      clean();
      if (data.error) reject(Error(data.error));
      else resolve(data);
    };
    worker.onerror = e => {
      clean();
      reject(Error(e.message));
    };
    try {
      worker.postMessage(query);
    } catch (e) {
      clean();
      reject(e);
    }
  });
}
function save(cache, id, result) {
  cache.set(id, result);
  if (cache.size > 3) {
    const k = cache.keys().next().value;
    cache.get(k).bitmap.close();
    cache.delete(k);
  }
}
export function strategicPreview(host) {
  host.innerHTML = `<div class="uc-map" role="group" aria-label="Starting galaxy map" tabindex="0"><div class="uc-plane"><canvas class="uc-backplate"></canvas><canvas class="uc-planets"></canvas></div><canvas class="uc-context" role="img" aria-label="Other charted worlds, outside this map"></canvas><div class="uc-worlds"></div></div><span class="uc-context-note">Gray worlds · outside this map</span><div class="uc-key" aria-label="Faction key"></div>`;
  const map = host.querySelector('.uc-map'),
    plane = host.querySelector('.uc-plane'),
    sky = host.querySelector('.uc-backplate'),
    canvas = host.querySelector('.uc-planets'),
    skyCtx = sky.getContext('2d'),
    ctx = canvas.getContext('2d'),
    labels = host.querySelector('.uc-worlds'),
    key = host.querySelector('.uc-key'),
    plates = new Map(),
    shots = new Map(),
    ghosts = contextWorlds(host.querySelector('.uc-context'), labels),
    pool = planetPool();
  let contextKey, contextProjection;
  let chart,
    selection,
    timer,
    sceneJob,
    skyJob,
    skyKey,
    skyReady,
    requestKey,
    painted = 0,
    zoom = 1,
    x = 0,
    y = 0,
    drag;
  function move() {
    x = Math.min(0, Math.max(map.clientWidth * (1 - zoom), x));
    y = Math.min(0, Math.max(map.clientHeight * (1 - zoom), y));
    map.toggleAttribute('data-zoomed', zoom > 1);
    ghosts.move(map.clientWidth, map.clientHeight, x, y, zoom);
    labels.style.setProperty('--label-scale', 1 / zoom);
    labels.style.transform = plane.style.transform = `translate(${x}px,${y}px) scale(${zoom})`;
  }
  function scale(f, px, py) {
    if (!selection || selection.onlySky) return;
    const z = Math.min(8, Math.max(1, zoom * f));
    x = px - ((px - x) * z) / zoom;
    y = py - ((py - y) * z) / zoom;
    zoom = z;
    move();
  }
  map.onwheel = e => {
    e.preventDefault();
    const r = map.getBoundingClientRect();
    scale(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top);
  };
  map.onpointerdown = e => {
    if (zoom > 1 && e.button === 0 && e.isPrimary) {
      drag = [e.clientX - x, e.clientY - y, e.pointerId];
      map.setPointerCapture(e.pointerId);
    }
  };
  map.onpointermove = e => {
    if (!drag && !selection?.onlySky) {
      const r = map.getBoundingClientRect();
      ghosts.point(e.clientX - r.left, e.clientY - r.top);
    }
    if (drag?.[2] === e.pointerId) {
      x = e.clientX - drag[0];
      y = e.clientY - drag[1];
      move();
    }
  };
  map.onpointerleave = () => ghosts.point(-100, -100);
  map.onlostpointercapture = () => (drag = null);
  map.ondblclick = e => {
    if (!selection || selection.onlySky) return;
    const r = map.getBoundingClientRect(),
      el = e.target.closest('[data-planet]');
    const u = el ? parseFloat(el.style.left) / 100 : (e.clientX - r.left - x) / (r.width * zoom),
      v = el ? parseFloat(el.style.top) / 100 : (e.clientY - r.top - y) / (r.height * zoom);
    zoom = Math.min(8, zoom * 1.8);
    x = r.width * (0.5 - u * zoom);
    y = r.height * (0.5 - v * zoom);
    move();
  };
  map.onkeydown = e => {
    if (e.key === 'Home') {
      zoom = 1;
      x = y = 0;
      move();
    } else if (['+', '=', '-'].includes(e.key)) scale(e.key === '-' ? 1 / 1.18 : 1.18, map.clientWidth / 2, map.clientHeight / 2);
    else return;
    e.preventDefault();
  };
  function stopScene() {
    clearTimeout(timer);
    sceneJob?.abort();
    sceneJob = null;
  }
  function clear() {
    stopScene();
    skyJob?.abort();
    pool.close();
    ghosts.clear();
    selection = skyJob = skyReady = skyKey = requestKey = null;
    labels.replaceChildren();
    key.replaceChildren();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    skyCtx.clearRect(0, 0, sky.width, sky.height);
    host.querySelector('.uc-context-note').hidden = true;
    delete host.dataset.scene;
    delete host.dataset.models;
    delete host.dataset.reused;
    delete host.dataset.routes;
  }
  function layout() {
    move();
    if (!selection || !map.clientWidth || !map.clientHeight) return;
    const { p, m, worlds, variant, onlySky } = selection,
      w = map.clientWidth,
      h = map.clientHeight,
      factor = Math.min(2, 2560 / w, 2048 / h),
      W = Math.max(1, Math.round(w * factor)),
      H = Math.max(1, Math.round(h * factor)),
      ref = chart.reference,
      plateId = [ref.id, ref.revision, w, h, W, H].join(':'),
      id = [p.id, p.revision, variant.map, plateId, onlySky].join(':');
    const mount = [p.id, p.revision, plateId].join(':');
    pool.retain(mount);
    if (requestKey === id) return;
    requestKey = id;
    stopScene();
    const view = overviewView(worlds, ref.camera, w, h, chart.frame),
      base = { profile: p.id, revision: p.revision, w: W, h: H, camera: p.camera, view },
      sector = sectorView(onlySky ? [] : view.labels);
    zoom = sector.zoom;
    x = w * (0.5 - zoom * sector.u);
    y = h * (0.5 - zoom * sector.v);
    move();
    host.dataset.sectorZoom = String(zoom);
    if (contextKey !== plateId) {
      const projected = overviewView(
        chart.catalog.map(e => e.planet),
        ref.camera,
        w,
        h,
        chart.frame
      ).labels;
      contextProjection = chart.catalog.map(({ id, planet }, i) => ({
        id,
        name: planet[1] || planet[0],
        u: projected[i][0],
        v: projected[i][1]
      }));
      contextKey = plateId;
    }
    ghosts.set(
      contextProjection,
      new Set(onlySky ? [] : m.worlds.map(([i]) => chart.world(p, i).id)),
      onlySky ? [] : view.labels,
      worlds.map(p => p[1] || p[0])
    );
    host.querySelector('.uc-context-note').hidden = onlySky;
    if (!onlySky)
      view.labels.forEach(([u, v], i) => {
        labels.children[i].style.left = u * 100 + '%';
        labels.children[i].style.top = v * 100 + '%';
      });
    labels.style.setProperty('--planet-type', JSON.stringify(p.overlay.font));
    labels.style.setProperty('--planet-size', Math.max(8, Math.min(12, p.overlay.pt * 1.6 * Math.min(w / 1024, h / 768))) + 'px');
    if (plateId !== skyKey) {
      skyJob?.abort();
      skyKey = plateId;
      skyJob = new AbortController();
      const signal = skyJob.signal;
      sky.width = W;
      sky.height = H;
      const display = result => {
        skyCtx.drawImage(result.bitmap, 0, 0);
        return result.bitmap;
      };
      skyReady = plates.has(plateId)
        ? Promise.resolve(display(plates.get(plateId)))
        : !chart.sky.length
          ? Promise.resolve(null)
          : renderPass(
              { ...base, profile: ref.id, revision: ref.revision, camera: ref.camera, pass: 'backdrop', worlds: [], scenery: chart.sky },
              signal
            )
              .then(result => {
                if (signal.aborted) {
                  result.bitmap.close();
                  return null;
                }
                save(plates, plateId, result);
                host.dataset.backdropRenders = String(++painted);
                return display(result);
              })
              .catch(e => {
                if (!signal.aborted) {
                  console.warn('Galaxy backdrop:', e.message);
                  skyKey = null;
                }
                return null;
              });
    }
    // Leave the plate on screen between maps; never leave the previous planets or owners over it.
    canvas.width = W;
    canvas.height = H;
    delete host.dataset.models;
    const paint = result => {
      ctx.drawImage(result.bitmap, 0, 0);
      ghosts.protectModels(result.bounds);
      host.dataset.scene = 'native';
      host.dataset.models = String(result.placed);
      host.dataset.reused = String(result.reused);
      host.dataset.routes = String(result.routes);
    };
    if (onlySky) {
      host.dataset.scene = 'backdrop';
      return;
    }
    if (shots.has(id)) {
      paint(shots.get(id));
      return;
    }
    sceneJob = new AbortController();
    const signal = sceneJob.signal,
      ready = skyReady;
    host.dataset.scene = 'loading';
    timer = setTimeout(async () => {
      try {
        const backplate = await ready;
        signal.throwIfAborted();
        if (chart.sky.length && !backplate) throw Error('Native backdrop unavailable');
        const result = await pool.request(
          mount,
          {
            ...base,
            pass: 'worlds',
            worlds,
            backplate,
            overlay: p.overlay,
            colors: m.worlds.map(([, o]) => p.facts[o]?.color || '#bbb'),
            scenery: [],
            routes: m.routes,
            looks: p.looks
          },
          signal
        );
        if (signal.aborted) {
          result.bitmap.close();
          return;
        }
        save(shots, id, result);
        paint(result);
      } catch (e) {
        if (!signal.aborted) {
          console.warn('Galaxy preview:', e.message);
          host.dataset.scene = 'unavailable';
        }
      }
    }, 32);
  }
  const observer = new ResizeObserver(layout);
  observer.observe(map);
  return {
    clear,
    setLibrary(profiles) {
      chart = galaxyChart(profiles);
      contextKey = null;
    },
    dispose() {
      clear();
      observer.disconnect();
      ghosts.dispose();
      for (const c of [shots, plates]) {
        for (const r of c.values()) r.bitmap.close();
        c.clear();
      }
    },
    show(p, variant, onlySky = false) {
      const m = p.maps[variant.map],
        worlds = m.worlds.map(([i]) => chart.world(p, i).placed);
      if (!worlds.length) {
        clear();
        return;
      }
      selection = { p, m, worlds, variant, onlySky };
      requestKey = null;
      zoom = 1;
      x = y = 0;
      drag = null;
      labels.replaceChildren();
      key.replaceChildren();
      const counts = new Map();
      if (!onlySky)
        for (const [i, o] of m.worlds) {
          const planet = p.planets[i],
            fact = p.facts[o],
            el = document.createElement('span');
          el.dataset.planet = planet[0];
          el.dataset.owner = o || '';
          el.style.setProperty('--owner', fact?.color || '#bbb');
          if (fact?.ink?.length === 3) el.style.setProperty('--ink', `rgb(${fact.ink.join(',')})`);
          el.textContent = planet[1] || planet[0];
          el.title =
            el.textContent + ' — ' + (fact?.label || o || 'Unclaimed') + (chart.world(p, i).uncharted ? ' · Uncharted setup location' : '');
          labels.append(el);
          counts.set(o, (counts.get(o) || 0) + 1);
        }
      for (const [o, n] of [...counts].sort((a, b) => b[1] - a[1])) {
        const chip = document.createElement('span');
        chip.style.setProperty('--owner', p.facts[o]?.color || '#bbb');
        const name = p.facts[o]?.label || o || 'Unclaimed';
        chip.dataset.owner = o || '';
        chip.append(crest(p.facts[o], name, true), name + ' · ' + n);
        key.append(chip);
      }
      layout();
    }
  };
}
