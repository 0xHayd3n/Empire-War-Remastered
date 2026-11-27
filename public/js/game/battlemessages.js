import { viewOptions } from './viewpreferences.js';
// Establish a persistent live region before the first message. Removals from the visual
// feed should not be read, and changing this preference must not replay earlier lines.
export function configureMessageReader(box = globalThis.document?.getElementById?.('messages')) {
  if (!box) return;
  box.setAttribute('aria-atomic', 'false');
  box.setAttribute('aria-relevant', 'additions');
  box.setAttribute('aria-live', viewOptions.messageReader ? 'polite' : 'off');
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => configureMessageReader(), { once: true });
  else configureMessageReader();
}
// Explicit mission/network timeouts take precedence over the normal message speed.
export function battleMessage(box, text, cls = '', color = '', life = 6000 * viewOptions.messageTime) {
  if (!text || box.lastChild?.textContent === text) return;
  const d = document.createElement('div'),
    wrap = document.createElement('p');
  d.textContent = text;
  d.className = cls;
  if (color) d.style.color = color;
  d.style.animationDuration = life + 'ms';
  wrap.style.margin = '0';
  wrap.appendChild(d);
  box.appendChild(wrap);
  while (box.childElementCount > viewOptions.messageCount) box.firstChild.remove();
  setTimeout(() => wrap.remove(), life);
}
