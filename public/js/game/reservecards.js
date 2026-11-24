// Both tactical HUD skins use the same card identity, press/drag gestures and
// accessible label. Formation math still receives native unit types.
import { reserveCounts } from './campaignreserve.js';
import { flagshipName, conditionLabel } from './flagshiplabel.js';
export function reserveCards(player) {
  return [...reserveCounts(player)].map(([key, count]) => {
    const flag = key === player.reserveBook?.flagship;
    return {
      key,
      type: flag ? key.type : key,
      count,
      id: flag ? key.vessel.id : null,
      detail: flag ? `${flagshipName} · ${conditionLabel(key.vessel.condition)}` : ''
    };
  });
}
export const reserveSignature = cards => cards.map(c => `${c.type.name}:${c.count}:${c.id || ''}:${c.detail}`).join('|');
export function wireReserveCard(node, card, ui, owner, label, leave) {
  const { key, type, id, detail } = card,
    pick = () => ui.addPlacing(type, id),
    drag = () => ui.startPlacing(type, true, id);
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  node.title = detail ? `${detail} · ${label}` : label;
  node.setAttribute('aria-label', node.title);
  if (detail) {
    node.classList.add('flagship-reserve');
    node.dataset.vessel = id;
  }
  node.onmousedown = e => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (globalThis.multiPlace === false) drag();
    else owner.reinPress = key;
  };
  node.onmouseleave = e => {
    leave?.();
    if (owner.reinPress === key && e.buttons & 1) {
      owner.reinPress = null;
      drag();
    }
  };
  node.onmouseup = e => {
    if (e.button === 0 && owner.reinPress === key) {
      owner.reinPress = null;
      pick();
    }
  };
  node.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) pick();
    }
  };
  node.onclick = e => {
    if (e.detail === 0) pick();
  };
}
