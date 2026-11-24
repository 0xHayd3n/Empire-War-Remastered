// Only the atlas backdrop. These are mesh names in the installed galaxy model, not
// route styles or gameplay objects. meshByName disambiguates duplicate keys; each
// group's .name is the original ALO name (all three EAWX region_lines must go).
export function omitRegionBorders(inst, file, profile) {
  if (!/(?:^|[\\/])w_galaxy00\.alo$/i.test(file)) return;
  for (const group of inst.meshByName.values()) {
    if (/^(?:region_lines|rings)$/i.test(group.name) || (['1397421866', '3387971722'].includes(profile) && /^object01$/i.test(group.name)))
      group.visible = false;
  }
}

// Keep one viewport-sized high-resolution crop. It stays anchored to chart coordinates
// while moving; the ordinary full chart fills any newly exposed area. Never stretch a
// viewport-sized buffer to the full *zoomed* map or retain detail across selections.
export function laneDetail(canvas) {
  const ctx = canvas.getContext('bitmaprenderer');
  let render, pose, patch, job, timer, desired, w, h, threshold;
  function place() {
    if (!patch || !pose) return;
    const s = pose.z / patch.z;
    canvas.style.transform = `translate(${(pose.x - patch.x * s) * w}px,${(pose.y - patch.y * s) * h}px) scale(${s})`;
  }
  function cancel() {
    clearTimeout(timer);
    job?.abort();
    job = null;
    desired = null;
    canvas.removeAttribute('data-refining');
  }
  function clear() {
    cancel();
    render = null;
    if (patch) {
      canvas.hidden = true;
      ctx.transferFromImageBitmap(null);
      patch = null;
    }
  }
  function aim(target, moving) {
    if (!render || !ctx) return;
    if (target.z <= threshold) {
      cancel();
      if (patch && pose.z <= threshold) {
        canvas.hidden = true;
        patch = null;
        ctx.transferFromImageBitmap(null);
      }
      return;
    }
    if (desired && desired.z === target.z && desired.x === target.x && desired.y === target.y) return;
    cancel();
    desired = target;
    canvas.setAttribute('data-refining', '');
    const run = async () => {
      const controller = new AbortController();
      job = controller;
      try {
        const result = await render(target, controller.signal);
        if (controller.signal.aborted) {
          result.bitmap.close();
          return;
        }
        if (canvas.width !== result.bitmap.width) canvas.width = result.bitmap.width;
        if (canvas.height !== result.bitmap.height) canvas.height = result.bitmap.height;
        ctx.transferFromImageBitmap(result.bitmap);
        patch = target;
        place();
        canvas.hidden = false;
      } catch (e) {
        if (!controller.signal.aborted) {
          desired = null;
          console.warn('Galaxy lane detail:', e.message);
        }
      } finally {
        if (job === controller) {
          job = null;
          canvas.removeAttribute('data-refining');
        }
      }
    };
    // Coalesce trackpad and drag input. Only the latest offscreen draw is accepted.
    timer = setTimeout(run, moving ? 48 : 0);
  }
  return {
    clear,
    set(fn, W, H, minimum) {
      clear();
      render = fn;
      w = W;
      h = H;
      threshold = minimum;
    },
    move(current, target, moving) {
      pose = current;
      place();
      aim(target, moving);
    }
  };
}
