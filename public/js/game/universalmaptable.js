import { planetRange, countLabel, planetCount } from './universalmaplist.js';
import { mapSections } from './universalmapgroups.js';

export function mapTable(pickMap, pickDate) {
  const table = document.createElement('table'),
    head = table.createTHead().insertRow(),
    entries = new Map(),
    expanded = new Map(),
    parents = new Map();
  table.className = 'uc-map-table';
  for (const title of ['Map', 'Category', 'Planets']) {
    const th = document.createElement('th');
    th.textContent = title;
    th.scope = 'col';
    head.append(th);
  }
  const branchRow = document.createElement('tr'),
    branchCell = branchRow.insertCell(),
    branches = document.createElement('div');
  branchCell.colSpan = 3;
  branchCell.append(branches);
  branches.className = 'uc-branches';
  branches.setAttribute('role', 'group');
  branches.setAttribute('aria-label', 'Starting variant');
  let period, active;
  function control(label, cls, act) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.onclick = act;
    return b;
  }
  function row(body, p, b, text) {
    const tr = body.insertRow();
    tr.dataset.profile = p.id;
    tr.insertCell().append(b);
    tr.insertCell().textContent = p.name;
    const number = tr.insertCell();
    number.className = 'uc-planet-count';
    setCount(number, text);
    tr.onclick = e => {
      if (!b.contains(e.target)) {
        b.focus({ preventScroll: true });
        b.click();
      }
    };
    return { tr, b, number };
  }
  function setCount(cell, text) {
    cell.textContent = text.replace(/ planets?$/, '');
    cell.title = text;
  }
  function leaf(body, item, g) {
    const { f, title } = item,
      b = control(title, 'uc-map-choice', () => pickMap(f)),
      text = planetCount(f, period.maps.get(f));
    b.dataset.family = f.id;
    b.setAttribute('aria-pressed', 'false');
    if (!g && f.span && f.span !== period.label) subtitle(b, f.span);
    const entry = { ...row(body, f.p, b, text), g, title };
    entries.set(f, entry);
    label(f, text);
    if (g) {
      entry.tr.id = `uc-size-${entries.size}`;
      entry.tr.className = 'uc-size-child';
      g.rows.push(entry.tr);
    }
  }
  function subtitle(b, text) {
    const small = document.createElement('small');
    small.className = 'uc-map-span';
    small.textContent = text;
    b.append(small);
    return small;
  }
  function label(f, text) {
    const { b, number } = entries.get(f);
    b.setAttribute('aria-label', [f.title, f.span, f.p.name, text].filter(Boolean).join(' · '));
    setCount(number, text);
  }
  function disclose(g, on) {
    g.open = on;
    g.b.setAttribute('aria-expanded', String(on));
    for (const tr of g.rows) tr.hidden = !on;
    if (entries.get(active)?.g === g) branchRow.hidden = !on;
  }
  function toggle(g, on) {
    expanded.set(g.key, on);
    disclose(g, on);
    tabStop();
  }
  function parent(body, item, selected) {
    const { title, children, key } = item,
      { f } = children[0];
    const ranges = children.map(c => planetRange(c.f, period.maps.get(c.f))),
      text = countLabel(
        [Math.min(...ranges.map(r => r[0])), Math.max(...ranges.map(r => r[1]))],
        f.members.every(r => r.scripted)
      );
    const b = control(title, 'uc-size-group', () => toggle(g, !g.open)),
      g = { ...row(body, f.p, b, text), key, rows: [] };
    parents.set(b, g);
    b.dataset.sizeGroup = title;
    b.setAttribute('aria-label', [title, f.span, f.p.name, text].filter(Boolean).join(' · '));
    if (f.span && f.span !== period.label) subtitle(b, f.span);
    g.summary = subtitle(b, '');
    g.summary.classList.add('uc-size-summary');
    g.summary.id = `uc-size-summary-${parents.size}`;
    b.setAttribute('aria-describedby', g.summary.id);
    for (const child of children) leaf(body, child, g);
    b.setAttribute('aria-controls', g.rows.map(r => r.id).join(' '));
    disclose(g, expanded.get(key) ?? children.some(c => c.f === selected));
  }
  const navButtons = () => [...table.querySelectorAll('tr:not([hidden]) :is(.uc-size-group,.uc-map-choice)')];
  function tabStop() {
    const e = entries.get(active),
      nav = navButtons(),
      current = e ? (e.tr.hidden ? e.g.b : e.b) : nav[0];
    for (const b of nav) b.tabIndex = b === current ? 0 : -1;
  }
  table.onkeydown = e => {
    const buttons = navButtons(),
      i = buttons.indexOf(e.target);
    if (i < 0) return;
    const g = parents.get(e.target);
    if (g && e.key === 'ArrowRight') {
      e.preventDefault();
      if (!g.open) toggle(g, true);
      else g.rows[0].querySelector('button').focus();
      return;
    }
    if (e.key === 'ArrowLeft') {
      const parent = g || [...parents.values()].find(p => p.rows.includes(e.target.closest('tr')));
      if (parent) {
        e.preventDefault();
        toggle(parent, false);
        parent.b.focus();
      }
      return;
    }
    const dst = { ArrowDown: Math.min(i + 1, buttons.length - 1), ArrowUp: Math.max(0, i - 1), Home: 0, End: buttons.length - 1 }[e.key];
    if (dst !== undefined) {
      e.preventDefault();
      buttons[dst].focus();
    }
  };
  function highlight(f, on) {
    const { b, tr, g, title } = entries.get(f);
    b.setAttribute('aria-pressed', String(on));
    tr.classList.toggle('uc-selected-map', on);
    if (g) {
      g.tr.classList.toggle('uc-contains-selection', on);
      g.summary.textContent = on ? `Selected: ${title}` : '';
    }
  }
  return {
    table,
    show(next, family, date, variant) {
      if (period !== next) {
        period = next;
        table.setAttribute('aria-label', period.scenario ? 'Scenarios' : 'Maps');
        branchRow.remove();
        branches.replaceChildren();
        while (table.tBodies.length) table.tBodies[0].remove();
        entries.clear();
        parents.clear();
        active = undefined;
        for (const section of mapSections(period)) {
          const body = table.createTBody();
          if (section.name) {
            const th = document.createElement('th');
            th.scope = 'rowgroup';
            th.colSpan = 3;
            th.textContent = section.name;
            th.className = 'uc-scenario-heading';
            body.insertRow().append(th);
          }
          for (const item of section.rows) {
            if (item.children) parent(body, item, family);
            else leaf(body, item, null);
          }
        }
      }
      if (active !== family) {
        if (entries.has(active)) {
          highlight(active, false);
          label(active, planetCount(active, period.maps.get(active)));
        }
        branchRow.remove();
        branches.replaceChildren();
        active = family;
        if (family) {
          const { tr } = entries.get(family);
          highlight(family, true);
          const dates = period.maps.get(family);
          if (dates.length > 1) {
            for (const d of dates) branches.append(control(d.label, '', () => pickDate(d)));
            tr.after(branchRow);
            branchRow.hidden = tr.hidden;
          }
        }
      }
      tabStop();
      if (family) {
        label(family, planetCount(family, period.maps.get(family), variant));
        [...branches.children].forEach((b, i) => b.setAttribute('aria-pressed', String(period.maps.get(family)[i] === date)));
      }
    }
  };
}
