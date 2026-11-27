// Original scalable redraws. The atlas selects them by verified source art,
// never by a commander's name or a mod's internal Empire/Rebel/Pirates key.
const alliance =
  '<path d="M50 4c3 7 7 12 13 16-8 1-12 7-11 17l2 18c1 7 7 8 13 2 10-10 11-26 3-42 15 11 23 27 22 42-2 23-21 38-42 39C29 95 10 80 8 57 7 42 15 26 30 15c-8 16-7 32 3 42 6 6 12 5 13-2l2-18c1-10-3-16-11-17 6-4 10-9 13-16z"/>';
const empire =
  '<circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="5"/>' +
  Array.from(
    { length: 6 },
    (_, i) => `<path transform="rotate(${i * 60 + 30} 50 50)" d="M46 8h8v7h9v4.5h-8v12l6 5-4 5.5-7-4-7 4-4-5.5 6-5v-12h-8V15h9z"/>`
  ).join('') +
  '<path fill-rule="evenodd" d="M50 30l17.32 10v20L50 70 32.68 60V40z M50 37l-11.26 6.5v13L50 63l11.26-6.5v-13z"/>';
const zann =
  '<path d="m38 5 8 5-14 14-8-6z M29 28l9 7-18 19 7 15L7 56z M27 52l12 5 2 14-15-8z M50 20l10 12-5 22-3 33-2 10-2-10-3-33-5-22z"/><path transform="translate(100 0) scale(-1 1)" d="m38 5 8 5-14 14-8-6z M29 28l9 7-18 19 7 15L7 56z M27 52l12 5 2 14-15-8z"/>';
// Six separate rim sections, a round hub and tapered spokes: this is the
// segmented variant, not the blue-and-silver stock medallion.
const polar = (r, a) =>
  [(50 + r * Math.sin((a * Math.PI) / 180)).toFixed(2), (50 - r * Math.cos((a * Math.PI) / 180)).toFixed(2)].join(' ');
const sector = `M${polar(46, 2)}A46 46 0 0 1 ${polar(46, 58)} L${polar(43, 58)}A43 43 0 0 0 ${polar(43, 46)}L${polar(39, 46)}A39 39 0 0 0 ${polar(39, 14)}L${polar(43, 14)}A43 43 0 0 0 ${polar(43, 2)}Z`;
const regime =
  '<circle cx="50" cy="50" r="15"/>' +
  Array.from({ length: 6 }, (_, i) => `<path transform="rotate(${i * 60} 50 50)" d="${sector}M45.5 18h9l-2.1 19h-4.8z"/>`).join('');
const devices = { alliance, empire, zann, regime };
// Eriadu and Maldrood are reverse stencils: the original white enamel
// becomes transparent, including the hub. The projector stays positive.
export function masterFaceSvg(key, ink) {
  if (!devices[key] || !/^#[0-9a-f]{6}$/i.test(ink)) return '';
  const body = key === 'regime'
    ? `<defs><mask id="cut"><circle cx="50" cy="50" r="50" fill="white"/><g fill="black">${regime}</g></mask></defs><circle cx="50" cy="50" r="50" fill="${ink}" mask="url(#cut)"/>`
    : `<g color="${ink}" fill="${ink}">${devices[key]}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="-1 -1 102 102">${body}</svg>`;
}
export function masterSvg(key, mask = false, field = '#223240') {
  const device = devices[key];
  if (!device) return '';
  const [light, dark] = key === 'alliance' ? ['#ff7969', '#bc2531'] : key === 'empire' ? ['#f9f5e6', '#b4c5d5'] : ['#ffdb61', '#da8b0a'];
  if (key === 'regime')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="-1 -1 102 102">${mask ? '' : `<circle cx="50" cy="50" r="50" fill="${field}"/>`}<g fill="#fafafa">${device}</g></svg>`;
  const base = key === 'empire' && !mask ? '<circle cx="50" cy="50" r="47" fill="#264a7d" stroke="#172c46" stroke-width="2"/>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 100 100"><defs><linearGradient id="enamel" x2="0" y2="1"><stop stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>${base}<g color="${mask ? 'white' : light}" fill="${mask ? 'white' : 'url(#enamel)'}">${device}</g></svg>`;
}
