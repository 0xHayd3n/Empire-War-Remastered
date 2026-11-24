// Both sidebar tab strips use roving focus; disabled start types are skipped.
// The caller owns the selection so an era change can update the active tab too.
export function sidebarTabs(id, label, names, choose) {
  const bar = document.createElement('div');
  bar.className = 'uc-sidebar-tabs';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', label);
  const panels = [],
    buttons = names.map((name, i) => {
      const b = document.createElement('button'),
        panel = document.createElement('div');
      b.type = 'button';
      b.textContent = name;
      b.id = `uc-${id}-tab-${i}`;
      panel.id = `uc-${id}-panel-${i}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', panel.id);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', b.id);
      b.onclick = () => choose(i);
      bar.append(b);
      panels.push(panel);
      return b;
    });
  bar.onkeydown = e => {
    const enabled = buttons.filter(b => !b.disabled),
      n = enabled.length,
      i = enabled.indexOf(e.target);
    if (i < 0) return;
    const next = { ArrowLeft: (i + n - 1) % n, ArrowRight: (i + 1) % n, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    enabled[next].focus();
    enabled[next].click();
  };
  function select(index) {
    buttons.forEach((b, i) => {
      b.setAttribute('aria-selected', String(i === index));
      b.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
  }
  select(0);
  return { bar, buttons, panels, select };
}
