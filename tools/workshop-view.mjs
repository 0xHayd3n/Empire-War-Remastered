const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const collectionUrl = n => `/?collection=${n}`;

// Collection browsing works without scripts. Only explicit POST buttons change the game session.
export function workshopPage(lib, url, active) {
  const { cards, items } = lib;
  const indexed = cards.map((card, n) => ({ card, n }));
  const collections = indexed.filter(({ card }) => card.saved);
  const misc = indexed.filter(({ card }) => !card.saved);
  const param = url.searchParams.get('collection');
  const picked = param !== null && /^\d+$/.test(param) ? indexed[Number(param)] : null;
  const selected = picked?.card.saved ? picked : null;
  const q = (url.searchParams.get('q') || '').trim().slice(0, 120);
  const all = !selected && (url.searchParams.has('all') || !!q || !collections.length);
  const featured = selected || collections.find(({ n }) => n === active?.n) || collections.find(({ card }) => items.get(card.primary)?.scene) || collections[0];
  const label = id => {
    const item = items.get(id);
    if (!item) return `Missing item ${id}`;
    const base = collections.find(({ card }) => card.primary === id);
    return item.name === `Workshop ${id}` && base ? base.card.name : item.name;
  };
  const badge = (id, name) => `<span class="icon" aria-hidden="true">${items.get(id)?.art ? `<img src="/icon/${esc(id)}" alt="" loading="lazy">` : esc(name.trim()[0] || '◆')}</span>`;
  const scene = (id, cls) => (items.get(id)?.backdrop || items.get(id)?.scene) ? `<img class="${cls}" src="/scene/${esc(id)}" alt="" decoding="async">` : '';
  const wordmark = (card, cls) => items.get(card.primary)?.wordmark
    ? `<img class="${cls}" src="/wordmark/${esc(card.primary)}" alt="${esc(card.name)}">`
    : `<span class="text-mark">${esc(card.name)}</span>`;
  const tile = entry => {
    const { card, n } = entry;
    return `<a class="tile" href="${collectionUrl(n)}" ${entry === featured ? 'aria-current="page"' : ''}>${wordmark(card, 'tile-mark')}</a>`;
  };
  const play = (entry, quick = false) => {
    const { card, n } = entry;
    const blocked = card.problem || (active && active.n !== n);
    const verb = active?.n === n ? 'Open game' : 'Launch';
    return `<form class="${quick ? 'quick' : 'launch'}" method="post" action="/play/${n}"><button aria-label="${verb} ${esc(card.name)}" ${blocked ? 'disabled' : ''}>${quick ? '<span aria-hidden="true">▷</span>' : `${verb} <span aria-hidden="true">▸</span>`}</button></form>`;
  };
  const members = card => [...card.order, ...card.disabled];
  const status = (card, id) => {
    const rank = card.order.indexOf(id);
    return rank < 0 ? '<span class="state off">Off</span>' : `<span class="state">#${rank + 1}</span>`;
  };
  const cardRow = entry => {
    const { card, n } = entry;
    return `<div class="card ${!all && featured === entry ? 'current' : ''}"><div class="card-head"><a class="select" href="${collectionUrl(n)}" ${!all && featured === entry ? 'aria-current="page"' : ''}>${wordmark(card, 'list-mark')}</a>${play(entry, true)}</div><details class="members"><summary aria-label="Show or hide members of ${esc(card.name)}" title="Show or hide collection members">⌄</summary><ol>${[card.primary, ...members(card).filter(id => id !== card.primary)].map(id => `<li>${badge(id,label(id))}<span>${esc(label(id))}</span>${status(card,id)}</li>`).join('')}</ol></details></div>`;
  };
  const deck = entry => {
    const { card } = entry, index = collections.indexOf(entry), count = collections.length;
    return `<section class="hero"><div class="seq">Collection ${String(index+1).padStart(2,'0')} / ${String(count).padStart(2,'0')}</div><h1>${wordmark(card, 'hero-mark')}</h1><div class="actions">${play(entry)}<details class="order"><summary>Enabled mods <b>${card.order.length}</b></summary><div class="flyout"><h3>Launch priority</h3><ol>${members(card).map(id => `<li>${status(card,id)}<span>${esc(label(id))}</span></li>`).join('')}</ol></div></details></div>${card.problem ? `<p class="notice">${esc(card.problem)}</p>` : ''}</section>`;
  };
  const ids = selected ? members(selected.card) : [...items.keys()].sort((a,b) => label(a).localeCompare(label(b)));
  const rows = ids.flatMap(id => {
    const name = label(id), links = collections.filter(({ card }) => members(card).includes(id));
    if (!`${name} ${id} ${links.map(({ card }) => card.name).join(' ')}`.toLowerCase().includes(q.toLowerCase())) return [];
    const single = misc.find(({ card }) => card.primary === id);
    return [`<li class="mod" data-id="${esc(id)}">${badge(id,name)}<div class="identity"><strong>${esc(name)}</strong><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=${esc(id)}" target="_blank" rel="noopener noreferrer">Workshop · ${esc(id)}</a></div><div class="tags">${selected ? status(selected.card,id) : links.map(({ card, n }) => `<a href="${collectionUrl(n)}">${esc(card.name)}${card.disabled.includes(id) ? ' · off' : ''}</a>`).join('')}</div>${single ? play(single,true) : ''}</li>`];
  });
  const inventory = `<section class="inventory" id="inventory"><h2>${selected ? 'Collection members' : 'All installed mods'}</h2><form class="search" method="get" action="/"><input type="hidden" ${selected ? `name="collection" value="${selected.n}"` : 'name="all" value="1"'}><input type="search" aria-label="Search installed mods" placeholder="Search mods, collections or Workshop IDs" name="q" value="${esc(q)}" maxlength="120"><button>Search</button></form><small>${rows.length} ${q ? 'matches' : 'items'}</small><ul>${rows.join('') || '<li>No matching mods.</li>'}</ul>${!selected && [...items.keys()].some(id => label(id) === `Workshop ${id}`) ? '<form method="post" action="/titles"><button>Look up Steam titles</button> <small>Sends unnamed item IDs to Steam.</small></form>' : ''}${url.searchParams.get('names') === 'unavailable' ? '<p>Steam is unavailable. Your installed mods are still here.</p>' : ''}</section>`;
  const music = !all && items.get(featured?.card.primary)?.theme;
  const sound = music ? `<audio id="theme-audio" src="/theme/${esc(featured.card.primary)}" autoplay loop></audio>` : '';
  const chooser = `<details class="chooser"><summary>Library tools <span>⌄</span></summary><div class="flyout"><nav aria-label="Saved collections">${collections.map(cardRow).join('') || 'No saved collections.'}</nav><details class="misc"><summary>Misc mods · ${misc.length}</summary>${misc.map(e=>`<div>${esc(e.card.name)}${play(e,true)}</div>`).join('') || 'No unassigned mods.'}</details><form method="post" action="/refresh"><button ${active ? 'disabled' : ''}>↻ Refresh library</button></form></div></details>`;
  const session = active ? `<section class="session"><span>${esc(cards[active.n].name)} is running</span><a href="${esc(active.url)}">Open game</a><a href="${esc(new URL('viewer.html', active.url).href)}">Model viewer</a><form method="post" action="/end"><button title="Save in the game before ending the session">End session</button></form></section>` : '';
  const primary = featured?.card.primary;
  const effect = items.get(primary)?.effect || 'still';
  const particles = effect === 'embers' || effect === 'storm' ? '<i></i>'.repeat(12) : '';
  const stage = !all ? `<div class="scene ${esc(effect)}" aria-hidden="true">${scene(primary, 'backdrop')}<div class="weather">${particles}</div></div>` : '';
  const step = direction => {
    if (collections.length < 2) return '';
    const next = collections[(collections.indexOf(featured) + direction + collections.length) % collections.length];
    const label = direction < 0 ? 'Previous' : 'Next';
    return `<a class="carousel-step" aria-label="${label} collection: ${esc(next.card.name)}" href="${collectionUrl(next.n)}">${direction < 0 ? '‹' : '›'}</a>`;
  };
  const footer = `<footer><nav class="carousel" aria-label="Switch collection">${step(-1)}<div class="tiles">${collections.map(tile).join('')}</div>${step(1)}</nav></footer>`;
  const browser = `<details class="browse" ${q ? 'open' : ''}><summary>Browse ${selected ? 'members' : 'installed mods'}</summary>${inventory}</details>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Collections · Empire War Remastered</title><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/launcher.css"><script defer src="/selector.js"></script></head>
<body class="${all ? 'library' : 'cinema'}">${stage}${sound}<header>${all && collections.length ? '<a href="/">← Collection selector</a>' : ''}${chooser}<a class="library-link" href="/?all=1">All installed mods <b>${items.size}</b></a>${music ? '<p class="theme-policy" role="status" hidden>Click or press a key to hear the theme.</p>' : ''}</header>
<main>${session}${all ? inventory : deck(featured) + browser}${!lib.game ? '<p>Game installation not found.</p>' : ''}${lib.skipped ? `<p>${lib.skipped} unsupported or incomplete profiles skipped.</p>` : ''}</main>${all ? '' : footer}</body></html>`;
}
