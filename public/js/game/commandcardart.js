// The stage, directory and assigned player must depict the same exhibit. The
// still is a transparent render of its signed, equipped body, not a unit icon.
import { element } from './operationsetup.js';
import { commandMark } from './skirmishcommandpicker.js';

export const exhibitName = c => (c?.stage?.kind === 'unit' ? c.stage.label : c?.name);
export function commandCardArt(p, id, bindStill, className) {
  const art = element('span', className),
    still = element('img', 'op-card-still');
  art.setAttribute('aria-hidden', 'true');
  still.alt = '';
  still.draggable = false;
  if (p) art.append(commandMark(p, id));
  art.append(still);
  if (p?.commanders?.[id]?.stage) bindStill(still, p, id);
  return art;
}
