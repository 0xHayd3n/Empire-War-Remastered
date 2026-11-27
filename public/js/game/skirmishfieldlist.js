import { element, action } from './operationsetup.js';
import { operationTable, choiceRow } from './operationtable.js';
import { battlefieldPlanet as nameKey } from './battlefieldplanet.js';

// Pixel heights are shared with CSS via the rendered rows' inline height. The
// scroll track represents the entire result, including expanded map variants.
const HEIGHT = { planet: 40, domain: 18, map: 26 },
  BUFFER = 10;
export function skirmishFieldList(list, portrait, choose) {
  const table = operationTable('Planet battlefields', ['Battlefield', 'Mod']),
    header = table.tHead,
    empty = element('p', 'op-origin', 'No matching battlefields'),
    expanded = new Set();
  let groups = [],
    rows = [],
    offsets = [0],
    indices = new Map(),
    lastQuery,
    selected,
    first = -1,
    end = -1,
    raf = 0;
  list.classList.add('op-field-index');
  list.tabIndex = -1;
  list.append(table, empty);
  function flatten() {
    rows = [];
    offsets = [0];
    indices = new Map();
    const add = (kind, g, value) => {
      const item = { kind, g, value };
      if (kind !== 'domain') indices.set(value, rows.length);
      rows.push(item);
      offsets.push(offsets.at(-1) + HEIGHT[kind]);
    };
    for (const g of groups) {
      add('planet', g, g.key);
      if (!g.open) continue;
      let domain;
      for (const f of g.fields) {
        if (f.domain !== domain) {
          domain = f.domain;
          add('domain', g, domain);
        }
        add('map', g, f);
      }
    }
    table.setAttribute('aria-rowcount', rows.length + 1);
    first = end = -1;
  }
  function at(y) {
    let lo = 0,
      hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid + 1] <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  function spacer(parent, height) {
    if (!height) return;
    const body = element('tbody', 'op-field-spacer');
    body.setAttribute('aria-hidden', 'true');
    const cell = body.insertRow().insertCell();
    cell.colSpan = 2;
    cell.style.height = height + 'px';
    parent.append(body);
  }
  const buttonAt = i => table.querySelector(`button[data-index="${i}"]`);
  function focusItem(i) {
    if (i == null || !rows[i]) return;
    const top = list.scrollTop,
      height = list.clientHeight - header.offsetHeight;
    if (offsets[i] < top) list.scrollTop = offsets[i];
    else if (offsets[i + 1] > top + height) list.scrollTop = Math.max(0, offsets[i + 1] - height);
    paint();
    buttonAt(i)?.focus({ preventScroll: true });
  }
  function toggle(g) {
    const i = indices.get(g.key),
      y = offsets[i] - list.scrollTop;
    g.open = !g.open;
    if (g.open) expanded.add(g.key);
    else expanded.delete(g.key);
    flatten();
    paint();
    list.scrollTop = offsets[indices.get(g.key)] - y;
    focusItem(indices.get(g.key));
  }
  function paint() {
    const top = list.scrollTop,
      height = list.clientHeight,
      a = at(top),
      b = Math.min(rows.length, at(top + height) + 1);
    if (first >= 0 && (first === 0 || a >= first + 3) && (end === rows.length || b <= end - 3)) return;
    first = Math.max(0, a - BUFFER);
    end = Math.min(rows.length, b + BUFFER);
    const focused = table.contains(document.activeElement) ? document.activeElement.dataset.index : null;
    const fragment = document.createDocumentFragment();
    spacer(fragment, offsets[first]);
    let body, section;
    for (let i = first; i < end; i++) {
      const { kind, g, value } = rows[i];
      let row, button;
      const parent = kind === 'planet';
      if (!body || section !== parent) {
        section = parent;
        body = element('tbody', parent ? '' : 'op-field-children');
        fragment.append(body);
      }
      if (parent) {
        row = body.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 2;
        button = action('', () => toggle(g), 'op-field-parent');
        button.dataset.planetGroup = g.key;
        button.setAttribute('aria-expanded', String(g.open));
        button.setAttribute('aria-label', `${g.name} · ${g.fields.length} battlefields`);
        button.append(portrait(g.art), element('span', '', g.name), element('small', '', String(g.fields.length)));
        cell.append(button);
      } else if (kind === 'domain') {
        row = body.insertRow();
        const th = element('th', 'op-domain-label', value === 'land' ? 'Land' : 'Space');
        th.colSpan = 2;
        row.append(th);
      } else {
        const f = value;
        button = action(f.listTitle, () => choose(f), 'op-field-leaf');
        Object.assign(button.dataset, { world: f.world.id, domain: f.domain, source: f.p.id, file: f.file });
        button.title = `${f.listTitle} · ${f.file}`;
        button.setAttribute('aria-label', `${g.name} · ${f.domain === 'land' ? 'Land' : 'Space'} · ${f.listTitle} · ${f.p.name}`);
        button.setAttribute('aria-pressed', String(selected === f));
        row = choiceRow(body, button, [f.p.name]);
      }
      if (button) button.dataset.index = i;
      row.style.height = HEIGHT[kind] + 'px';
      row.setAttribute('aria-rowindex', i + 2);
    }
    spacer(fragment, offsets.at(-1) - offsets[end]);
    // Mount the replacement before removing the focused row. Blur handlers can
    // flush layout: a temporarily empty track would clamp scrollTop on End.
    const previous = Array.from(table.tBodies);
    table.append(fragment);
    for (const body of previous) body.remove();
    if (list.scrollTop !== top) list.scrollTop = top;
    if (focused != null) (buttonAt(Number(focused)) || list).focus({ preventScroll: true });
  }
  const schedule = () => {
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        paint();
      });
  };
  list.addEventListener('scroll', schedule, { passive: true });
  const resize = new ResizeObserver(schedule);
  resize.observe(list);
  list.addEventListener('keydown', e => {
    const i = Number(e.target.dataset.index);
    if (!Number.isInteger(i)) return;
    const step =
      e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey) ? 1 : e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 0;
    let next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : i + step;
    if (!step && next === i) return;
    while (rows[next]?.kind === 'domain') next += step || 1;
    if (!rows[next] || (e.key === 'Tab' && buttonAt(next))) return;
    e.preventDefault();
    focusItem(next);
  });
  function update(fields, f, queryKey, query, reveal) {
    const old = selected;
    selected = f;
    if (lastQuery !== queryKey) {
      lastQuery = queryKey;
      const by = new Map();
      for (const entry of fields) {
        const key = entry.chartId,
          fileKey = entry.variantKey;
        if (!by.has(key)) by.set(key, new Map());
        const variants = by.get(key),
          prior = variants.get(fileKey);
        if (!prior || entry === f || (prior !== f && nameKey(entry.world.id) === key)) variants.set(fileKey, entry);
      }
      groups = Array.from(by, ([key, variants]) => {
        const fields = [...variants.values()];
        return {
          key,
          name: fields[0].world.name,
          art: fields.find(e => e.art)?.art,
          fields,
          open: expanded.has(key) || (!!query && (by.size === 1 || nameKey(query).includes(key))) || fields.includes(f)
        };
      });
      flatten();
      empty.hidden = !!groups.length;
      list.scrollTop = 0;
    } else if (reveal && f && !indices.has(f)) {
      const g = groups.find(g => g.fields.includes(f));
      if (g) {
        g.open = true;
        flatten();
      }
    }
    const i = indices.get(f);
    if (reveal && i != null) {
      paint();
      list.scrollTop = Math.max(0, offsets[i] - list.clientHeight / 2);
    }
    paint();
    if (old !== f) {
      buttonAt(indices.get(old))?.setAttribute('aria-pressed', 'false');
      buttonAt(i)?.setAttribute('aria-pressed', 'true');
    }
  }
  return {
    update,
    focus: f => focusItem(indices.get(f)),
    close() {
      resize.disconnect();
      cancelAnimationFrame(raf);
      list.removeEventListener('scroll', schedule);
    }
  };
}
