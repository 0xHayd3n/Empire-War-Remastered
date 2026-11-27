// Curated multiplayer map rotations for the four operation variants.
// Stock entries were read from the installed retail maps.meg (read-only): each has
// players >= 2, f3 >= 0, custom = 0 and the matching kind. Signal Lock entries all
// carry CONTROL in their map header tag.
import { variantOf } from './operationvariants.js';

// 2-player maps come first in every rotation. The two space modes and the two land
// modes use disjoint stock pools so each playlist has its own real rotation.
const CURATED = {
  'orbital-foundry': [
    '_MP_SPACE_GEONOSIS.TED', // 2p
    '_MP_SPACE_KESSEL.TED', // 2p
    '_MP_SPACE_BESPIN.TED', // 2p
    '_MP_SPACE_KUAT.TED', // 4p, shipyard
    '_MP_SPACE_CORUSCANT.TED', // 6p
    '_MP_SPACE_KASHYYYK.TED', // 6p
    '_MP_SPACE_THEMAW.TED' // 6p
  ],
  beachhead: [
    '_MP_LAND_ALDERAAN.TED', // 2p, no CONTROL
    '_MP_LAND_POLUS.TED', // 2p, no CONTROL
    '_MP_LAND_SHOLA.TED', // 2p, no CONTROL
    '_MP_LAND_RYLOTH.TED', // 3p, no CONTROL
    '_MP_LAND_DATHOMIR.TED', // 4p, no CONTROL
    '_MP_LAND_UTAPAU.TED' // 6p, no CONTROL
  ],
  'last-flight': [
    '_MP_SPACE_ENDOR.TED', // 2p
    '_MP_SPACE_POLUS.TED', // 2p
    '_MP_SPACE_HOTH.TED', // 8p
    '_MP_SPACE_YAVIN.TED', // 8p
    '_MP_SPACE_ALDERAAN.TED', // 6p
    '_MP_SPACE_FELUCIA.TED', // 6p
    '_MP_SPACE_NABOO.TED' // 4p
  ],
  'signal-lock': [
    '_MP_LAND_BOTHAWUI.TED', // 2p, CONTROL
    '_MP_LAND_SALEUCAMI.TED', // 2p, CONTROL
    '_MP_LAND_FELUCIA.TED', // 3p, CONTROL
    '_MP_LAND_BESPIN.TED', // 4p, CONTROL
    '_MP_LAND_KAMINO.TED', // 4p, CONTROL
    '_MP_LAND_NABOO.TED', // 4p, CONTROL
    '_MP_LAND_TATOOINE.TED', // 4p, CONTROL
    '_MP_LAND_YAVIN.TED', // 4p, CONTROL
    '_MP_LAND_ENDOR.TED' // 6p, CONTROL
  ]
};

const CAP = 9;
const MIN = 6;
const upper = name => String(name).toUpperCase();
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

function headerFor(mapHeader, name) {
  if (typeof mapHeader !== 'function') return null;
  try {
    return mapHeader(name) || mapHeader(upper(name)) || null;
  } catch {
    return null;
  }
}

function uniqueMounted(list) {
  const seen = new Set(),
    out = [];
  for (const name of list) {
    if (typeof name !== 'string' || !name) continue;
    const key = upper(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function eligible(header, spec) {
  if (!header) return false;
  const players = Number(header.players);
  if (!Number.isFinite(players) || players < 2) return false;
  if (header.f3 !== undefined && header.f3 !== null && Number(header.f3) < 0) return false;
  if (Number(header.kind) !== (spec.domain === 'land' ? 1 : 2)) return false;
  return (
    spec.type !== 'control' ||
    String(header.tag || '')
      .toUpperCase()
      .includes('CONTROL')
  );
}

/**
 * Return a stable, unique rotation of mounted map filenames for a variant.
 * `mapHeader(name)` must be synchronous and return { kind, players, f3?, tag?, custom? }.
 */
export function playlistPool(variant, options = {}) {
  const spec = variantOf(variant);
  if (!spec) return [];
  const { maps = [], landMaps = [], mapHeader } = options || {};
  const candidates = spec.domain === 'space' ? maps : landMaps;
  const mounted = uniqueMounted(Array.isArray(candidates) ? candidates : []);
  const byName = new Map(mounted.map(name => [upper(name), name]));
  const chosen = [];
  const seen = new Set();
  const take = name => {
    const key = upper(name);
    if (seen.has(key)) return;
    seen.add(key);
    chosen.push(name);
  };
  const isEligible = name => eligible(headerFor(mapHeader, name), spec);

  // Preferred: real stock names, matched case-insensitively to the exact mounted filename.
  for (const stock of CURATED[variant] || []) {
    const name = byName.get(upper(stock));
    if (name && isEligible(name)) take(name);
  }

  // Mod fallback only when stock cannot fill a useful rotation. Stock first, then
  // smaller player counts, then the caller's stable mounted order.
  if (chosen.length < MIN) {
    const fillers = mounted.filter(name => !seen.has(upper(name)) && isEligible(name));
    fillers.sort((a, b) => {
      const ha = headerFor(mapHeader, a),
        hb = headerFor(mapHeader, b);
      const stock = (Number(ha.custom) === 0 ? 0 : 1) - (Number(hb.custom) === 0 ? 0 : 1);
      if (stock) return stock;
      return Number(ha.players) - Number(hb.players);
    });
    for (const name of fillers) {
      if (chosen.length >= MIN) break;
      take(name);
    }
  }
  return chosen.slice(0, CAP);
}

const hash = text => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const mix = value => {
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
};

/** Deterministic up-to-three ballot choices. Room order also breaks no-vote ties. */
export function ballotSlate(pool, roomId) {
  const unique = uniqueMounted(Array.isArray(pool) ? pool : []);
  const n = unique.length;
  if (n <= 1) return unique;
  const seed = mix(hash('room:' + String(roomId ?? '')));
  const start = seed % n;
  let step = 1 + (mix(seed ^ 0x9e3779b9) % (n - 1));
  while (gcd(step, n) !== 1) step = (step % (n - 1)) + 1;
  return Array.from({ length: Math.min(3, n) }, (_, i) => unique[(start + i * step) % n]);
}
