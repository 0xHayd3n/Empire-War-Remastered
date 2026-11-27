// Shared by the Galactic Conquest atlas and the three single-player operation boards.
const heraldry = {
  'Old Republic': ['old-republic', 'Jedi Order / Sith Empire'],
  'Clone Wars': ['clone-wars', 'Galactic Republic / Separatist Alliance'],
  'Galactic Civil War': ['galactic-civil-war', 'Rebel Alliance / Galactic Empire'],
  'New Republic': ['new-republic-era', 'New Republic / Imperial Remnant']
};
export function eraCard(name, pick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'uc-era-card';
  b.dataset.era = name;
  b.onclick = pick;
  const [id, pair] = heraldry[name];
  const ns = 'http://www.w3.org/2000/svg';
  const art = document.createElementNS(ns, 'svg'), use = document.createElementNS(ns, 'use');
  art.classList.add('uc-era-crest');
  art.setAttribute('viewBox', '0 0 100 100');
  art.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', '/art/era-crests.svg#' + id);
  art.append(use);
  const caption = document.createElement('span');
  caption.textContent = name;
  b.append(art, caption);
  b.title = pair;
  return b;
}
