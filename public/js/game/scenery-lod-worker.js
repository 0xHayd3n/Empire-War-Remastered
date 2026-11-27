// Build retained prop LODs off the render thread. The same index-only simplifier
// also serves small, already-authenticated foliage assets during map load.
import { landIndexLod, skinLocks } from './land-index-lod.js';
self.onmessage = async ({ data: { index, position, uv, skinIndex, skinWeight, scenery } }) => {
  try {
    const lock = skinLocks(index, skinIndex, skinWeight);
    const levels = [
      await landIndexLod(index, position, uv, 0.52, scenery ? 0.025 : 0.012, lock),
      await landIndexLod(index, position, uv, 0.2, scenery ? 0.065 : 0.028, lock)
    ];
    self.postMessage(
      levels,
      levels.filter(Boolean).map(a => a.buffer)
    );
  } catch {
    self.postMessage([null, null]);
  }
};
