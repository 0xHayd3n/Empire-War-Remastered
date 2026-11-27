import { el, action, option, askDesk } from './commandui.js';
import { MAX_UNITS, readCards, saveCard, removeCard, planCard } from './fleetpresets.js';

// A reusable deployment order for ONE lead type. Temporary edits survive
// browsing other dossiers; saved cards remain independent of fleet blueprints.
export function flightCards({ root, key, notice, fleet, append, refresh }) {
  const drafts = new Map(),
    saved = new Map();
  const address = c => JSON.stringify([c.faction, c.lead]);
  for (const c of readCards(key, notice)) saved.set(address(c), c);
  let sync = () => {};
  function show(host, r, faction, roster) {
    sync = () => {};
    host.replaceChildren();
    if (!r) return;
    const defaultCard = { faction, lead: r.name, copies: 1, support: '', wing: 0 },
      id = address(defaultCard);
    let card = { ...(drafts.get(id) || saved.get(id) || defaultCard) };
    host.innerHTML = `<div class="card-heading"><h3>Flight card</h3><small class="card-state"></small></div>
      <p>Deploy this unit alone or with a companion. Save one card per unit for single-player staging.</p>
      <div class="card-slots"><label>Lead count<input type="number" min="1" step="1" class="copies"></label>
      <label>Companion<select aria-label="Companion" class="support"></select></label><label>Companion count<input type="number" min="1" step="1" class="wing"></label></div>
      <p class="card-estimate"></p><div class="desk-actions"></div><div class="card-message" role="status"></div>`;
    const $ = s => host.querySelector(s),
      lead = $('.copies'),
      support = $('.support'),
      wing = $('.wing'),
      bar = $('.desk-actions'),
      msg = $('.card-message');
    option(support, '', 'None · solo deployment');
    for (const s of roster) if (s.name !== r.name) option(support, s.name, s.label + ' · ' + s.cost.toLocaleString() + ' cr');
    if (card.support && !roster.some(s => s.name === card.support)) option(support, card.support, card.support + ' (unavailable)');
    lead.max = r.hero ? 1 : MAX_UNITS;
    lead.value = card.copies || '';
    support.value = card.support;
    wing.value = card.wing || 1;
    function edit() {
      card = { ...defaultCard, copies: lead.valueAsNumber, support: support.value, wing: support.value ? wing.valueAsNumber : 0 };
      if (JSON.stringify(card) === JSON.stringify(saved.get(id) || defaultCard)) drafts.delete(id);
      else drafts.set(id, card);
      msg.textContent = '';
      sync();
    }
    lead.oninput = wing.oninput = edit;
    support.onchange = () => {
      wing.value = 1;
      edit();
    };
    const add = action(bar, 'Add card to blueprint', () => {
      const plan = planCard(card, faction, roster, fleet());
      if (plan.error) return (msg.textContent = plan.error);
      append(plan.units);
      msg.textContent = `Added ${plan.units.length} to the blueprint.`;
    });
    const save = action(bar, 'Save flight card', () => {
      try {
        saveCard(key, card, faction, roster);
        saved.set(id, card);
        drafts.delete(id);
        refresh();
        sync();
        msg.textContent = 'Card saved. Add it to a matching fleet in Instant Battle.';
      } catch (e) {
        msg.textContent = e.message;
      }
    });
    const remove = action(bar, 'Delete card', () =>
      askDesk(root, 'Delete this unit’s saved flight card?', {
        label: 'Delete',
        run: () => {
          try {
            removeCard(key, card);
            saved.delete(id);
            drafts.delete(id);
            refresh();
            show(host, r, faction, roster);
            host.querySelector('.card-message').textContent = 'Flight card deleted.';
            host.querySelector('.copies').focus();
          } catch (e) {
            msg.textContent = e.message;
          }
        }
      })
    );
    sync = () => {
      wing.disabled = !card.support;
      wing.max = roster.find(s => s.name === card.support)?.hero ? 1 : MAX_UNITS;
      const own = planCard(card, faction, roster),
        combined = own.error ? own : planCard(card, faction, roster, fleet());
      $('.card-state').textContent = drafts.has(id) ? 'Edited' : saved.has(id) ? 'Saved' : 'Standard';
      $('.card-estimate').textContent =
        own.error ||
        `${own.units.length} in card · ${own.cost.toLocaleString()} credits` + (combined.error ? ` · Blueprint: ${combined.error}` : '');
      save.disabled = !!own.error || (saved.has(id) && !drafts.has(id));
      add.disabled = !!combined.error;
      remove.hidden = !saved.has(id);
    };
    sync();
  }
  return {
    show,
    update: () => sync(),
    dirty: () => !!drafts.size,
    discardEdits: () => drafts.clear(),
    has: (faction, lead) => saved.has(address({ faction, lead }))
  };
}
