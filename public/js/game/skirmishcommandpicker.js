import { factionColor } from './commandcolor.js';
import { element } from './operationsetup.js';
// A standard is a UI marker. Explicit shared insignia never imply a shared army.
const standards = {
  Warlords: 'M3 17l4-9 5 5 5-5 4 9z M6 20h12',
  'Imperial Defectors': 'M3 5l7 6-7 7 M21 5l-7 6 7 7',
  'Criminal Underworld': 'M3 15l5-9 4 7 4-7 5 9 M6 18h12',
  Invaders: 'M4 4l8 5 8-5 M4 10l8 5 8-5 M12 15v6',
  'Republic Sector Forces': 'M3 18l9-12 9 12 M7 18l5-7 5 7'
};
export function commandMark(p, id, mask = false) {
  const family = p?.commanders?.[id]?.family || p?.facts[id]?.label || id,
    mark = p?.skirmishEmblems?.[id];
  if (mark) {
    const img = element('img', 'uc-crest');
    img.src = mark.hd || mark.art;
    if (mark.hd)
      img.onerror = async () => {
        img.onerror = null;
        const { commandFaceSvg } = await import('./crestface.js');
        const face = commandFaceSvg(mark);
        if (face) img.src = 'data:image/svg+xml,' + encodeURIComponent(face);
        else if (mark.art) img.src = mark.art;
      };
    img.alt = '';
    img.draggable = false;
    img.dataset.crestKind = 'emblem';
    img.dataset.crestAsset = mark.source;
    img.title = mark.reference
      ? mark.source
      : `${mark.origin || p.name} · ${mark.source}` +
        (mark.projectionOrigin && mark.projectionOrigin !== mark.origin ? ` · Hologram: ${mark.projectionOrigin}` : '');
    return img;
  }
  const ns = 'http://www.w3.org/2000/svg',
    svg = document.createElementNS(ns, 'svg'),
    path = document.createElementNS(ns, 'path');
  svg.classList.add('uc-crest', 'op-command-standard');
  svg.dataset.crestKind = 'standard';
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const title = document.createElementNS(ns, 'title'), ink = mask ? 'white' : factionColor(p,id) || '#a8b8c3';
  if (family === 'Independent Forces') {
    // An open orbit around a navigation star, not another polity's seal.
    // Deliberately shared by unaffiliated seats; their pack and color remain distinct.
    title.textContent = 'Independent Forces · Universal neutral standard (no verified pack emblem)';
    svg.dataset.standard = 'open-orbit';
    svg.append(title);
    for (const angle of [0, 120, 240]) {
      const arc = document.createElementNS(ns, 'path');
      arc.setAttribute('transform', `rotate(${angle} 12 12)`);
      arc.setAttribute('d', 'M3.2 9.1A9.3 9.3 0 0 1 16.6 3.9L15 5.8a7.1 7.1 0 0 0-10 4.4z M16.1 5.4l1.5-1.2.7 1.8-1.4.8z');
      arc.setAttribute('fill', ink);
      arc.setAttribute('stroke', 'none');
      svg.append(arc);
    }
    path.setAttribute('d', 'm12 5.8 1.55 4.65L18.2 12l-4.65 1.55L12 18.2l-1.55-4.65L5.8 12l4.65-1.55z');
    path.setAttribute('fill', ink);
    path.setAttribute('stroke', 'none');
    svg.append(path);
    return svg;
  }
  title.textContent = (p?.commanders?.[id]?.displayFaction || p?.facts?.[id]?.label || family) + ' · Universal marker (no verified pack emblem)';
  path.setAttribute('stroke', ink);
  path.setAttribute('fill', 'none');
  path.setAttribute('d', standards[family] || 'M12 3l8 9-8 9-8-9z M8 12h8');
  svg.append(title, path);
  return svg;
}
export function likeness(p, id) {
  const c = p?.commanders?.[id];
  if (!c?.portrait) return commandMark(p, id);
  const pic = element('img', 'op-commander-portrait');
  pic.alt = '';
  pic.draggable = false;
  pic.src = c.portrait.art;
  pic.title = `${c.name} · ${c.portrait.mod}`;
  pic.onerror = () => pic.replaceWith(commandMark(p, id));
  return pic;
}
