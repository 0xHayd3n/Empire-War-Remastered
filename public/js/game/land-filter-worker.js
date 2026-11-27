// No renderer, game state or canvas in this worker. Return the identical byte atlas.
import { filterFinishAtlas } from '../finishatlas.js';
self.onmessage = ({ data: { pixels, size } }) => {
  const atlas = filterFinishAtlas(pixels, size);
  self.postMessage(atlas, [atlas.buffer]);
};
