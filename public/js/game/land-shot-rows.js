// A run of projectiles can visit the same crowded spatial buckets hundreds of
// times before anything moves. Copy only XY and a conservative reach, not team,
// alive state, exact geometry or a hit verdict. Preserve original traversal order
// (equal-time strikes are first-wins). Refresh after every impact/callback.
export class LandShotRows {
  constructor() {
    this.buckets = new WeakMap();
    this.epoch = 0;
  }
  reset() {
    ++this.epoch;
  }
  append(list, x, y, step, out) {
    let b = this.buckets.get(list);
    if (!b || b.data.length < list.length * 3) {
      b = { data: new Float64Array(Math.max(24, list.length * 4)), epoch: -1 };
      this.buckets.set(list, b);
    }
    const a = b.data,
      n = list.length;
    if (b.epoch !== this.epoch || b.n !== n) {
      b.epoch = this.epoch;
      b.n = n;
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (let i = 0, j = 0; i < n; i++) {
        const u = list[i];
        a[j++] = u.x;
        a[j++] = u.y;
        // Missing or swapped art must still reach meshOf() to refresh bounds.
        const r = (a[j++] = u.collModel === (u.inst && u.inst.model) ? Math.max(u.hitRadius, u.shotBound || 0) : Infinity);
        x0 = Math.min(x0, u.x - r);
        x1 = Math.max(x1, u.x + r);
        y0 = Math.min(y0, u.y - r);
        y1 = Math.max(y1, u.y + r);
      }
      Object.assign(b, { x0, y0, x1, y1 });
    }
    if (x + step < b.x0 || x - step > b.x1 || y + step < b.y0 || y - step > b.y1) return;
    for (let i = 0, j = 0; i < n; i++) {
      const dx = a[j++] - x,
        dy = a[j++] - y,
        r = a[j++] + step;
      if (!(dx * dx + dy * dy > r * r)) out.push(list[i]);
    }
  }
}
