// Hand-authored discovery labels for supported mods, including first-time installs.
// These describe map lines, not playable starts. No generated atlas, year, world
// count, launch ID, install URL, or mod assets belong in this directory.
const sizes = ['Large', 'Medium', 'Small'];
const listings = {
  1976399102: {
    dated: [
      ['The Clone Wars', sizes],
      ['Known Galaxy', sizes],
      'Hunt for the Malevolence',
      'Rimward Campaign',
      'Tennuutta Skirmishes',
      'Operation: Knight Hammer',
      'Operation: Durge’s Lance',
      'Foerost Campaign',
      'Outer Rim Sieges',
      'From the Ground Up'
    ],
    Miscellaneous: ['Custom Galactic Conquest']
  },
  3387971722: {
    Story: [['Awakening of the Clone Wars', ['Full Campaign', 'Full Big Campaign', 'Lite Big Campaign']]],
    Random: [['Awakening of the Clone Wars', ['Full Random', 'Full Random · Big']]],
    Sandbox: ['Full Canon Layout', ['Grand Layout', ['Full', 'Lite']]]
  },
  3417277973: {
    dated: ['Known Galaxy', 'From the Ground Up'],
    Miscellaneous: [
      'Outer Rim Wars',
      'Mandalorian Onslaught',
      'Mandalorian Triumph',
      'Collapse of the Core',
      'From the Ground Up',
      'Custom Galactic Conquest'
    ]
  },
  1125571106: {
    dated: [
      'From the Ground Up',
      ['Full Galaxy', sizes],
      ['Known Galaxy', sizes],
      'Corporate Acquisitions',
      'Deep Core Conflict',
      'Western Reaches',
      'Borderlands',
      'Stars Align'
    ],
    Miscellaneous: [
      'Galactic Conquest Selection Menu',
      'Fleet Builder',
      'Survival',
      'Lambda Sector',
      'Bacta War',
      'Thrawn',
      'Isard’s Revenge',
      'Shadow Hand',
      'Crimson Empire',
      'Reunification',
      'Orinda',
      'Final Imperial Push',
      'Caamas'
    ]
  },
  1397421866: {
    Story: [
      ['Galactic Civil War', ['Intro Campaign', 'Intro Campaign · Classic', 'Intro Campaign · Big']],
      ['Awakening of the Rebellion', ['Full Campaign', 'Full Campaign · Classic', 'Full Campaign · Big', 'Lite Campaign · Big']],
      'Awakening of the New Republic'
    ],
    Random: [
      'Standard Layout',
      'Northern Worlds',
      'Southern Worlds',
      'Legacy Layout',
      'Legacy Outerrim Layout',
      'Grand Layout',
      'Lite Grand Layout',
      'Grand Galactic North',
      'Grand Galactic South',
      'Grand Galactic Center'
    ],
    Sandbox: ['Liberation of Mon Cala', 'Endor’s Eve', 'Outer Rim Tug of War', 'Galactic North', 'Galactic South', 'Galactic Center'],
    Miscellaneous: ['Tutorial Campaign']
  },
  1770851727: { Miscellaneous: [['Imperial Web Way', ['Lite', 'Standard', 'Grand']], 'Beginner Web Way', 'AI Imperial Web Way'] }
};
export function discoveryRows(mod, reason) {
  return Object.entries(listings[mod.id] || {}).flatMap(([kind, names]) =>
    names.map(name => {
      const [title, versions = []] = Array.isArray(name) ? name : [name];
      return { mod, title, versions, reason, section: kind === 'dated' ? '' : kind };
    })
  );
}
// Never insert discovery rows into a period's maps or any launch data. A missing-only
// mode has a view to browse, but no starting period or invented calendar stop.
export function browsePeriods(periods, offers) {
  const views = [...periods];
  for (const scenario of [false, true])
    if (!views.some(p => p.scenario === scenario) && offers.some(o => Boolean(o.section) === scenario))
      views.push({ scenario, discovery: true, maps: new Map() });
  return views;
}
export function submodPage(offer, invoker) {
  const d = document.createElement('dialog');
  d.className = 'uc-submod-page';
  d.setAttribute('aria-labelledby', 'uc-required-mod');
  d.innerHTML =
    '<small>Submods · Preview</small><h2 id="uc-required-mod"></h2><p></p><p>This is a placeholder for the submod page. Downloads are not available here yet.</p><button type="button" autofocus>Close</button>';
  d.querySelector('h2').textContent = offer.mod.name;
  d.querySelector('p').textContent = `${offer.title} requires ${offer.mod.name}. ${offer.reason}.`;
  if (offer.versions.length) {
    const names = document.createElement('ul');
    for (const version of offer.versions) {
      const li = document.createElement('li');
      li.textContent = version;
      names.append(li);
    }
    d.querySelector('p').after(names);
  }
  d.querySelector('button').onclick = () => d.close();
  d.onclose = () => {
    d.remove();
    if (invoker.isConnected) invoker.focus({ preventScroll: true });
  };
  invoker.closest('dialog').append(d);
  d.showModal();
}
