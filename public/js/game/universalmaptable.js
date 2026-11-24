import { planetRange, countLabel } from './universalmaplist.js';
import { mapSections, scenarioTypes } from './universalmapgroups.js';
import { sidebarTabs } from './universalsidebartabs.js';
import { mapOrder } from './universalmaporder.js';
import { submodPage } from './universalmoddirectory.js';

export function mapTable(pickMap, pickDate, clearChoice) {
  const host = document.createElement('div'),
    lastSection = new WeakMap();
  const table = document.createElement('table'),
    head = table.createTHead().insertRow(),
    entries = new Map(),
    expanded = new Map(),
    parents = new Map();
  table.className = 'uc-map-table';
  const branchRow = document.createElement('tr'),
    order = mapOrder(head, branchRow, tabStop),
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
  function row(body, p, b, title) {
    const tr = body.insertRow();
    order.row(tr, title, p.name);
    tr.dataset.profile = p.id;
    tr.insertCell().append(b);
    tr.insertCell().textContent = p.name;
    const number = tr.insertCell();
    number.className = 'uc-planet-count';
    tr.onclick = e => {
      if (!b.contains(e.target)) {
        b.focus({ preventScroll: true });
        b.click();
      }
    };
    return { tr, b, number };
  }
  function setCount(cell, [lo, hi], setup) {
    const text = countLabel([lo, hi], setup);
    if (cell.title === text) return text;
    cell.title = text;
    order.range(cell.parentNode, lo, hi);
    const tint = n => {
      const span = document.createElement('span');
      span.className = 'uc-count-' + (n < 50 ? 'low' : n < 100 ? 'mid' : 'high');
      span.textContent = n;
      return span;
    };
    cell.replaceChildren(tint(lo));
    if (hi !== lo) cell.append('–', tint(hi));
    if (setup) cell.append(' setup');
    return text;
  }
  function leaf(body, item, g) {
    const { f, title } = item,
      b = control(title, 'uc-map-choice', () => pickMap(f));
    b.dataset.family = f.id;
    b.setAttribute('aria-pressed', 'false');
    if (!g && f.span && f.span !== period.label) subtitle(b, f.span);
    const entry = { ...row(body, f.p, b, title), g, title };
    entries.set(f, entry);
    label(f);
    if (g) {
      entry.tr.id = `uc-size-${entries.size}`;
      entry.tr.className = 'uc-size-child';
      g.rows.push(entry.tr);
    }
  }
  function lockedRow(body, o, version) {
    const tr = body.insertRow(),
      title = version ? `${o.title} · ${version}` : o.title,
      b = control(version || title, 'uc-locked-choice', () => submodPage({ ...o, title }, b));
    order.row(tr, version || title, o.mod.name);
    tr.dataset.requiredMod = o.mod.id;
    tr.className = 'uc-locked-row';
    tr.title = `Requires ${o.mod.name}`;
    b.title = tr.title;
    b.setAttribute('aria-label', `${title} · ${tr.title} · View submod details`);
    const name = tr.insertCell();
    name.append(b);
    tr.insertCell().textContent = o.mod.name;
    const count = tr.insertCell();
    count.className = 'uc-planet-count';
    count.textContent = '—';
    tr.onclick = e => {
      if (!e.target.closest('button')) b.click();
    };
    if (version) {
      tr.classList.add('uc-size-child');
      tr.id = `uc-unavailable-${table.rows.length}`;
    } else if (o.versions.length) {
      // Disclosure and details are different actions: even a missing family's
      // name opens its mod page. Its chevron exposes the individual locked sizes.
      const key = JSON.stringify(['directory', o.mod.id, o.section, o.title]),
        arrow = control('', 'uc-size-group uc-locked-disclosure', () => toggle(g, !g.open)),
        g = { key, b: arrow, rows: [] };
      arrow.setAttribute('aria-label', `Versions of ${title}`);
      arrow.title = `Show versions · ${tr.title}`;
      name.classList.add('uc-locked-family');
      name.prepend(arrow);
      parents.set(arrow, g);
      g.rows = o.versions.map(v => lockedRow(body, o, v));
      arrow.setAttribute('aria-controls', g.rows.map(r => r.id).join(' '));
      disclose(g, expanded.get(key) ?? false);
    }
    return tr;
  }
  function subtitle(b, text) {
    const small = document.createElement('small');
    small.className = 'uc-map-span';
    small.textContent = text;
    b.append(small);
    return small;
  }
  function label(f, variant) {
    const { b, number } = entries.get(f),
      text = setCount(
        number,
        planetRange(f, period.maps.get(f), variant),
        f.members.every(r => r.scripted)
      );
    b.setAttribute('aria-label', [f.title, f.span, f.p.name, text].filter(Boolean).join(' · '));
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
    const b = control(title, 'uc-size-group', () => toggle(g, !g.open)),
      g = { ...row(body, f.p, b, title), key, rows: [] },
      ranges = children.map(c => planetRange(c.f, period.maps.get(c.f))),
      text = setCount(
        g.number,
        [Math.min(...ranges.map(r => r[0])), Math.max(...ranges.map(r => r[1]))],
        f.members.every(r => r.scripted)
      );
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
  const navButtons = () => [
    ...table.querySelectorAll('tbody:not([hidden]) tr:not([hidden]) :is(.uc-size-group,.uc-map-choice,.uc-locked-choice)')
  ];
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
      else g.b.closest('tr').nextElementSibling.querySelector('button').focus();
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
    host,
    show(next, family, date, variant, offers) {
      if (period !== next) {
        period = next;
        table.setAttribute('aria-label', period.scenario ? 'Scenarios' : 'Maps');
        branchRow.remove();
        branches.replaceChildren();
        while (table.tBodies.length) table.tBodies[0].remove();
        order.clear();
        entries.clear();
        parents.clear();
        active = undefined;
        const sections = new Map(mapSections(period).map(s => [s.name, s.rows])),
          locked = offers.filter(o => Boolean(o.section) === period.scenario);
        const names = (period.scenario ? scenarioTypes : ['']).filter(n => sections.has(n) || locked.some(o => o.section === n));
        host.replaceChildren();
        for (const name of names) {
          const body = table.createTBody();
          body.dataset.section = name;
          for (const item of sections.get(name) || []) {
            if (item.children) parent(body, item, family);
            else leaf(body, item, null);
          }
          if (!period.scenario && !period.discovery && locked.length) {
            const note = body.insertRow().insertCell();
            note.colSpan = 3;
            note.className = 'uc-unindexed';
            note.textContent = 'Unavailable mods · starting dates not indexed';
          }
          for (const o of locked.filter(o => o.section === name)) lockedRow(body, o);
          order.capture(body);
        }
        if (period.scenario) {
          const tabs = sidebarTabs('scenario', 'Scenario type', names, i => {
            selectSection(i);
            if (active && entries.get(active).tr.closest('tbody').hidden) clearChoice();
            else tabStop();
          });
          function selectSection(i) {
            tabs.select(i);
            lastSection.set(period, names[i]);
            tabs.panels[i].append(table);
            [...table.tBodies].forEach((body, n) => (body.hidden = n !== i));
          }
          tabs.bar.classList.add('uc-scenario-tabs');
          host.append(tabs.bar, ...tabs.panels);
          const section = entries.get(family)?.tr.closest('tbody').dataset.section ?? lastSection.get(period);
          selectSection(Math.max(0, names.indexOf(section)));
        } else host.append(table);
      }
      if (active !== family) {
        if (entries.has(active)) {
          highlight(active, false);
          label(active);
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
        label(family, variant);
        [...branches.children].forEach((b, i) => b.setAttribute('aria-pressed', String(period.maps.get(family)[i] === date)));
      }
      order.update();
    }
  };
}
