import { loadMapPreview } from '../ted.js';
import { isDynamic } from './dynamicmap.js';
import { element } from './operationsetup.js';

// Only use preview art for the exact mounted map. Async completions from a
// previous selection must never replace the current field's thumbnail.
export function skirmishSummary(ui, model) {
  const box = element('section', 'op-battle-summary'),
    image = element('div', 'op-battle-thumb'),
    text = element('div', 'op-summary-text'),
    title = element('strong'),
    subtitle = element('small'),
    roster = element('div', 'op-seat-icons');
  box.setAttribute('aria-label', 'Battle overview');
  text.append(title, subtitle, roster);
  box.append(image, text);
  ui.foot.prepend(box);
  let key,
    serial = 0;
  function show(battle, profile) {
    const file = battle?.file,
      teams = model.teamsUsed(),
      id = file ? JSON.stringify([file, isDynamic(file) ? teams.length : 0]) : '';
    title.textContent = file ? battle.title : 'Choose a battlefield';
    subtitle.hidden = !file;
    subtitle.textContent = file
      ? [battle?.world?.name, battle?.domain === 'land' ? 'Land' : 'Space', battle?.mod].filter(Boolean).join(' · ')
      : '';
    if (id !== key) {
      key = id;
      const n = ++serial;
      image.replaceChildren();
      image.hidden = true;
      if (file)
        loadMapPreview(file, { teams: Math.max(2, teams.length) })
          .then(canvas => {
            if (n !== serial || !canvas || !box.isConnected) return;
            canvas.setAttribute('role', 'img');
            canvas.setAttribute('aria-label', `Map preview: ${title.textContent}`);
            image.replaceChildren(canvas);
            image.hidden = false;
          })
          .catch(() => {});
    }
    roster.replaceChildren();
    const human = model.slots.find(s => s.kind === 'you');
    for (const team of teams) {
      const group = element('span', 'op-icon-team');
      group.append(element('small', '', `T${team + 1}`));
      for (const s of model.slots.filter(s => s.team === team && s.kind !== 'closed')) {
        const who = s.kind === 'you' ? 'You' : s.team === human.team ? 'Ally' : 'Opponent',
          f = model.seatFaction(s),
          p = model.profileOf(s), id=model.sourceOf(s).faction,
          label = `${who} · Team ${team + 1} · ${p?.commanders?.[id]?.displayFaction || p?.facts[id]?.label || f}${s.kind === 'you' ? '' : ' · ' + s.kind}`;
        const icon = element('span', 'op-person');
        icon.title = label;
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', label);
        icon.style.color = s.color;
        group.append(icon);
      }
      roster.append(group);
    }
  }
  return { show };
}
