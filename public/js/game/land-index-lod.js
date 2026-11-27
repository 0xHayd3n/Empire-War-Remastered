// Build one index-only LOD at asset load (or in the scenery worker), never in the draw loop.
// Keep the original vertex streams, UV seams and material. If simplifying is not safe or
// supported, the caller continues to draw the supplied mesh rather than dropping the object.
import { MeshoptSimplifier as simplify } from '../../vendor/meshoptimizer/meshopt_simplifier.js';
// Freeze every mixed-weight joint and both sides of each change of rigid bone.
// Rigid interiors can simplify; vertices shaping animated bends cannot collapse.
export function skinLocks(index, joints, weights) {
  if (!joints && !weights) return null;
  if (!joints || !weights || joints.length !== weights.length || joints.length % 4) throw Error('Invalid skin');
  const bone = new Int32Array(joints.length / 4).fill(-1),
    lock = new Uint8Array(bone.length);
  for (let i = 0; i < bone.length; i++) {
    for (let j = i * 4; j < i * 4 + 4; j++)
      if (weights[j] > 0) {
        if (bone[i] !== -1 && bone[i] !== joints[j]) lock[i] = 1;
        bone[i] = joints[j];
      }
    if (bone[i] === -1) lock[i] = 1;
  }
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i],
      b = index[i + 1],
      c = index[i + 2];
    if (bone[a] !== bone[b] || bone[a] !== bone[c]) lock[a] = lock[b] = lock[c] = 1;
  }
  return lock;
}
export async function landIndexLod(index, position, uv, fraction, error, lock = null) {
  await simplify.ready;
  const goal = 3 * Math.max(4, Math.floor((index.length / 3) * fraction));
  const [result] =
    uv || lock
      ? simplify.simplifyWithAttributes(
          index,
          position,
          3,
          uv || new Float32Array(0),
          uv ? 2 : 0,
          uv ? [0.12, 0.12] : [],
          lock,
          goal,
          error,
          lock ? [] : ['Permissive']
        )
      : simplify.simplify(index, position, 3, goal, error);
  return result.length >= 12 && result.length < index.length * 0.9 ? result : null;
}
