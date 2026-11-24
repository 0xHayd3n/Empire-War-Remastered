// Use the real context painter with a deterministic crowded spot. The normal (right)
// label is blocked; hovering reveals it on the left. Sample only the text's ink.
module.exports = map =>
  map.evaluate(async host => {
    const { contextWorlds } = await import('./js/game/universalcontextworlds.js');
    const root = document.createElement('div');
    root.style.cssText = 'position:absolute;inset:0 auto auto 0;width:320px;height:120px;pointer-events:none';
    host.append(root);
    root.innerHTML = '<canvas></canvas><canvas></canvas><div><span></span></div>';
    const [c, fg, labels] = root.children;
    for (const el of root.children) el.style.cssText = 'position:absolute;inset:0;width:320px;height:120px';
    labels.firstChild.style.cssText = 'position:absolute;left:169px;top:49px;width:80px;height:22px';
    const painter = contextWorlds(c, fg, labels);
    const frame = () => new Promise(requestAnimationFrame);
    function ink() {
      const d = c.width / 320,
        bytes = c.getContext('2d').getImageData(0, Math.round(42 * d), Math.round(147 * d), Math.round(36 * d)).data;
      let sum = 0;
      for (let i = 3; i < bytes.length; i += 4) sum += bytes[i];
      return sum;
    }
    async function sample(ms, move = false) {
      const values = [],
        start = performance.now();
      do {
        await frame();
        if (move) painter.move(320, 120, -1, 0, 3, true);
        values.push(ink());
      } while (performance.now() - start < ms);
      return values;
    }
    try {
      painter.move(320, 120, 0, 0, 3);
      await painter.set([{ id: 'test', name: 'Neighboring system', u: 158 / 960, v: 60 / 360 }], new Set(), [], [], []);
      await sample(200);
      const initial = ink();
      painter.point(158, 60);
      const up = await sample(360);
      const steady = await sample(100, true);
      painter.point(-100, -100);
      const down = await sample(360);
      return { initial, up, steady, down };
    } finally {
      painter.clear();
      painter.dispose();
      root.remove();
    }
  });
