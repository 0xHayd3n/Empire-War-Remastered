// Visual detail is chosen in display pixels, not map units or distance to the
// command cursor. Use the nearest extent of the object's bounding sphere.
// Carry the previous tier across frames: a slow orbit can't oscillate at a cut.
export function projectedDiameter(radius, depth, height, projectionY, perspective = true) {
  if (depth + radius <= 0) return 0;
  return (radius * height * projectionY) / (perspective ? Math.max(1, depth - radius) : 1);
}
export function landDetailLevel(pixels, previous = 0, high = 96, low = 32) {
  if (pixels > high * (previous === 0 ? 1 : 7 / 6)) return 0;
  return pixels < low * (previous === 2 ? 1.25 : 1) ? 2 : 1;
}
export function worldDiameter(camera, height, x, y, z, radius) {
  const m = camera.matrixWorldInverse.elements;
  return projectedDiameter(
    radius,
    -(m[2] * x + m[6] * y + m[10] * z + m[14]),
    height,
    camera.projectionMatrix.elements[5],
    !camera.isOrthographicCamera
  );
}
