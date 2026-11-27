import { element, action } from './operationsetup.js';
import { seatCard } from './skirmishseatcard.js';
import { commanderStage } from './skirmishstage.js';
import { seatMoves } from './skirmishseatmove.js';
import { MAX_SLOTS } from './slotrows.js';
import { MAX_TEAMS } from './skirmishsetup.js';
export function skirmishTeams(panel, model, { ui, profiles, change, advanced }) {
  const { slots } = model,
    teams = element('div', 'op-team-list');
  let editing = null,
    pendingEntry = false,
    dead = false,
    portraits,
    loading;
  const trigger = i => teams.querySelector(`[data-choose-seat="${i}"]`);
  function bindStill(img, p, id) {
    // No model traffic until the player actually visits Teams. Only the
    // current card nodes may subscribe after a tab change or roster rebuild.
    if (panel.hidden || dead) return;
    loading ||= import('./commandheadshots.js')
      .then(({ commandHeadshots }) => (dead ? null : (portraits = commandHeadshots())))
      .catch(() => null);
    loading.then(bank => {
      if (!dead && !panel.hidden && img.isConnected) bank?.bind(img, p, id);
    });
  }
  const stage = commanderStage(
    ui,
    profiles,
    (p, faction) => {
      const i = editing;
      if (i === null || slots[i].kind === 'closed') return;
      slots[i].rosterPick = { profile: p.id, faction };
      delete slots[i].skirmishFaction;
      update();
      // The assignment is committed. Start is available again, but browsing
      // continues on this player, with the same focused hero and search.
      ui.foot.inert = false;
    },
    dismiss,
    { bind: bindStill, release: root => portraits?.reset(root) }
  );
  const moves = seatMoves(teams, (i, t) => {
    const s = slots[i];
    if (!s || s.kind === 'closed' || !Number.isInteger(t) || t < 0 || t >= MAX_TEAMS) return;
    s.rosterPick = { ...model.sourceOf(s) };
    s.team = t;
    dismiss();
    update();
    teams.querySelector(`[data-lift-seat="${i}"]`)?.focus({ preventScroll: true });
  });
  function dismiss(focus = false) {
    const b = editing !== null && trigger(editing);
    editing = null;
    pendingEntry = false;
    stage.close();
    moves.cancel();
    if (b) {
      b.setAttribute('aria-expanded', 'false');
      if (focus) b.focus({ preventScroll: true });
    }
  }
  function choose(i, focus = true) {
    const b = trigger(i);
    if (!b || b.disabled || panel.hidden) return;
    const previous = editing !== null && editing !== i ? model.sourceOf(slots[editing]) : null;
    if (editing !== null) trigger(editing)?.setAttribute('aria-expanded', 'false');
    moves.cancel();
    pendingEntry = false;
    editing = i;
    b.setAttribute('aria-expanded', 'true');
    stage.open(model.sourceOf(slots[i]), b.dataset.who, focus, previous);
  }
  function update() {
    model.syncTeams(true);
    render();
    change();
  }
  function render() {
    portraits?.reset(teams);
    teams.replaceChildren();
    const you = slots.find(s => s.kind === 'you'),
      used = model.teamsUsed();
    if (you.team < 0) {
      dismiss();
      teams.append(
        element('p', 'op-description', 'Custom staging: use Players & options to edit spectator seats or additional teams.'),
        action('Players & options', advanced)
      );
      return;
    }
    const enemy = used.find(t => t !== you.team) ?? (you.team === 0 ? 1 : 0),
      teamIds = [...new Set([you.team, enemy, ...used])],
      next = Array.from({ length: MAX_TEAMS }, (_, i) => i).find(t => !teamIds.includes(t)),
      room = slots.some(s => s.kind === 'closed') || slots.length < MAX_SLOTS;
    function addSeat(t) {
      const s = slots.find(s => s.kind === 'closed') || {};
      if (!slots.includes(s)) {
        if (slots.length >= MAX_SLOTS) return;
        slots.push(s);
      }
      const leader = slots.find(x => x !== s && x.team === t && x.kind !== 'closed');
      delete s.rosterPick;
      Object.assign(s, { kind: 'medium', team: t, auto: true, skirmishFaction: model.st.teamFactions[t] });
      if (leader) s.rosterPick = { ...model.sourceOf(leader) };
      update();
      const i = slots.indexOf(s);
      choose(i, false);
      trigger(i)?.focus();
    }
    let opponent = 0;
    for (const t of teamIds) {
      const mine = t === you.team,
        name = mine ? 'Your team' : 'Enemy team',
        section = element('section', 'op-team'),
        seats = element('ul', 'op-seat-cards');
      section.dataset.dropTeam = t;
      seats.setAttribute('aria-label', `${name} roster`);
      section.append(
        element('h3', 'op-team-title', `${name} · Team ${t + 1}`),
        action(`Move here · Team ${t + 1}`, () => moves.drop(section), 'op-team-drop'),
        seats
      );
      let ally = 0;
      for (const [i, s] of slots.entries()) {
        if (s.team !== t || s.kind === 'closed') continue;
        const who = s.kind === 'you' ? 'You' : mine ? `Ally ${++ally}` : `Opponent ${++opponent}`;
        seats.append(
          seatCard({
            model,
            i,
            who,
            editing,
            canChoose: profiles().length > 0,
            choose,
            moves,
            change,
            bindStill,
            remove: () => {
              if (editing === i) dismiss();
              s.kind = 'closed';
              update();
              (teams.querySelector(`[data-add-team="${t}"]`) || trigger(slots.indexOf(you)))?.focus();
            }
          })
        );
      }
      const more = action(mine ? 'Add ally' : t === enemy ? 'Add opponent' : `Add to team ${t + 1}`, () => addSeat(t), 'op-team-add');
      more.dataset.addTeam = t;
      more.disabled = !room;
      section.append(more);
      teams.append(section);
    }
    if (next != null) {
      const create = action(
        '',
        () => {
          if (moves.held !== null) moves.drop(create);
          else if (room) addSeat(next);
        },
        'op-team-create'
      );
      create.dataset.dropTeam = next;
      create.append(
        element('span', 'op-create-rest', room ? 'Create team' : 'New team'),
        element('span', 'op-create-drop', 'Drop here to create a team')
      );
      create.title = 'Drop a participant here to form a team without adding an AI.';
      teams.append(create);
    }
    if (pendingEntry && profiles().length) choose(slots.indexOf(you), false);
  }
  panel.append(teams);
  render();
  return {
    enter() {
      pendingEntry = true;
      render();
    },
    render,
    dismiss,
    dispose() {
      dead = true;
      stage.dispose();
      portraits?.dispose();
    }
  };
}
