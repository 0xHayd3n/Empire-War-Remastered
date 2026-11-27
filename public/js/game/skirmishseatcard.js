// A card has two different colors: its heraldry and ground identify the exact
// assigned roster; the editable edge is the participant's battle paint.
import { action, element } from './operationsetup.js';
import { factionColor } from './commandcolor.js';
import { commandCardArt, exhibitName } from './commandcardart.js';

export function seatCard({ model, i, who, editing, canChoose, choose, moves, bindStill, change, remove }) {
  const s = model.slots[i],
    ref = model.sourceOf(s),
    p = model.profileOf(s),
    id = ref.faction,
    cmd = p?.commanders?.[id],
    label = cmd?.displayFaction || p?.facts?.[id]?.label || id,
    name = exhibitName(cmd);
  const row = element('li', 'op-seat-card');
  row.dataset.seat = i;
  row.dataset.roster = `${ref.profile}/${id}`;
  row.draggable = true;
  row.style.setProperty('--faction-ink', factionColor(p, id) || '#71838c');
  row.style.setProperty('--seat-color', s.color);
  const strip = element('input', 'op-card-strip');
  Object.assign(strip, { type: 'color', value: s.color, title: `${who} color` });
  strip.setAttribute('aria-label', strip.title);
  strip.oninput = () => {
    s.color = strip.value;
    s.auto = false;
    row.style.setProperty('--seat-color', s.color);
    change();
  };
  const b = action('', () => choose(i), 'op-card-choice');
  b.dataset.chooseSeat = i;
  b.dataset.who = who;
  // A missing saved pack must still let the player choose an installed roster.
  b.disabled = !canChoose;
  b.setAttribute('aria-controls', 'op-command-stage');
  b.setAttribute('aria-expanded', String(editing === i));
  b.setAttribute('aria-label', `${who} faction: ${label}${name ? ' · ' + name : ''}`);
  b.title = [name, label, p?.name, p && !model.isNativeSeat(s) ? 'Detachment' : ''].filter(Boolean).join(' · ');
  b.append(
    commandCardArt(p, id, bindStill, 'op-card-art'),
    element('span', 'op-card-seat', who),
    element('strong', 'op-player-name', name || label),
    element('span', 'op-card-origin', [label, p?.name].filter(Boolean).join(' · '))
  );
  const controls = element('div', 'op-card-controls');
  if (s.kind !== 'you') {
    const skill = element('select', 'op-skill');
    skill.setAttribute('aria-label', `${who} difficulty`);
    for (const n of ['Easy', 'Medium', 'Hard']) skill.add(new Option(n, n.toLowerCase()));
    skill.value = s.kind;
    skill.onchange = () => {
      s.kind = skill.value;
      change();
    };
    controls.append(skill);
  }
  const lift = action('', () => {}, 'op-card-move');
  lift.setAttribute('aria-label', `Move ${who}`);
  lift.title = `Move ${who}: drag to a team, or activate and choose a destination`;
  moves.handle(lift, i);
  // A small grip stays a separate touch/keyboard target; clicking the face
  // itself always selects this seat for browsing rather than picking it up.
  controls.append(lift);
  if (s.kind !== 'you') {
    const del = action('×', remove, 'op-card-remove');
    del.title = 'Remove ' + who.toLowerCase();
    del.setAttribute('aria-label', del.title);
    controls.append(del);
  }
  row.append(b, strip, controls);
  return row;
}
