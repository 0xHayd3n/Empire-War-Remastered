// The roster is mounted once. Only the active map owns the inline dates, so choosing a start
// doesn't rebuild the list, discard keyboard focus, or send the scroll position back to the top.
export function campaignRoster(host, groups, pickMap, pickDate) {
  const entries = new Map(),
    buttons = [];
  let active, selected;
  for (const group of groups) {
    const section = document.createElement('section'),
      heading = document.createElement('h2');
    section.dataset.profile = group.id;
    heading.textContent = group.heading;
    section.append(heading);
    host.append(section);
    if (!group.maps.length) {
      const note = document.createElement('small');
      note.textContent = group.empty;
      section.append(note);
    }
    for (const f of group.maps) {
      const item = document.createElement('div'),
        b = document.createElement('button'),
        title = document.createElement('span');
      item.className = 'uc-map-row';
      b.type = 'button';
      b.className = 'uc-map-choice';
      b.dataset.family = f.id;
      b.setAttribute('aria-pressed', 'false');
      b.tabIndex = -1;
      title.textContent = f.title;
      b.append(title);
      if (f.span) {
        const span = document.createElement('small');
        span.textContent = f.span;
        b.append(span);
      }
      b.onclick = () => {
        if (f !== selected) pickMap(f);
      };
      item.append(b);
      section.append(item);
      entries.set(f, { item, b });
      buttons.push(b);
    }
  }
  host.onkeydown = e => {
    const n = buttons.indexOf(e.target);
    if (n < 0) return;
    const dst = { ArrowDown: Math.min(n + 1, buttons.length - 1), ArrowUp: Math.max(n - 1, 0), Home: 0, End: buttons.length - 1 }[e.key];
    if (dst === undefined) return;
    e.preventDefault();
    buttons[dst].focus();
  };
  const dates = document.createElement('div');
  dates.className = 'uc-dates';
  dates.setAttribute('role', 'group');
  dates.setAttribute('aria-label', 'Starting date');
  return {
    show(f, date) {
      if (selected !== f) {
        if (active) {
          active.b.tabIndex = -1;
          active.b.setAttribute('aria-pressed', 'false');
          active.item.classList.remove('current');
        }
        selected = f;
        active = entries.get(f);
        active.item.classList.add('current');
        active.b.tabIndex = 0;
        active.b.setAttribute('aria-pressed', 'true');
        dates.replaceChildren();
        if (f.dates.length > 1) {
          for (const d of f.dates) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = d.label;
            b.onclick = () => pickDate(d);
            dates.append(b);
          }
        } else if (date.label !== f.span) dates.textContent = date.label;
        active.item.append(dates);
        active.item.scrollIntoView({ block: 'nearest' });
      }
      if (f.dates.length > 1) f.dates.forEach((d, i) => dates.children[i].setAttribute('aria-pressed', String(d === date)));
    },
    focus() {
      active?.b.focus({ preventScroll: true });
      active?.item.scrollIntoView({ block: 'nearest' });
    }
  };
}
