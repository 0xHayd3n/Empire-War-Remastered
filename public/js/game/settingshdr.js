import { gfx, storeGfx } from '../gfx.js';
import { hdrDefaults, hdrDisplay, calibration, configureExtended, createHDRPass } from '../hdr.js';
import { wantGPU } from '../gpu/env.js';
import { el, action } from './commandui.js';
import { group, select, slider } from './settingsfields.js';

export function hdrFields(page, game, signal) {
  const output = group(page, 'High dynamic range'),
    status = el('p', 'us-help'),
    cal = group(page, 'Display calibration'),
    pattern = el('canvas', 'us-hdr-pattern'),
    guide = el(
      'p',
      'us-help',
      'Left: keep the darkest steps just distinguishable. Middle: set a comfortable white. Right: the two highlights should remain distinct.'
    );
  status.setAttribute('role', 'status');
  pattern.width = 600;
  pattern.height = 42;
  pattern.setAttribute('role', 'img');
  pattern.setAttribute('aria-label', 'HDR reference patches: shadows, paper white and highlights');
  page.classList.add('us-hdr');
  select(
    output,
    'HDR output',
    [
      ['off', 'Off · SDR'],
      ['auto', 'Auto · HDR']
    ],
    gfx.hdrMode === 'auto' ? 'auto' : 'off',
    v => {
      gfx.hdrMode = v;
      storeGfx();
      refresh();
    }
  );
  output.append(status);
  const fields = [
    ['hdrPaper', 'Paper white', 80, 300, 1, v => `${v} nits`],
    ['hdrPeak', 'Peak brightness', 400, 4000, 10, v => `${v} nits`],
    ['hdrShadows', 'Shadow detail', -1, 1, 0.05, v => `${v > 0 ? '+' : ''}${v.toFixed(2)}`]
  ];
  const controls = fields.map(([key, label, min, max, step, format]) =>
    slider(
      cal,
      label,
      calibration(gfx)[key],
      min,
      max,
      step,
      v => {
        gfx[key] = v;
        storeGfx();
        draw();
      },
      format
    )
  );
  cal.append(
    el('p', 'us-help', 'Match peak brightness to your display’s HDR rating. Nits are targets relative to the system’s reference white.')
  );
  cal.append(pattern, guide);
  action(
    cal,
    'Reset calibration',
    () => {
      for (const [i, [key]] of fields.entries()) {
        controls[i].value = hdrDefaults[key];
        controls[i].dispatchEvent(new Event('input'));
      }
    },
    'us-secondary'
  );

  let device,
    context,
    pass,
    attempt = 0,
    probing = false,
    failed = false;
  const renderer = game.gpuOn ? game.gpu : game.renderer?.renderer || game.renderer;
  function draw() {
    if (!pass || signal.aborted || page.hidden) return;
    const enc = device.createCommandEncoder();
    pass.draw(enc, context.getCurrentTexture().createView(), null, gfx);
    device.queue.submit([enc.finish()]);
  }
  function release() {
    attempt++;
    probing = failed = false;
    pass?.dispose();
    context?.unconfigure();
    device?.destroy();
    pass = context = device = null;
  }
  async function probe() {
    const ticket = ++attempt;
    probing = true;
    try {
      const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (ticket !== attempt) return;
      if (!a?.features.has('texture-compression-bc')) throw Error(); // Same adapter requirement as gameplay.
      const d = await a.requestDevice();
      if (ticket !== attempt) {
        d.destroy();
        return;
      }
      device = d;
      context = pattern.getContext('webgpu');
      if (!configureExtended(context, device)) throw Error();
      pass = createHDRPass(device, true);
      d.lost.then(() => {
        if (device !== d) return;
        release();
        failed = true;
        refresh();
      });
    } catch {
      if (ticket !== attempt) return;
      release();
      failed = true;
    }
    probing = false;
    refresh();
  }
  function refresh() {
    const on = gfx.hdrMode === 'auto',
      state = renderer?.domElement?.dataset.hdrOutput,
      eligible = on && hdrDisplay?.matches && wantGPU() && (!renderer || !!renderer.device) && state !== 'unsupported';
    cal.disabled = !on;
    if ((page.hidden || !eligible) && (pass || probing || failed)) release();
    if (!page.hidden && eligible && !pass && !probing && !failed) void probe();
    pattern.hidden = guide.hidden = !(eligible && pass);
    status.textContent = !on
      ? 'SDR output. Enable Auto to calibrate HDR.'
      : !hdrDisplay?.matches
        ? 'SDR output. This window does not report an HDR display. Enable HDR in the operating system or move the window to an HDR display.'
        : !eligible || failed
          ? 'SDR fallback. HDR needs a compatible WebGPU renderer and extended-range canvas.'
          : !pass
            ? 'Checking HDR output…'
            : state === 'extended'
              ? 'HDR active · WebGPU. Menus remain in SDR.'
              : 'HDR ready for WebGPU gameplay. Menus remain in SDR.';
    if (!pattern.hidden) draw();
  }
  const observer = new MutationObserver(refresh);
  observer.observe(page, { attributes: true, attributeFilter: ['hidden'] });
  hdrDisplay?.addEventListener('change', refresh, { signal });
  document.addEventListener('hdroutputchange', refresh, { signal });
  signal.addEventListener(
    'abort',
    () => {
      observer.disconnect();
      release();
    },
    { once: true }
  );
  refresh();
}
