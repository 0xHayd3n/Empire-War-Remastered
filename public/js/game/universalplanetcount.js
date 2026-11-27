import { countLabel } from './universalmaplist.js';

// One legend across both campaign browsers. A family may span multiple sizes.
export function showPlanetCount(cell, [lo, hi], setup = false) {
  const text = countLabel([lo, hi], setup);
  if (cell.title === text) return text;
  cell.title = text;
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
