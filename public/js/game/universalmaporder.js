// Sorting is presentation only. Capture each section's authored sibling order
// before the movable starting-variant row is inserted. Never sort launch data.
export function mapOrder(head, branchRow, tabStop) {
  const columns = ['Map', 'Mod', 'Planets'],
    collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }),
    keys = new WeakMap(),
    sections = new Map();
  let column = -1,
    dir = 0,
    dirty = false;
  const headers = columns.map((title, i) => {
    const th = document.createElement('th'),
      b = document.createElement('button');
    th.scope = 'col';
    b.type = 'button';
    b.textContent = title;
    b.title =
      title === 'Planets'
        ? 'Sort by planet count (minimum, then maximum). Red: under 50 · Amber: 50–99 · Green: 100+'
        : 'Sort by ' + title.toLowerCase();
    b.onclick = () => {
      dir = column !== i ? 1 : dir === 1 ? -1 : dir === -1 ? 0 : 1;
      column = dir ? i : -1;
      headers.forEach((h, n) => {
        if (n === column) h.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
        else h.removeAttribute('aria-sort');
      });
      arrange();
      tabStop();
    };
    th.append(b);
    head.append(th);
    return th;
  });
  function sorted(rows) {
    if (!dir) return rows;
    return [...rows].sort((a, b) => {
      const x = keys.get(a.tr),
        y = keys.get(b.tr);
      if (column < 2) return dir * collator.compare(x[column], y[column]);
      if (x[2] == null || y[2] == null) return Number(x[2] == null) - Number(y[2] == null);
      return dir * (x[2] - y[2] || x[3] - y[3]);
    });
  }
  function arrange() {
    const anchor = branchRow.previousElementSibling;
    for (const [body, blocks] of sections) {
      const ordered = [];
      // In sorted mode the unknown-date note becomes a preface, not a barrier
      // between A–Z rows. Third click restores even its original position.
      const groups = dir ? [...blocks.filter(b => !Array.isArray(b)), blocks.filter(Array.isArray).flat()] : blocks;
      for (const siblings of groups) {
        if (!Array.isArray(siblings)) {
          ordered.push(siblings);
          continue;
        }
        for (const group of sorted(siblings)) ordered.push(group.tr, ...sorted(group.children).map(c => c.tr));
      }
      if (anchor?.parentNode === body) ordered.splice(ordered.indexOf(anchor) + 1, 0, branchRow);
      for (const [i, tr] of ordered.entries())
        if (body.rows[i] !== tr) {
          if (body.moveBefore) body.moveBefore(tr, body.rows[i] || null);
          else body.insertBefore(tr, body.rows[i] || null);
        }
    }
    dirty = false;
  }
  return {
    row(tr, title, mod) {
      keys.set(tr, [title, mod]);
    },
    range(tr, lo, hi) {
      const key = keys.get(tr);
      if (key[2] !== lo || key[3] !== hi) {
        key[2] = lo;
        key[3] = hi;
        if (column === 2) dirty = true;
      }
    },
    clear() {
      sections.clear();
    },
    capture(body) {
      const blocks = [[]];
      let siblings = blocks[0];
      for (const tr of body.rows) {
        if (!keys.has(tr)) {
          siblings = [];
          blocks.push(tr, siblings);
          continue;
        }
        const r = { tr, children: [] };
        if (tr.classList.contains('uc-size-child')) siblings.at(-1).children.push(r);
        else siblings.push(r);
      }
      sections.set(body, blocks);
      if (dir) dirty = true;
    },
    update() {
      if (dirty) arrange();
    }
  };
}
