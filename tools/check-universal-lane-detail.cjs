// A fixed native worker fixture so changing skies or source texture softness cannot
// be mistaken for raster resolution. Compare a zoomed overview against redrawn geometry.
module.exports = async function checkLaneDetail(map) {
  return map.evaluate(async () => {
    const w = 384,
      h = 288,
      worker = new Worker('./js/game/universalviewworker.js', { type: 'module' });
    const plate = new OffscreenCanvas(w, h),
      g = plate.getContext('2d');
    g.fillStyle = '#101820';
    g.fillRect(0, 0, w, h);
    // An asymmetric sky control outside the route verifies the crop's UV origin.
    g.fillStyle = '#204057';
    g.fillRect(0, 0, w, h * 0.48);
    const sky = plate.transferToImageBitmap(),
      q = {
        pass: 'lanes',
        laneKit: {},
        w,
        h,
        worlds: [
          ['A', 'A', -50, -22, 0],
          ['B', 'B', 50, 22, 0]
        ],
        routes: [[0, 1, 0]],
        looks: [{ mode: 'OPAQUE', width: 2, texture: 'white', out: [1, 1, 1, 1] }],
        view: { fov: 50, eye: [0, -200, 200], target: [0, 0, 0] },
        colors: ['#fff', '#fff']
      };
    function send(props) {
      return new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => (data.error ? reject(Error(data.error)) : resolve(data));
        worker.onerror = e => reject(Error(e.message));
        worker.postMessage({ ...q, ...props });
      });
    }
    let overview, hd;
    try {
      const crop = { x: -3.46, y: -3.52, z: 8 };
      overview = await send({ backplate: sky });
      hd = await send({ crop });
      const c = new OffscreenCanvas(w, h),
        ctx = c.getContext('2d', { willReadFrequently: true });
      const read = () => ctx.getImageData(0, 0, w, h).data;
      ctx.drawImage(overview.bitmap, crop.x * w, crop.y * h, w * crop.z, h * crop.z);
      const old = read();
      ctx.drawImage(hd.bitmap, 0, 0);
      const fine = read();
      function stats(p) {
        let soft = 0,
          core = 0;
        const centers = [];
        for (let x = 0; x < w; x++) {
          let sum = 0,
            height = 0;
          for (let y = 0; y < h; y++) {
            const v = p[(y * w + x) * 4];
            if (v > 62 && v < 211) soft++;
            if (v > 100) {
              core++;
              sum += y;
              height++;
            }
          }
          if (height) centers[x] = sum / height;
        }
        return { soft, core, centers };
      }
      const a = stats(old),
        b = stats(fine);
      let both = 0,
        drift = 0;
      for (let x = 0; x < w; x++)
        if (Number.isFinite(a.centers[x]) && Number.isFinite(b.centers[x])) {
          both++;
          drift += Math.abs(a.centers[x] - b.centers[x]);
        }
      let bgChecks = 0;
      for (const x of [4, w - 5])
        for (const y of [4, h - 5]) {
          const i = (y * w + x) * 4;
          if ([0, 1, 2].every(k => Math.abs(old[i + k] - fine[i + k]) <= 1)) bgChecks++;
        }
      return {
        scaledSoft: a.soft,
        redrawnSoft: b.soft,
        redrawnInk: b.core,
        columns: both,
        centerError: drift / both,
        bgChecks,
        routes: hd.routes
      };
    } finally {
      worker.terminate();
      sky.close();
      overview?.bitmap.close();
      hd?.bitmap.close();
    }
  });
};
