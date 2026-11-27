import {menuMotion} from './menumotion.js';
import { battlefieldLabels } from './battlefieldlabels.js';
import { laneDetail } from './universalchartdetail.js';
import { chartPose, cameraMotion, relatedMaps, nearlyFramed } from './universalviewmotion.js';
import { planetArt, planetDiameter, labelPixels } from './universalplanetart.js';
import { previewReturn } from './universalpreviewreturn.js';
import { contextWorlds } from './universalcontextworlds.js';
import { planetPool } from './universalplanetpool.js';
import { crest } from './universalcontrols.js';
import { overviewView } from './universalviewcamera.js';

import { galaxyChart, sectorView } from './universalgalaxychart.js';
import { chartPasses, openingFrame, renderPass } from './universalopeningframe.js';
const onReturn = previewReturn();
function save(cache, id, result) {
  cache.set(id, result);
  if (cache.size > 3) {
    const k = cache.keys().next().value;
    cache.get(k).bitmap.close();
    cache.delete(k);
  }
}
export function strategicPreview(host, { selectable = false, showBattlefieldNames = false } = {}) {
  host.insertAdjacentHTML('beforeend', `<div class="uc-map" role="group" aria-label="Starting galaxy map" tabindex="0"><div class="uc-plane"><canvas class="uc-backplate"></canvas><canvas class="uc-planets"></canvas></div><canvas class="uc-route-detail" aria-hidden="true" hidden></canvas><canvas class="uc-context" role="img" aria-label="Other charted worlds, outside this map"></canvas><canvas class="uc-active-globes" aria-hidden="true"></canvas><div class="uc-name-window"><div class="uc-worlds"></div></div></div><span class="uc-context-note" hidden>Gray worlds · outside this map</span><div class="uc-key" aria-label="Faction key"></div>`);
  const map = host.querySelector('.uc-map'),
    plane = host.querySelector('.uc-plane'),
    sky = host.querySelector('.uc-backplate'),
    canvas = host.querySelector('.uc-planets'),
    skyCtx = sky.getContext('2d'),
    ctx = canvas.getContext('2d'),
    front = host.querySelector('.uc-active-globes'),
    labels = host.querySelector('.uc-worlds'),
    key = host.querySelector('.uc-key'),
    named = new Map(),
    plates = new Map(),
    shots = new Map(),
    diameter = selectable ? 3.5 : planetDiameter,
    ghosts = contextWorlds(host.querySelector('.uc-context'), front, labels, diameter),
    pool = planetPool(),
    detail = laneDetail(host.querySelector('.uc-route-detail'));
  let contextKey, contextProjection, library, firstShot, firstPlate, reusableSky;
  let chart,
    selection,
    sceneJob,
    skyJob,
    skyKey,
    skyReady,
    requestKey,
    painted = 0,
    wView = 0,
    hView = 0,
    framed,
    manual = false,
    drag;
  const reduced = menuMotion,
    motion = cameraMotion(move, () => reduced.matches),
    lettering = showBattlefieldNames ? battlefieldLabels(map,reduced) : null;
  const labelHit=e=>{if(!lettering)return;const r=map.getBoundingClientRect();return lettering.hit(e.clientX-r.left,e.clientY-r.top);};
  function reveal(el, opacity, duration) {
    for (const a of el.getAnimations()) a.cancel();
    if (!reduced.matches) el.animate([{ opacity }, { opacity: 1 }], { duration, easing: 'ease-out' });
  }
  function settlePreference() {
    if (reduced.matches) {
      if (selection) motion.set(motion.goal);
      for (const el of [plane, canvas, front]) for (const a of el.getAnimations()) a.cancel();
      for (const a of labels.getAnimations({ subtree: true })) a.cancel();
    }
  }
  reduced.addEventListener('change', settlePreference);
  let labelZoom, labelWidth, labelHeight, refit;
  function sizeLabels(z) {
    labelZoom = z; labelWidth = wView; labelHeight = hView;
    labels.style.width = wView * z + 'px';
    labels.style.height = hView * z + 'px';
    labels.style.setProperty('--planet-size', labelPixels(z) + 'px');
    labels.style.setProperty('--name-gap', (diameter / 2 + 1) * z + 'px');
    labels.style.setProperty('--name-ring', (diameter + 2.5) * z + 'px');
  }
  function move({ z, x, y }, frame) {
    const X = x * wView,
      Y = y * hView;
    map.toggleAttribute('data-zoomed', z > 1);
    map.toggleAttribute('data-moving', motion.moving);
    plane.style.transform = `translate(${X}px,${Y}px) scale(${z})`;
    // Same chart coordinates, but lay out glyphs at their final screen size rather
    // than magnifying a ~1px font and rerasterizing it throughout a close zoom.
    // Move the tactical hit targets together, not 1,000 percentage-positioned
    // boxes and pseudo-elements per wheel tick. Refit crisp text when settled.
    if (wView !== labelWidth || hView !== labelHeight || (!selectable && z !== labelZoom)) sizeLabels(z);
    clearTimeout(refit);
    if (selectable && z !== labelZoom && !motion.moving) {
      // Reduced-motion cameras snap immediately. Coalesce their stationary
      // refit too, rather than doing it once per trackpad event.
      refit = setTimeout(() => {
        sizeLabels(z);
        labels.style.transform = `translate(${X}px,${Y}px)`;
      }, 90);
    }
    labels.style.transform = `translate(${X}px,${Y}px) scale(${z / labelZoom})`;
    detail.move(motion.pose, motion.goal, motion.moving || !!drag);
    ghosts.move(wView, hView, X, Y, z, frame);
    lettering?.move(wView,hView,X,Y,z);
  }
  function scale(f, u, v) {
    if (!selection || selection.onlySky) return;
    manual = true;
    motion.zoom(f, u, v);
  }
  map.onwheel = e => {
    e.preventDefault();
    const r = map.getBoundingClientRect();
    // Pixel-mode trackpads deliver many small deltas; a wheel notch is about 120px.
    const delta = Math.max(-240, Math.min(240, e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1)));
    scale(1.18 ** (-delta / 120), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  map.onpointerdown = e => {
    if (selectable && (e.target.closest('[data-planet]') || labelHit(e))) return;
    if (motion.pose.z > 1 && e.button === 0 && e.isPrimary && !selection?.onlySky) {
      motion.stop();
      map.removeAttribute('data-moving');
      manual = true;
      ghosts.point(-100, -100);
      drag = [e.clientX - motion.pose.x * wView, e.clientY - motion.pose.y * hView, e.pointerId];
      map.setPointerCapture(e.pointerId);
    }
  };
  map.onpointermove = e => {
    if (!drag && !selection?.onlySky) {
      const r = map.getBoundingClientRect();
      ghosts.point(e.clientX - r.left, e.clientY - r.top);
      lettering?.hover(e.target.closest('[data-planet]')?.dataset.planet || lettering.hit(e.clientX-r.left,e.clientY-r.top));
    }
    if (drag?.[2] === e.pointerId) {
      motion.set(chartPose(motion.pose.z, (e.clientX - drag[0]) / wView, (e.clientY - drag[1]) / hView));
    }
  };
  map.onpointerleave = () => { ghosts.point(-100, -100); lettering?.hover(null); };
  map.onlostpointercapture = () => (drag = null);
  map.ondblclick = e => {
    if (!selection || selection.onlySky) return;
    const r = map.getBoundingClientRect(),
      el = e.target.closest('[data-planet]');
    const pose = motion.pose,
      u = el ? parseFloat(el.style.left) / 100 : ((e.clientX - r.left) / r.width - pose.x) / pose.z,
      v = el ? parseFloat(el.style.top) / 100 : ((e.clientY - r.top) / r.height - pose.y) / pose.z,
      z = Math.min(8, motion.goal.z * 1.8);
    manual = true;
    motion.set(chartPose(z, 0.5 - z * u, 0.5 - z * v), 210);
  };
  map.onkeydown = e => {
    if (e.key === 'Home') {
      manual = true;
      motion.set(chartPose(), 190);
    } else if (['+', '=', '-'].includes(e.key)) scale(e.key === '-' ? 1 / 1.18 : 1.18, 0.5, 0.5);
    else return;
    e.preventDefault();
  };
  function stopScene() {
    detail.clear();
    sceneJob?.abort();
    sceneJob = null;
  }
  function clear() {
    clearTimeout(refit);
    stopScene();
    skyJob?.abort();
    pool.close();
    motion.stop();
    framed = null;
    manual = false;
    for (const el of [plane, canvas, front]) for (const a of el.getAnimations()) a.cancel();
    map.removeAttribute('data-moving');
    map.removeAttribute('data-zoomed');
    delete host.dataset.sectorZoom;
    ghosts.clear();
    selection = skyJob = skyReady = skyKey = requestKey = null;
    named.clear();
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
    if (!selection || !map.clientWidth || !map.clientHeight) return;
    const { p, m, worlds, variant, onlySky } = selection,
      w = map.clientWidth,
      h = map.clientHeight,
      { W, H, view, backdrop, query } = chartPasses(chart, p, m, worlds, w, h),
      ref = chart.reference,
      plateId = [ref.id, ref.revision, w, h, W, H].join(':'),
      id = [p.id, p.revision, variant.map, plateId, onlySky].join(':');
    const mount = p.sheets && p.laneKit ? 'resolved-lanes:' + plateId : [p.id, p.revision, plateId].join(':');
    if (!onlySky && !firstShot) {
      firstShot = id;
      firstPlate = plateId;
    }
    pool.retain(mount);
    if (requestKey === id) return;
    requestKey = id;
    stopScene();
    const sector = sectorView(onlySky ? [] : view.labels);
    wView = w;
    hView = h;
    const fit = chartPose(sector.zoom, 0.5 - sector.zoom * sector.u, 0.5 - sector.zoom * sector.v);
    const keep = framed && (framed === selection ? manual : selection.related && (manual || nearlyFramed(motion.goal, fit)));
    if (keep) move(motion.pose, false);
    else {
      manual = false;
      motion.set(fit, framed ? 230 : 0);
      move(motion.pose, false);
    }
    framed = selection;
    host.dataset.sectorZoom = String(sector.zoom);
    const sprites = !!p.sheets;
    // A warm sky can be submitted immediately. Let the renderer process native lanes
    // in parallel with label layout, form updates and drawing this map's portraits.
    const opening = openingFrame(library), sized = opening?.w === w && opening.h === h;
    const readyPlate = plates.get(plateId) || (sized && opening.plate);
    const shot = shots.get(id) || (!onlySky && sized && opening.p === p && opening.index === variant.map && opening.shot);
    // The tactical index already draws its selectable portraits on the front
    // canvas. With no owner rings or trade routes there is no second GL pass.
    const portraitsOnly = selectable && sprites && !p.overlay.ring && !m.routes.length;
    let pending, renderLanes, signal;
    if (!portraitsOnly && !onlySky && !shot) {
      sceneJob = new AbortController();
      signal = sceneJob.signal;
      renderLanes = async backplate => {
        signal.throwIfAborted();
        if (chart.sky.length && !backplate) throw Error('Native backdrop unavailable');
        return pool.request(mount, query(backplate), signal);
      };
      if (readyPlate && selection.continuing) pending = renderLanes(readyPlate.bitmap);
    }
    if (!selectable && contextKey !== plateId) {
      const projected = overviewView(
        chart.catalog.map(e => e.planet),
        ref.camera,
        w,
        h,
        chart.frame
      ).labels;
      contextProjection = chart.catalog.map(({ id, planet, profile }, i) => ({
        art: planetArt(profile, planet),
        id,
        name: planet[1] || planet[0],
        u: projected[i][0],
        v: projected[i][1]
      }));
      contextKey = plateId;
    }
    const activeArt = onlySky ? [] : worlds.map(world => planetArt(p, world));
    lettering?.set(m.worlds.map(([i])=>p.planets[i][0]),worlds.map(w=>w[1]||w[0]),view.labels);
    const portraitsReady = ghosts.set(
      selectable ? [] : contextProjection,
      new Set(onlySky || selectable ? [] : m.worlds.map(([i]) => chart.world(p, i).id)),
      onlySky ? [] : view.labels,
      worlds.map(p => p[1] || p[0]),
      sprites ? activeArt : null
    );
    if (!onlySky && selection.transition && !selection.related && !shot) {
      const incoming = selection;
      portraitsReady.then(() => {
        if (selection === incoming && requestKey === id) reveal(front, 0.72, 100);
      });
    }
    host.querySelector('.uc-context-note').hidden = onlySky;
    if (!onlySky)
      view.labels.forEach(([u, v], i) => {
        labels.children[i].style.left = u * 100 + '%';
        labels.children[i].style.top = v * 100 + '%';
      });
    labels.style.setProperty('--planet-type', JSON.stringify(p.overlay.font));

    if (plateId !== skyKey) {
      skyJob?.abort();
      skyKey = plateId;
      skyJob = new AbortController();
      const signal = skyJob.signal;
      sky.width = W;
      sky.height = H;
      const display = result => {
        skyCtx.drawImage(result.bitmap, 0, 0);
        if (selection?.transition && !shot) reveal(plane, 0, 160);
        return result.bitmap;
      };
      skyReady = readyPlate
        ? Promise.resolve(display(readyPlate))
        : !chart.sky.length
          ? Promise.resolve(null)
          : (reusableSky && !portraitsOnly ? (q, s) => pool.request(mount, { ...q, keepSkyContext: true }, s) : renderPass)(
              backdrop,
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
    if (!portraitsOnly) {
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      } else ctx.clearRect(0, 0, W, H);
    }
    delete host.dataset.models;
    delete host.dataset.routes;
    delete host.dataset.reused;
    const paint = result => {
      ctx.drawImage(result.bitmap, 0, 0);
      // Same opaque sky on both canvases. Only this selection's routes/rings
      // dissolve in; never blend two maps' topology, owners or labels together.
      if (selection.transition) reveal(canvas, 0.36, 125);
      ghosts.protectModels(result.bounds);
      host.dataset.scene = 'loading';
      const exact = selection;
      portraitsReady.then(() => {
        if (selection === exact && requestKey === id) host.dataset.scene = 'native';
      });
      host.dataset.models = String(result.placed);
      host.dataset.reused = String(result.reused);
      host.dataset.routes = String(result.routes);
      if (sprites && result.routes) {
        const plate = readyPlate?.bitmap || plates.get(plateId)?.bitmap;
        if (plate || !chart.sky.length) {
          // An opaque crop must not jump ahead of the incoming map's sky/lane fade.
          // Render during the dissolve; reveal after it. Cancellation still closes stale bitmaps.
          const faded = Promise.allSettled([...plane.getAnimations(), ...canvas.getAnimations()].map(a => a.finished));
          detail.set(
            async (crop, s) => {
              const image = await pool.request(mount, query(plate, crop), s);
              await faded;
              return image;
            },
            w,
            h,
            Math.max(1, Math.min(W / w, H / h) / Math.min(devicePixelRatio || 1, 2))
          );
          detail.move(motion.pose, motion.goal, motion.moving);
        }
      }
    };
    if (onlySky) {
      host.dataset.scene = 'backdrop';
      return;
    }
    if (portraitsOnly) {
      const exact = selection;
      host.dataset.routes = host.dataset.models = host.dataset.reused = '0';
      host.dataset.scene = 'loading';
      Promise.all([skyReady, portraitsReady]).then(([plate]) => {
        if (selection === exact && requestKey === id) host.dataset.scene = plate || !chart.sky.length ? 'native' : 'unavailable';
      });
      return;
    }
    if (shot) {
      paint(shot);
      return;
    }
    host.dataset.scene = 'loading';
    // A restored still has no live worker. Don't synchronously clone its whole sky on
    // the first input's UI task. Continuing maps above already have a warm renderer.
    const ready = skyReady;
    (pending || (readyPlate ? new Promise(resolve => setTimeout(() => resolve(ready), 0)) : ready).then(renderLanes))
      .then(result => {
        if (signal.aborted) {
          result.bitmap.close();
          return;
        }
        save(shots, id, result);
        paint(result);
      })
      .catch(e => {
        if (!signal.aborted) {
          console.warn('Galaxy preview:', e.message);
          host.dataset.scene = 'unavailable';
        }
      });
  }
  const observer = new ResizeObserver(layout);
  observer.observe(map);
  return {
    clear,
    labelHit,
    mark: id=>lettering?.select(id),
    locate(id) {
      const el = [...named.values()].find(node => node.dataset.planet === id);
      if (!el || !el.style.left) return;
      const z = Math.max(motion.pose.z, 2.4);
      manual = true;
      motion.set(chartPose(z, 0.5 - z * parseFloat(el.style.left) / 100, 0.5 - z * parseFloat(el.style.top) / 100), 200);
    },
    setLibrary(profiles) {
      library = profiles;
      reusableSky = profiles.every(p => p.sheets && p.laneKit);
      const prev = onReturn.take(profiles);
      const opening = openingFrame(profiles);
      chart = opening?.chart || prev?.chart || galaxyChart(profiles);
      if (prev?.plate) plates.set(...prev.plate);
      if (prev?.plate || opening?.plate) host.dataset.backdropRenders = '0';
      if (prev?.shot) shots.set(...prev.shot);
      ghosts.library(profiles, opening?.images || prev?.images);
      contextKey = null;
    },
    dispose(remember = false) {
      if (remember && library) {
        const take = (c, k) => {
          const value = c.get(k);
          if (value) {
            c.delete(k);
            return [k, value];
          }
        };
        onReturn.put({
          profiles: library,
          chart,
          plate: take(plates, firstPlate),
          shot: take(shots, firstShot),
          images: ghosts.openingImages()
        });
      } else onReturn.clear();
      clear();
      observer.disconnect();
      reduced.removeEventListener('change', settlePreference);
      ghosts.dispose();
      lettering?.close();
      for (const c of [shots, plates]) {
        for (const r of c.values()) r.bitmap.close();
        c.clear();
      }
    },
    show(p, variant, onlySky = false, family) {
      const m = p.maps[variant.map],
        worlds = m.worlds.map(([i]) => chart.world(p, i).placed);
      if (!worlds.length) {
        clear();
        return;
      }
      if (selection?.p !== p) {
        labels.replaceChildren();
        named.clear();
      }
      const continuing = selection?.p === p && !selection.onlySky;
      const related = continuing && !onlySky && ((family && selection.family === family) || relatedMaps(selection.m.worlds, m.worlds));
      selection = { p, m, worlds, variant, onlySky, continuing, related, family, transition: !!selection };
      requestKey = null;
      drag = null;
      const live = new Set(onlySky ? [] : m.worlds.map(([i]) => i));
      for (const [i, el] of named)
        if (!live.has(i)) {
          el.remove();
          named.delete(i);
        }
      let nextLabel = labels.firstElementChild;
      key.replaceChildren();
      const counts = new Map();
      if (!onlySky)
        for (const [i, o] of m.worlds) {
          const planet = p.planets[i],
            fact = p.facts[o];
          let el = named.get(i);
          if (!el) {
            el = document.createElement('span');
            named.set(i, el);
            el.dataset.planet = planet[0];
            el.textContent = planet[1] || planet[0];
            if (selection.transition && !selectable && !reduced.matches) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 145, easing: 'ease-out' });
          }
          if (el.dataset.owner !== (o || '')) {
            el.dataset.owner = o || '';
            el.style.setProperty('--owner', fact?.color || '#bbb');
            if (fact?.ink?.length === 3) el.style.setProperty('--ink', `rgb(${fact.ink.join(',')})`);
            else el.style.removeProperty('--ink');
            el.title =
              el.textContent +
              ' — ' +
              (fact?.label || o || 'Unclaimed') +
              (chart.world(p, i).uncharted ? ' · Uncharted setup location' : '') +
              (p.sheets && !planet[9] ? ' · No visible surface in source model' : '');
          }
          if (el !== nextLabel) labels.insertBefore(el, nextLabel);
          nextLabel = el.nextElementSibling;
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
