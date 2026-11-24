// Preview-only camera. Translation is measured in viewport widths/heights so resize,
// hit-testing and every map layer share a pose. Interpolation between bounded poses
// is itself bounded, including when a wheel gesture is reversed halfway through.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function chartPose(z = 1, x = 0, y = 0) {
  z = clamp(z, 1, 8);
  return { z, x: clamp(x, 1 - z, 0), y: clamp(y, 1 - z, 0) };
}
export function cameraMotion(paint, reduced) {
  let pose = chartPose(),
    goal = pose,
    raf = 0,
    from,
    start,
    last,
    ms;
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    goal = pose;
  }
  function frame(now) {
    last = now;
    const t = clamp((now - start) / ms, 0, 1),
      f = 1 - (1 - t) ** 3;
    pose = t === 1 ? goal : chartPose(from.z + (goal.z - from.z) * f, from.x + (goal.x - from.x) * f, from.y + (goal.y - from.y) * f);
    raf = t < 1 ? requestAnimationFrame(frame) : 0;
    paint(pose, true);
  }
  function set(next, duration = 0) {
    if (!duration || reduced() || ['x', 'y', 'z'].every(k => Math.abs(pose[k] - next[k]) < 1e-6)) {
      stop();
      goal = pose = next;
      paint(pose, false);
      return;
    }
    // Retarget the scheduled frame instead of cancelling it. A stream of small
    // trackpad deltas must keep moving even if several arrive between paints.
    start = raf ? last : performance.now();
    last = start;
    from = pose;
    goal = next;
    ms = duration;
    if (!raf) raf = requestAnimationFrame(frame);
  }
  return {
    get moving() {
      return !!raf;
    },
    get pose() {
      return pose;
    },
    get goal() {
      return goal;
    },
    set,
    stop,
    zoom(f, u, v) {
      const z = clamp(goal.z * f, 1, 8);
      set(chartPose(z, u - ((u - pose.x) * z) / pose.z, v - ((v - pose.y) * z) / pose.z), 165);
    }
  };
}
// Keep the reader's zoom/pan across nearby dates. A different region still gets a
// fitted view, rather than inheriting a close-up that contains none of its planets.
export function relatedMaps(previous, next) {
  if (!previous?.length || !next.length) return false;
  const ids = new Set(previous.map(([i]) => i));
  return next.reduce((n, [i]) => n + Number(ids.has(i)), 0) >= 0.6 * Math.max(ids.size, next.length);
}
export function nearlyFramed(a, b) {
  return Math.abs(a.z / b.z - 1) < 0.025 && Math.abs(a.x - b.x) < 0.025 && Math.abs(a.y - b.y) < 0.025;
}
