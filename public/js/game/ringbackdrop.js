// Decorative land settings; no reference here is a battlefield selection.
import { commandColor } from './commandcolor.js';
const places = {
  'Galactic Republic': 'anaxes',
  'Galactic Empire': 'coruscant',
  Confederacy: 'geonosis',
  'Rebel Alliance / New Republic': 'yavin',
  'Sith Empire': 'korriban',
  'Hutt Cartel': 'nalhutta',
  'Mandalorian Clans': 'mandalore',
  'Pentastar Alignment': 'bastion',
  'Sith Warlords': 'korriban',
  'Sith Cultists': 'korriban',
  'Eriadu Authority': 'eriadu',
  'Hapes Consortium': 'hapes',
  'InterGalactic Banking Clan': 'muunilinst',
  'Trade Federation': 'naboo',
  'Techno Union': 'mustafar',
  'Commerce Guild': 'felucia',
  'Empire of the Hand': 'nirauan',
  'Chiss Ascendancy': 'csilla',
  Corellia: 'corellia',
  'Corporate Sector Authority': 'bonadan',
  'Zann Consortium': 'ryloth',
  'Black Sun': 'narshaddaa',
  'Criminal Underworld': 'narshaddaa',
  'Pirate Bands': 'florrum',
  'Yuuzhan Vong': 'helska',
  'Rakatan Remnants': 'lehon',
  'Ssi-ruuvi Imperium': 'lwhekk',
  'Independent Forces': 'dantooine',
  'Imperial Defectors': 'bastion',
  'Republic Sector Forces': 'anaxes',
  'Greater Maldrood': 'ordmantell',
  Warlords: 'ordmantell',
  Invaders: 'lehon',
  'Duskhan League': 'bastion',
  'Zsinj’s Empire': 'dathomir'
};
const person = {
  'Bastila Shan': 'dantooine',
  'Darth Revan': 'korriban',
  Yoda: 'geonosis',
  'Obi-Wan Kenobi': 'anaxes',
  'Count Dooku': 'serenno',
  'Han Solo': 'corellia',
  Gethzerion: 'dathomir',
  'Fenn Shysa': 'mandalore',
  'Luke Skywalker': 'tatooine',
  'Jabba the Hutt': 'tatooine',
  'Darth Vader': 'mustafar'
};
export function ringBackdrop(host) {
  const bg = document.createElement('div');
  bg.className = 'op-ring-scenery';
  bg.setAttribute('aria-hidden', 'true');
  host.prepend(bg);
  let generation = 0;
  function clear() {
    generation++;
    bg.replaceChildren();
  }
  return {
    clear,
    show(r) {
      const seq = ++generation,
        key = person[r.c.name] || places[r.family] || 'corellia',
        layer = document.createElement('div'),
        photo = document.createElement('div');
      layer.className = 'op-ring-layer';
      photo.className = 'op-ring-photo';
      layer.style.setProperty('--command-color', commandColor(r));
      layer.dataset.land = key;
      if (['bastion', 'csilla', 'florrum', 'lehon', 'nirauan'].includes(key)) photo.style.setProperty('--photo-opacity', '.5');
      layer.append(photo);
      bg.append(layer);
      const old = [...bg.children].filter(n => n !== layer);
      // Only two composited layers; a stale decode from a rapidly crossed roster
      // must not replace the current mood. The theater works offline without a photo.
      while (old.length > 1) old.shift().remove();
      void layer.offsetWidth;
      layer.classList.add('is-on');
      for (const n of old) {
        n.classList.remove('is-on');
        setTimeout(() => n.remove(), 400);
      }
      const img = new Image();
      img.decoding = 'async';
      img.src = '/api/command-land/' + key;
      img
        .decode()
        .then(() => {
          if (seq === generation) {
            photo.style.backgroundImage = `url("${img.src}")`;
            photo.classList.add('is-ready');
          }
        })
        .catch(() => {});
    }
  };
}
