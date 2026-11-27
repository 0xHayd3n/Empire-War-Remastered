// Switching lanes changes only the panel below the two buttons. No lobby, ticket or native dialog is opened here.
export function playTabs(root, lanes, initial, render) {
  return tabPanels(root, lanes, initial, render, { prefix: 'play', label: 'Play modes', panelClass: 'mode-grid' });
}

export function tabPanels(root, lanes, initial, render, { prefix, label, panelClass, vertical = false, retain = false, panelRoot = root }) {
  const list = document.createElement('div');
  list.className = prefix + '-tabs';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', label);
  if (vertical) list.setAttribute('aria-orientation', 'vertical');
  root.replaceChildren(list);
  const entries = lanes.map(({ key, action, label }) => {
    const tab = document.createElement('button'),
      panel = document.createElement('section');
    tab.type = 'button';
    tab.id = `${prefix}-tab-${key}`;
    if (action) tab.dataset.id = action;
    tab.textContent = label;
    tab.setAttribute('role', 'tab');
    panel.id = `${prefix}-panel-${key}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.className = panelClass;
    tab.setAttribute('aria-controls', panel.id);
    list.append(tab);
    panelRoot.append(panel);
    return { key, tab, panel };
  });
  let selected;
  function select(entry) {
    if (entry === selected) return;
    selected = entry;
    for (const { key, tab, panel } of entries) {
      const current = key === entry.key;
      tab.tabIndex = current ? 0 : -1;
      tab.setAttribute('aria-selected', String(current));
      panel.hidden = !current;
      if (!current && !retain) panel.replaceChildren();
    }
    render(entry.panel, entry.key);
  }
  for (const [i, entry] of entries.entries()) {
    entry.tab.onclick = () => select(entry);
    entry.tab.onkeydown = e => {
      const next = {
        [vertical ? 'ArrowDown' : 'ArrowRight']: (i + 1) % entries.length,
        [vertical ? 'ArrowUp' : 'ArrowLeft']: (i + entries.length - 1) % entries.length,
        Home: 0,
        End: entries.length - 1
      }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select(entries[next]);
      entries[next].tab.focus({ preventScroll: true });
    };
  }
  select(entries.find(entry => entry.key === initial) || entries[0]);
}
