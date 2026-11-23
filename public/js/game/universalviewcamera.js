// Same Z-up, fixed horizontal lens and zero-yaw overview as GalacticGame.placeCamera.
// Only the pullback differs: fit the authored locations, not the human player's home world.
export function overviewView(points, settings, w, h) {
  const tan = (Math.tan(Math.atan(0.5) / 2) * h) / w,
    a = (-settings.pitch * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a),
    zs = settings.plane;
  const xs = points.map(p => p[2]),
    ys = points.map(p => p[3]),
    x = (Math.min(...xs) + Math.max(...xs)) / 2 || 0,
    y = (Math.min(...ys) + Math.max(...ys)) / 2 || 0;
  const parts = points.map(p => {
    const dy = p[3] - y,
      dz = p[4] - zs;
    return [p[2] - x, s * dy + c * dz, -c * dy + s * dz];
  });
  const pull = Math.max(160, ...parts.map(([u, v, d]) => d + Math.max(Math.abs(u) / ((tan * w) / h), Math.abs(v) / tan) * 1.13));
  return {
    fov: (2 * Math.atan(tan) * 180) / Math.PI,
    eye: [x, y - c * pull, zs + s * pull],
    target: [x, y, zs],
    labels: parts.map(([u, v, d]) => [0.5 + u / (pull - d) / ((2 * tan * w) / h), 0.5 - v / (pull - d) / (2 * tan)])
  };
}
