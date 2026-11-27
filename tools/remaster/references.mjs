/**
 * Planet reference intake (private creator workbench).
 *
 * Candidates for human visual review, not approval. This module only reads a
 * tiny allowlist of first-party HTTPS pages (starwars.com and its image CDN),
 * never follows redirects to other hosts, never ships or registers art, and
 * writes everything under the caller's temp home. It exists so ground and
 * foliage decisions start from observed references instead of assumed ones.
 *
 * Public API:
 *   collectReferences(job, planet, home, options?) -> report
 *   collectManyReferences(job, planets, home, options?) -> aggregate report
 *
 * `options` is for tests/embedded use only: { fetch, now }.
 */
import fs from 'node:fs';
import {narrativeCaption,builtCue} from './place-evidence.mjs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const FORMAT = 1;
export const VERSION = '1.1.0';
export const DEFAULT_HOME = path.join(os.tmpdir(), 'planet-reference-intake-v1');

const SITEMAP_URL = 'https://www.starwars.com/sitemap.xml';
const PAGE_HOSTS = new Set(['www.starwars.com', 'starwars.com']);
const IMAGE_HOSTS = new Set(['lumiere-a.akamaihd.net']);
// starwars.com/robots.txt. Pages are fetched without cookies or query strings.
const ROBOTS_DENY = [
  '/search',
  '/7046/',
  '/products/',
  '/_xd/',
  '/news/page/',
  '/wp-content/plugins/',
  '/watch/hls/',
  '/watch/captions/',
  '/embed',
  '/app',
  '/21783347309/'
];

export const DEFAULT_LIMITS = Object.freeze({
  maxPlanets: 8,
  maxRequests: 24,
  maxRedirects: 3,
  maxPageBytes: 8 * 1024 * 1024,
  maxSitemapBytes: 6 * 1024 * 1024,
  maxImageBytes: 3.5 * 1024 * 1024,
  maxImages: 12,
  maxTotalImageBytes: 20 * 1024 * 1024,
  maxSeconds: 45,
  minImageWidth: 480,
  minImageHeight: 240,
  cachePageTtlMs: 6 * 60 * 60 * 1000,
  cacheSitemapTtlMs: 24 * 60 * 60 * 1000,
  cacheAssetTtlMs: 30 * 24 * 60 * 60 * 1000
});

const ASPECT_TERMS = {
  ground: {
    strong: [
      'ground',
      'grounds',
      'soil',
      'soils',
      'dirt',
      'earth',
      'terrain',
      'terrains',
      'landscape',
      'landscapes',
      'rock',
      'rocks',
      'rocky',
      'stone',
      'stones',
      'cliff',
      'cliffs',
      'canyon',
      'canyons',
      'sand',
      'sands',
      'snow',
      'ice',
      'desert',
      'deserts',
      'plain',
      'plains',
      'prairie',
      'steppe',
      'mud',
      'ash',
      'lava',
      'floor',
      'floors',
      'surface',
      'surfaces',
      'valley',
      'valleys',
      'hill',
      'hills',
      'mountain',
      'mountains',
      'beach',
      'beaches',
      'shore',
      'shores',
      'coast',
      'coastline',
      'riverbank',
      'crater',
      'craters',
      'grassland',
      'grasslands',
      'grass',
      'gravel',
      'dust',
      'cave',
      'caves'
    ],
    weak: [
      'world',
      'worlds',
      'moon',
      'moons',
      'planet',
      'planets',
      'land',
      'lands',
      'landed',
      'environment',
      'environments',
      'scenery',
      'jungle',
      'jungles',
      'forest',
      'forests',
      'woods',
      'woodland',
      'woodlands',
      'vegetation'
    ]
  },
  foliage: {
    strong: [
      'jungle',
      'jungles',
      'forest',
      'forests',
      'tree',
      'trees',
      'foliage',
      'vegetation',
      'plant',
      'plants',
      'canopy',
      'undergrowth',
      'leaf',
      'leaves',
      'fern',
      'ferns',
      'moss',
      'vine',
      'vines',
      'woodland',
      'woodlands',
      'woods',
      'grove',
      'groves',
      'bush',
      'bushes',
      'swamp',
      'swamps',
      'marsh',
      'treetop',
      'treetops',
      'lush',
      'green'
    ],
    weak: ['grass', 'grassland', 'grasslands']
  }
};

const CHROME_ALT =
  /^(tiktok|star wars logo|star wars kids|local nav|facebook|instagram|twitter|youtube|close|menu|search)$/i;
const SPACE_CONTEXT =
  /\b(?:space|orbit|orbital|orbiting|starfighter|starfighters|warship|warships|fleet|superlaser|turbolaser|skies|atmosphere)\b|\b(?:death star|battle station|tie fighter|tie fighters|star destroyer|x-wing|x-wings|y-wing|y-wings)\b/i;
const EXPLICIT_SURFACE =
  /\b(?:ground|soil|floor|surface|terrain|landscape|rock|stone|sand|snow|ice|lava|mud|dirt|earth)\b/i;
const CHROME_STEM =
  /(?:^|[-_])(logo|logos|favicon|icon|icons|tiktok|facebook|instagram|twitter|youtube|sprite|badge|avatar|placeholder|nav|close|background-stars|galaxy-map|og-generic)(?:[-_.]|$)/i;
const HANDLED_IMAGE = /\.(jpe?g|png|webp)$/i;
const STOP_WORDS = new Set([
  'the',
  'and',
  'of',
  'a',
  'an',
  'world',
  'worlds',
  'planet',
  'planets',
  'moon',
  'moons',
  'system',
  'systems',
  'prime',
  'major',
  'minor',
  'sector',
  'space',
  'station'
]);

export class ReferenceIntakeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReferenceIntakeError';
    this.code = code;
    this.details = details;
  }
}

class BudgetStop extends ReferenceIntakeError {
  constructor(code, message, details = {}) {
    super(code, message, details);
    this.name = 'BudgetStop';
  }
}

const sha256 = value => createHash('sha256').update(value).digest('hex');
const unique = values => [...new Set(values)];

function decodeEntities(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, code) => {
    const lower = String(code).toLowerCase();
    if (lower.startsWith('#x')) {
      const n = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    if (lower.startsWith('#')) {
      const n = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return (
      {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
        ndash: '-',
        mdash: '-',
        hellip: '...',
        rsquo: "'",
        lsquo: "'",
        ldquo: '"',
        rdquo: '"'
      }[lower] ?? match
    );
  });
}

function text(value, max = 1200) {
  return decodeEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalized(value) {
  return text(value, 400)
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function keyOf(value) {
  return normalized(value)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function wordsOf(value) {
  return normalized(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function positiveInt(value, fallback, max) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

function sanitizeLimits(input) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    ...DEFAULT_LIMITS,
    maxRequests: positiveInt(raw.maxRequests, DEFAULT_LIMITS.maxRequests, 24),
    maxRedirects: positiveInt(raw.maxRedirects, DEFAULT_LIMITS.maxRedirects, 3),
    maxPageBytes: positiveInt(raw.maxPageBytes, DEFAULT_LIMITS.maxPageBytes, 16 * 1024 * 1024),
    maxSitemapBytes: positiveInt(raw.maxSitemapBytes, DEFAULT_LIMITS.maxSitemapBytes, 12 * 1024 * 1024),
    maxImageBytes: positiveInt(raw.maxImageBytes, DEFAULT_LIMITS.maxImageBytes, 8 * 1024 * 1024),
    maxImages: positiveInt(raw.maxImages, DEFAULT_LIMITS.maxImages, 12),
    maxTotalImageBytes: positiveInt(
      raw.maxTotalImageBytes,
      DEFAULT_LIMITS.maxTotalImageBytes,
      40 * 1024 * 1024
    ),
    maxSeconds: positiveInt(raw.maxSeconds, DEFAULT_LIMITS.maxSeconds, 90),
    minImageWidth: positiveInt(raw.minImageWidth, DEFAULT_LIMITS.minImageWidth, 4096),
    minImageHeight: positiveInt(raw.minImageHeight, DEFAULT_LIMITS.minImageHeight, 4096)
  };
}

function parsePlanet(input) {
  const base = typeof input === 'string' ? { name: input } : input;
  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    throw new ReferenceIntakeError(
      'REFERENCE_INTAKE_PLANET',
      'Give a planet name or object, for example "Yavin 4" or { name: "Yavin 4" }.'
    );
  }
  const name = text(base.name ?? base.planet ?? base.title, 120);
  if (!name || name.length < 2) {
    throw new ReferenceIntakeError('REFERENCE_INTAKE_PLANET', 'A planet needs a readable name.');
  }
  const key = keyOf(base.id || name);
  if (!key) throw new ReferenceIntakeError('REFERENCE_INTAKE_PLANET', 'Planet name has no usable letters.');
  const aliases = unique(
    [
      ...(Array.isArray(base.aliases) ? base.aliases : []),
      typeof base.alias === 'string' ? base.alias : null,
      ...(Array.isArray(base.names) ? base.names : [])
    ]
      .map(v => text(v, 120))
      .filter(Boolean)
  ).filter(v => keyOf(v) !== key);
  const terrains = unique(
    [...(Array.isArray(base.terrains) ? base.terrains : []), base.terrain]
      .flat()
      .map(v => text(v, 80))
      .filter(Boolean)
  );
  const climates = unique(
    [...(Array.isArray(base.climates) ? base.climates : []), base.climate]
      .flat()
      .map(v => text(v, 80))
      .filter(Boolean)
  );
  const tokens = unique([
    ...wordsOf(name).filter(w => w.length >= 3 && !STOP_WORDS.has(w)),
    ...aliases.flatMap(a => wordsOf(a).filter(w => w.length >= 3 && !STOP_WORDS.has(w)))
  ]);
  if (!tokens.length) tokens.push(key);
  return {
    name,
    key,
    aliases,
    terrains,
    climates,
    tokens,
    limits: sanitizeLimits(base.limits)
  };
}

function slugVariants(planet) {
  const out = new Set([planet.key, ...planet.aliases.map(keyOf)]);
  for (const value of [...out]) {
    const stripped = value.replace(/-\d+$/, '');
    if (stripped) out.add(stripped);
  }
  return [...out].filter(Boolean);
}

function inferAspects(value) {
  const words = new Set(wordsOf(value));
  const result = {};
  for (const [aspect, tiers] of Object.entries(ASPECT_TERMS)) {
    const hits = { strong: [], weak: [] };
    for (const tier of ['strong', 'weak'])
      for (const term of tiers[tier]) if (words.has(term)) hits[tier].push(term);
    if (hits.strong.length || hits.weak.length) result[aspect] = hits;
  }
  return result;
}

function aspectStrength(hits) {
  const out = {};
  for (const [aspect, tiers] of Object.entries(hits || {})) {
    if (tiers.strong?.length) out[aspect] = 'strong';
    else if (tiers.weak?.length) out[aspect] = 'weak';
  }
  return out;
}

function hasPlanetToken(value, planet) {
  const words = new Set(wordsOf(value));
  return planet.tokens.filter(token => words.has(token));
}

function isIpish(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  return (
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    host.includes(':') ||
    /^0x/i.test(host) ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  );
}

function checkedUrl(value, base, { image = false } = {}) {
  let url;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    throw new ReferenceIntakeError('REFERENCE_INTAKE_URL', `Not a valid URL: ${text(value, 160)}`);
  }
  if (url.protocol !== 'https:') {
    throw new ReferenceIntakeError('REFERENCE_INTAKE_URL', `Only HTTPS is allowed: ${url.href}`);
  }
  if (url.username || url.password) {
    throw new ReferenceIntakeError('REFERENCE_INTAKE_URL', 'URLs with credentials are refused.');
  }
  if (url.port && url.port !== '443') {
    throw new ReferenceIntakeError('REFERENCE_INTAKE_URL', `Non-standard port refused: ${url.href}`);
  }
  const host = url.hostname.toLowerCase();
  if (isIpish(host)) {
    throw new ReferenceIntakeError('REFERENCE_INTAKE_URL', `Private or literal address refused: ${host}`);
  }
  const allow = image ? IMAGE_HOSTS : PAGE_HOSTS;
  if (!allow.has(host)) {
    throw new ReferenceIntakeError('REFERENCE_INTAKE_HOST', `Host is not on the first-party allowlist: ${host}`);
  }
  if (!image) {
    if (url.search) {
      throw new ReferenceIntakeError('REFERENCE_INTAKE_URL', `Query-string pages are not fetched: ${url.pathname}`);
    }
    if (ROBOTS_DENY.some(prefix => url.pathname === prefix || url.pathname.startsWith(prefix))) {
      throw new ReferenceIntakeError('REFERENCE_INTAKE_URL', `Path is disallowed by robots.txt: ${url.pathname}`);
    }
  }
  return url;
}

function normalizeImageUrl(value, pageUrl) {
  const url = checkedUrl(value, pageUrl, { image: true });
  const base = new URL(url.origin + url.pathname);
  if (!/^\/v1\/images\/[\w.\-%()+]+\.(?:jpe?g|png|webp)$/i.test(base.pathname)) {
    throw new ReferenceIntakeError('REFERENCE_INTAKE_IMAGE_URL', `Unsupported image path: ${base.pathname}`);
  }
  const stem = path.posix.basename(base.pathname).toLowerCase();
  if (CHROME_STEM.test(stem) || /og-generic|placeholder|sprite/.test(stem)) {
    throw new ReferenceIntakeError('REFERENCE_INTAKE_CHROME', `Page chrome image skipped: ${stem}`);
  }
  return { found: url.href, base: base.href, stem };
}

function parseAttrs(tag) {
  const attrs = {};
  for (const match of String(tag).matchAll(
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  )) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function bestSrcset(value) {
  let best = null;
  let bestWeight = -1;
  for (const part of String(value || '').split(',')) {
    const [url, descriptor = ''] = part.trim().split(/\s+/);
    if (!url) continue;
    const weight = Number((/(\d+)(?:w|x)$/.exec(descriptor) || [])[1] || 0);
    if (weight > bestWeight) {
      best = url;
      bestWeight = weight;
    }
  }
  return best;
}

function parseMeta(html) {
  const meta = {};
  for (const match of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttrs(match[0]);
    const name = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (name && attrs.content !== undefined) meta[name] = text(attrs.content, 1200);
  }
  const titleMatch = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return {
    title: meta['og:title'] || (titleMatch ? text(titleMatch[1], 200) : ''),
    description: meta['og:description'] || meta.description || '',
    ogImage: meta['og:image'] || ''
  };
}

function jsonArrayField(source, name) {
  const match = new RegExp(`"${name}"\\s*:\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!match) return [];
  return unique(
    [...match[1].matchAll(/"([^"]+)"/g)].map(m => text(m[1], 80)).filter(Boolean)
  );
}

function parseDatabankRecord(html, slug, planet, meta) {
  // The record is JSON embedded in the page. Unescape quotes once and scope to
  // this record so related cards cannot supply another planet's image.
  const plain = String(html).replace(/\\"/g, '"');
  const marker = `"content_path":"/databank/${slug}"`;
  const index = plain.indexOf(marker);
  const scope =
    index >= 0 ? plain.slice(Math.max(0, index - 90000), index + 90000) : plain;
  const asset = /"image_asset"\s*:\s*\{[\s\S]{0,2200}?"base_url"\s*:\s*"(https:\/\/lumiere-a\.akamaihd\.net\/v1\/images\/[^"]+)"[\s\S]{0,1000}?"sha"\s*:\s*"([0-9a-f]{40})"/.exec(
    scope
  );
  let imageUrl = asset?.[1] || '';
  if (
    !imageUrl &&
    meta.ogImage &&
    /\/v1\/images\/[^?]*databank_/i.test(meta.ogImage)
  ) {
    imageUrl = meta.ogImage;
  }
  return {
    slug,
    pageUrl: `https://www.starwars.com/databank/${slug}`,
    title: meta.title,
    description: meta.description,
    terrains: jsonArrayField(scope, 'terrains'),
    climates: jsonArrayField(scope, 'climates'),
    imageUrl,
    catalogueSha: asset?.[2] || null
  };
}

function buildCatalogue(locs) {
  const databank = new Map();
  const galleries = new Map();
  const news = [];
  for (const raw of locs) {
    let url;
    try {
      url = checkedUrl(raw);
    } catch {
      continue;
    }
    const pathname = url.pathname.replace(/\/+$/, '');
    const record = /^\/databank\/([a-z0-9-]+)$/.exec(pathname);
    if (record) databank.set(record[1], url.href);
    const gallery = /^\/([a-z0-9-]+?)-(?:history|location)-gallery$/.exec(pathname);
    if (gallery) galleries.set(gallery[1], url.href);
    if (pathname.startsWith('/news/')) news.push(url.href);
  }
  return { databank, galleries, news };
}

function matchRecord(catalogue, planet) {
  if (!catalogue) return null;
  const slugs = slugVariants(planet);
  for (const slug of slugs)
    if (catalogue.databank.has(slug))
      return { slug, url: catalogue.databank.get(slug), method: 'exact' };
  const scored = [...catalogue.databank]
    .map(([slug, url]) => {
      const parts = slug.split('-');
      let score = 0;
      for (const variant of slugs) {
        if (slug === variant) score += 100;
        else if (slug.startsWith(`${variant}-`)) score += 8;
        else if (parts.includes(variant)) score += 4;
      }
      if (slug.includes('-melon') || slug.includes('-cookie')) score -= 20;
      return { slug, url, score };
    })
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return scored[0] ? { ...scored[0], method: 'fuzzy' } : null;
}

function matchGallery(catalogue, planet, record) {
  if (!catalogue) return null;
  const slugs = unique([record?.slug, ...slugVariants(planet)].filter(Boolean));
  for (const slug of slugs) if (catalogue.galleries.has(slug)) return catalogue.galleries.get(slug);
  return null;
}

function matchNews(catalogue, planet, limit = 2) {
  if (!catalogue) return [];
  const tokens = new Set(planet.tokens);
  return catalogue.news
    .map(url => {
      const pathname = new URL(url).pathname.toLowerCase();
      const words = pathname.split(/[^a-z0-9]+/);
      const hit = [...tokens].some(token => words.includes(token));
      const preference = /history|behind-the-scenes|location|planet|world|gallery/.test(pathname)
        ? 2
        : 0;
      return { url, hit, preference };
    })
    .filter(row => row.hit && !/\/news\/tag\//.test(row.url))
    .sort((a, b) => b.preference - a.preference || a.url.localeCompare(b.url))
    .slice(0, limit)
    .map(row => row.url);
}

function imageInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { type: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buffer.length) {
      if (buffer[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buffer[i + 1];
      if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break;
      if (i + 4 > buffer.length) break;
      const length = buffer.readUInt16BE(i + 2);
      if (length < 2) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return {
          type: 'jpeg',
          height: buffer.readUInt16BE(i + 5),
          width: buffer.readUInt16BE(i + 7)
        };
      }
      i += 2 + length;
    }
    return { type: 'jpeg', width: null, height: null };
  }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const kind = buffer.toString('ascii', 12, 16);
    if (kind === 'VP8X') {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return { type: 'webp', width, height };
    }
    return { type: 'webp', width: null, height: null };
  }
  return null;
}

class DiskCache {
  constructor(root, limits, now) {
    this.root = root;
    this.limits = limits;
    this.now = now;
  }

  fileFor(url, ext) {
    return path.join(this.root, sha256(url) + ext);
  }

  async read(url) {
    try {
      const meta = JSON.parse(await fsp.readFile(this.fileFor(url, '.json'), 'utf8'));
      if (meta?.url !== url) return null;
      const body = await fsp.readFile(this.fileFor(url, '.bin'));
      return { body, meta, fresh: this.now() < meta.expiresAt };
    } catch {
      return null;
    }
  }

  async write(url, kind, body, meta) {
    await fsp.mkdir(this.root, { recursive: true });
    const ttl =
      kind === 'image'
        ? this.limits.cacheAssetTtlMs
        : kind === 'sitemap'
          ? this.limits.cacheSitemapTtlMs
          : this.limits.cachePageTtlMs;
    const record = {
      url,
      kind,
      fetchedAt: this.now(),
      expiresAt: this.now() + ttl,
      bytes: body.length,
      ...meta
    };
    const base = this.fileFor(url, '');
    await writeAtomic(base + '.bin', body);
    await writeAtomic(base + '.json', JSON.stringify(record, null, 2) + '\n');
  }
}

async function writeAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}`;
  await fsp.writeFile(tmp, data);
  await fsp.rm(file, { force: true }).catch(() => {});
  await fsp.rename(tmp, file);
}

class RunContext {
  constructor({ planet, job, home, options }) {
    this.planet = planet;
    this.job = job;
    this.home = home;
    this.limits = planet.limits;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.fetchImpl = options.fetch || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new ReferenceIntakeError('REFERENCE_INTAKE_FETCH', 'This Node runtime has no fetch().');
    }
    this.cache = new DiskCache(path.join(home, 'http-cache'), this.limits, this.now);
    this.started = this.now();
    this.deadline = this.started + this.limits.maxSeconds * 1000;
    this.requestCount = 0;
    this.requests = [];
    this.warnings = [];
    this.bytesDownloaded = 0;
  }

  warn(message) {
    if (message && !this.warnings.includes(message)) this.warnings.push(message);
  }

  msLeft() {
    return this.deadline - this.now();
  }

  async takeRequest(url, kind) {
    if (this.requestCount >= this.limits.maxRequests) {
      throw new BudgetStop(
        'REFERENCE_INTAKE_REQUEST_BUDGET',
        `Stopped after ${this.limits.maxRequests} requests while gathering ${this.planet.name} references.`
      );
    }
    const left = this.msLeft();
    if (left < 500) {
      throw new BudgetStop(
        'REFERENCE_INTAKE_TIMEOUT',
        `Stopped after ${this.limits.maxSeconds}s while gathering ${this.planet.name} references.`
      );
    }
    this.requestCount++;
    return left;
  }

  logRequest(entry) {
    this.requests.push(entry);
  }
}

async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ReferenceIntakeError(
      'REFERENCE_INTAKE_SIZE',
      `Response is larger than the ${Math.round(maxBytes / 1024)} KiB cap.`
    );
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new ReferenceIntakeError('REFERENCE_INTAKE_SIZE', 'Response exceeded the byte cap.');
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ReferenceIntakeError(
          'REFERENCE_INTAKE_SIZE',
          `Response exceeded the ${Math.round(maxBytes / 1024)} KiB cap.`
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks);
}

const PAGE_TYPES = /^(?:text\/html|application\/xhtml\+xml|text\/xml|application\/xml|text\/plain)\b/i;

async function httpGet(url, ctx, { kind, maxBytes, accept, image = false, allow404 = false }) {
  const cached = await ctx.cache.read(url);
  if (cached?.fresh) {
    ctx.logRequest({ url, kind, status: 200, bytes: cached.body.length, cached: true, ms: 0 });
    return {
      ...cached,
      cached: true,
      finalUrl: cached.meta.finalUrl || url,
      contentType: cached.meta.contentType || ''
    };
  }

  let current = url;
  const started = ctx.now();
  try {
    for (let hop = 0; hop <= ctx.limits.maxRedirects; hop++) {
      const left = await ctx.takeRequest(current, kind);
      const signal = AbortSignal.timeout(Math.max(1000, Math.min(left, 30000)));
      const response = await ctx.fetchImpl(current, {
        redirect: 'manual',
        signal,
        headers: {
          accept,
          'accept-language': 'en',
          'user-agent':
            'EmpireWarRemasteredPlanetReferenceIntake/1.0 (private creator workbench; candidates only)'
        }
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === ctx.limits.maxRedirects) {
          throw new ReferenceIntakeError('REFERENCE_INTAKE_REDIRECT', 'Too many redirects.');
        }
        const location = response.headers.get('location');
        if (!location) throw new ReferenceIntakeError('REFERENCE_INTAKE_REDIRECT', 'Redirect without a location.');
        const next = new URL(location, current).href;
        checkedUrl(next, undefined, { image });
        current = next;
        continue;
      }

      if (response.status === 404 && allow404) return null;
      if (response.status !== 200) {
        throw new ReferenceIntakeError(
          'REFERENCE_INTAKE_HTTP',
          `${current} returned HTTP ${response.status}.`
        );
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (image) {
        if (!/^image\/(?:jpeg|jpg|png|webp)\b/.test(contentType)) {
          throw new ReferenceIntakeError(
            'REFERENCE_INTAKE_IMAGE_TYPE',
            `Not a supported image content type (${contentType || 'unknown'}).`
          );
        }
      } else if (!PAGE_TYPES.test(contentType)) {
        throw new ReferenceIntakeError(
          'REFERENCE_INTAKE_PAGE_TYPE',
          `Not an HTML/XML catalogue page (${contentType || 'unknown'}).`
        );
      }

      const body = await readCapped(response, maxBytes);
      await ctx.cache.write(current, kind, body, { finalUrl: current, contentType });
      if (current !== url) await ctx.cache.write(url, kind, body, { finalUrl: current, contentType });
      ctx.logRequest({
        url,
        finalUrl: current,
        kind,
        status: 200,
        bytes: body.length,
        cached: false,
        ms: Math.round(ctx.now() - started)
      });
      return { body, meta: { finalUrl: current, contentType }, finalUrl: current, contentType, fresh: true };
    }
    throw new ReferenceIntakeError('REFERENCE_INTAKE_REDIRECT', 'Too many redirects.');
  } catch (error) {
    if (cached && !(error instanceof BudgetStop)) {
      ctx.warn(`Used stale cache for ${new URL(url).pathname} after a network error.`);
      ctx.logRequest({ url, kind, status: 200, bytes: cached.body.length, cached: true, stale: true, ms: 0 });
      return {
        ...cached,
        cached: true,
        finalUrl: cached.meta.finalUrl || url,
        contentType: cached.meta.contentType || ''
      };
    }
    throw error;
  }
}

async function getText(url, ctx, { kind = 'page', allow404 = false } = {}) {
  const maxBytes = kind === 'sitemap' ? ctx.limits.maxSitemapBytes : ctx.limits.maxPageBytes;
  const hit = await httpGet(url, ctx, {
    kind,
    maxBytes,
    accept: kind === 'sitemap' ? 'application/xml,text/xml,text/plain' : 'text/html,application/xhtml+xml',
    allow404
  });
  if (!hit) return null;
  return { text: hit.body.toString('utf8'), cached: hit.cached, finalUrl: hit.finalUrl };
}

async function getImage(url, ctx) {
  return httpGet(url, ctx, {
    kind: 'image',
    maxBytes: ctx.limits.maxImageBytes,
    accept: 'image/jpeg,image/png,image/webp',
    image: true
  });
}

function extractLocUrls(xml) {
  return unique(
    [...String(xml).matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
      .map(m => text(m[1], 2048))
      .filter(Boolean)
  );
}

async function loadCatalogue(ctx) {
  const index = await getText(SITEMAP_URL, ctx, { kind: 'sitemap' });
  const indexLocs = extractLocUrls(index.text);
  const children = indexLocs
    .filter(raw => {
      try {
        return /\/sitemap[^/]*\.xml$/i.test(new URL(raw).pathname);
      } catch {
        return false;
      }
    })
    .slice(0, 3);
  const locs = [...indexLocs];
  for (const child of children) {
    const page = await getText(child, ctx, { kind: 'sitemap' });
    locs.push(...extractLocUrls(page.text));
  }
  return buildCatalogue(unique(locs));
}

function candidateBase({ foundUrl, baseUrl, stem, caption, captionSource, pageUrl, pageTitle, sourceId, role, trusted, aspectHits, metadataAspects, spaceContext = false, order }) {
  return {
    id: sha256(`image|${baseUrl}`),
    foundUrl,
    baseUrl,
    stem,
    caption,
    captionSource,
    pageUrl,
    pageTitle,
    sourceId,
    role,
    trusted,
    aspectHits,
    aspectStrength: aspectStrength(aspectHits),
    metadataAspects: metadataAspects || {},
    spaceContext,
    order
  };
}

function extractCandidateImages(html, { pageUrl, pageTitle, sourceId, role, planet, recordImage = null, planetAspects = {} }) {
  const candidates = [];
  const skipped = [];
  let order = 0;
  for (const match of String(html).matchAll(/<img\b[^>]*>/gi)) {
    order++;
    const attrs = parseAttrs(match[0]);
    const rawUrl = attrs['data-src'] || attrs.src || bestSrcset(attrs.srcset);
    if (!rawUrl) continue;
    const className = attrs.class || '';
    const isGalleryThumb = /(?:^|\s)thumbnail-image(?:\s|$)/.test(className);
    const isItemThumb = /thumbnailurl/i.test(attrs.itemprop || '');
    const alt = text(attrs.alt, 900);
    const title = text(attrs.title, 300);
    const aria = text(attrs['aria-label'], 200);
    let caption = text(alt || title || aria || attrs['data-caption'], 900);
    if (!caption && (role === 'gallery' || role === 'databank')) caption = text(pageTitle, 900);
    if (CHROME_ALT.test(caption)) {
      skipped.push({ url: rawUrl, reason: 'page chrome label' });
      continue;
    }
    let image;
    try {
      image = normalizeImageUrl(rawUrl, pageUrl);
    } catch (error) {
      skipped.push({ url: rawUrl, reason: error.message });
      continue;
    }
    const isGallery = role === 'gallery' && (isGalleryThumb || isItemThumb);
    const stemHits = hasPlanetToken(image.stem.replace(/[-_]+/g, ' '), planet);
    const textHits = hasPlanetToken(`${caption} ${title}`, planet);
    const trusted = isGallery || role === 'record';
    if (role === 'databank' && !isGallery && !textHits.length && !stemHits.length) {
      skipped.push({ url: image.base, reason: 'unrelated databank card' });
      continue;
    }
    if (role === 'news' && !textHits.length) {
      skipped.push({ url: image.base, reason: 'article image does not mention the planet' });
      continue;
    }
    if (role === 'gallery' && !isGallery && !stemHits.length && !textHits.length) {
      skipped.push({ url: image.base, reason: 'gallery image outside the planet section' });
      continue;
    }
    const aspectSource = `${caption} ${title}`;
    const spaceContext =
      SPACE_CONTEXT.test(normalized(aspectSource)) &&
      !EXPLICIT_SURFACE.test(normalized(aspectSource));
    const captionAspects = spaceContext ? {} : inferAspects(aspectSource);
    const metadata = recordImage && image.base === recordImage.base ? planetAspects : {};
    const strong = Object.values(captionAspects).some(v => v.strong?.length);
    // Caption evidence counts toward coverage. Catalogue metadata is reported
    // separately so a record's "Forests" field cannot pretend to be a photo.
    // A space/orbit establishing shot is context, not ground or foliage.
    if (!isGallery && !trusted && !strong && !textHits.length && !stemHits.length) {
      skipped.push({ url: image.base, reason: 'no ground or foliage signal' });
      continue;
    }
    if(spaceContext || narrativeCaption(caption)){skipped.push({url:image.base,reason:'Orbit, cast or action caption; seek the actual place'});continue;}
    if(role==='gallery' && !strong && !builtCue.test(caption)){skipped.push({url:image.base,reason:'No specific terrain or architecture in the caption'});continue;}
    candidates.push({
      ...candidateBase({
        foundUrl: image.found,
        baseUrl: image.base,
        stem: image.stem,
        caption,
        captionSource: alt ? 'alt' : title ? 'title' : aria ? 'aria' : 'data-caption',
        pageUrl,
        pageTitle,
        sourceId,
        role: isGallery ? 'gallery' : role,
        trusted,
        aspectHits: captionAspects,
        metadataAspects: metadata,
        spaceContext,
        order
      }),
      relevance: {
        planetHits: textHits,
        stemHits,
        captionStrongAspects: Object.keys(aspectStrength(captionAspects)),
        score:
          (builtCue.test(caption) ? 7 : 0) +
          (aspectStrength(captionAspects).ground === 'strong' ? 6 : 0) +
          (aspectStrength(captionAspects).foliage === 'strong' ? 6 : 0) +
          (aspectStrength(captionAspects).ground === 'weak' ? 2 : 0) +
          (aspectStrength(captionAspects).foliage === 'weak' ? 2 : 0) +
          textHits.length * 2 +
          (trusted ? 2 : 0)
      }
    });
  }
  return { candidates, skipped };
}

function recordCandidate(record, planet, meta, planetAspects) {
  if (!record.imageUrl) return null;
  let image;
  try {
    image = normalizeImageUrl(record.imageUrl, record.pageUrl);
  } catch {
    return null;
  }
  const caption = text(meta.title || planet.name, 900);
  const metadata = planetAspects;
  const captionAspects = inferAspects(caption);
  return {
    ...candidateBase({
      foundUrl: image.found,
      baseUrl: image.base,
      stem: image.stem,
      caption,
      captionSource: 'catalogue-title',
      pageUrl: record.pageUrl,
      pageTitle: record.title,
      sourceId: 'starwars-databank',
      role: 'record',
      trusted: true,
      aspectHits: captionAspects,
      metadataAspects: metadata,
      order: 0
    }),
    relevance: {
      planetHits: hasPlanetToken(`${caption} ${record.description}`, planet),
      stemHits: [],
      captionStrongAspects: Object.entries(aspectStrength(captionAspects))
        .filter(([, strength]) => strength === 'strong')
        .map(([aspect]) => aspect),
      metadataStrongAspects: Object.entries(aspectStrength(metadata))
        .filter(([, strength]) => strength === 'strong')
        .map(([aspect]) => aspect),
      score: 3
    }
  };
}

function dedupeCandidates(candidates) {
  const byBase = new Map();
  for (const candidate of candidates) {
    const previous = byBase.get(candidate.baseUrl);
    if (
      !previous ||
      candidate.relevance.score > previous.relevance.score ||
      (candidate.relevance.score === previous.relevance.score &&
        candidate.caption.length > previous.caption.length)
    ) {
      byBase.set(candidate.baseUrl, candidate);
    }
  }
  return [...byBase.values()].sort(
    (a, b) => b.relevance.score - a.relevance.score || a.order - b.order
  );
}

function coverageFor(aspect, candidates, metadataAspects) {
  const strong = candidates.filter(c => c.aspectStrength[aspect] === 'strong');
  const weak = candidates.filter(c => c.aspectStrength[aspect] === 'weak');
  const metadata = metadataAspects[aspect] || { strong: [], weak: [] };
  return {
    state: strong.length ? 'covered' : weak.length ? 'thin' : 'missing',
    strong: strong.map(c => c.id),
    weak: weak.map(c => c.id),
    metadataSignal: {
      strong: metadata.strong || [],
      weak: metadata.weak || []
    }
  };
}

function boardHtml(report) {
  const card = c => `
      <article class="card">
        <a class="shot" href="${esc(c.file)}" target="_blank" rel="noreferrer">
          <img src="${esc(c.file)}" alt="${esc(c.caption)}" loading="lazy">
        </a>
        <div class="body">
          <div class="chips">${c.spaceContext
            ? `<span class="chip context">space/orbit context</span>`
            : ''}${Object.entries(c.aspectStrength)
            .map(([a, s]) => `<span class="chip ${esc(s)}">${esc(a)} · ${esc(s)}</span>`)
            .join('')}${Object.entries(c.metadataAspects || {})
            .filter(([a]) => !c.aspectStrength[a])
            .map(([a, v]) => `<span class="chip meta">metadata ${esc(a)}${v.strong?.length ? '' : '?'}</span>`)
            .join('')}</div>
          <p class="caption">${esc(c.caption || '(no caption)')}</p>
          <p class="meta">${esc(c.width)}×${esc(c.height)} · ${(c.bytes / 1024).toFixed(0)} KiB ·
            <code>${esc(c.sha256.slice(0, 16))}…</code></p>
          <p class="meta"><a href="${esc(c.pageUrl)}" target="_blank" rel="noreferrer">source page</a>
            · <a href="${esc(c.directUrl)}" target="_blank" rel="noreferrer">direct image</a></p>
        </div>
      </article>`;
  const coverage = key => {
    const c = report.coverage[key];
    return `<li><b>${esc(key)}</b>: <span class="state ${esc(c.state)}">${esc(c.state)}</span>
      — ${c.strong.length} strong, ${c.weak.length} weak image candidate(s)${
        c.metadataSignal.strong.length
          ? `; catalogue metadata: ${esc(c.metadataSignal.strong.join(', '))}`
          : ''
      }</li>`;
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(report.planet.name)} reference candidates</title>
<style>
  :root { color-scheme: dark; --bg:#101215; --panel:#181c21; --line:#2c333c; --ink:#e8edf2; --muted:#98a4b3; --accent:#e7b04a; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui,sans-serif; }
  h1 { margin:0 0 4px; font-size:24px; } h2 { margin:24px 0 8px; font-size:17px; }
  .warn { border-left:3px solid var(--accent); background:#211c12; padding:10px 14px; margin:14px 0; }
  .muted { color:var(--muted); } code { font:12px ui-monospace,monospace; color:#b9c7d8; }
  ul { margin:6px 0; padding-left:20px; } li { margin:2px 0; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:14px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .shot img { display:block; width:100%; height:auto; background:#0b0d10; }
  .body { padding:10px 12px 12px; } .chips { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px; }
  .chip { font-size:11px; padding:2px 7px; border-radius:999px; background:#25303b; }
  .chip.strong { background:#17452f; color:#b8ffd6; } .chip.weak { background:#4a3b16; color:#ffe2a8; }
  .chip.meta { background:#2a2640; color:#d9d1ff; } .chip.context { background:#232a33; color:#aab7c8; }
  .caption { margin:4px 0 8px; } .meta { margin:2px 0; color:var(--muted); font-size:12px; }
  a { color:#9ecbff; } .state.covered { color:#8ef0b4; } .state.thin { color:#ffd27a; } .state.missing { color:#ff9d9d; }
  details { margin-top:16px; } summary { cursor:pointer; color:var(--muted); }
</style>
</head>
<body>
<h1>${esc(report.planet.name)} — reference candidates</h1>
<p class="warn"><b>Candidates, not approval.</b> Private local review board. Nothing here is shipped, registered,
or automatically applied. Inspect the images and decide ground and foliage from what you see and from the map in play.</p>
<p class="muted">Report <code>${esc(report.id)}</code> · ${esc(report.generatedAt)} · ${report.seconds.toFixed(1)}s ·
  ${report.candidates.length} image(s) · job ${esc(report.job.id || 'unlinked')}</p>
<h2>Search and coverage</h2>
<ul>${coverage('ground')}${coverage('foliage')}</ul>
<p class="muted">Searched: ${report.sources
    .filter(s => s.used)
    .map(s => `<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.label)}</a>`)
    .join(' · ') || 'no page succeeded'}. ${report.searched.imageDownloads.attempted} image download(s) attempted.</p>
${report.warnings.length ? `<ul>${report.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
<h2>Images</h2>
<div class="grid">${report.candidates.map(card).join('')}</div>
<details><summary>Skipped / rejected (${report.rejected.length})</summary>
<ul>${report.rejected.map(r => `<li><code>${esc(r.reason)}</code> — ${esc(r.url)}</li>`).join('')}</ul>
</details>
<p class="muted">Report: <code>${esc(report.paths.report)}</code></p>
</body>
</html>
`;
}

function indexHtml(aggregate) {
  const rows = aggregate.results
    .map(
      report => `<li><a href="${esc(path.relative(aggregate.paths.dir, report.paths.board).split(path.sep).join('/'))}">${esc(
        report.planet.name
      )}</a> — ground ${esc(report.coverage.ground.state)}, foliage ${esc(
        report.coverage.foliage.state
      )}, ${report.candidates.length} candidate(s)</li>`
    )
    .join('');
  const failures = aggregate.failures
    .map(f => `<li>${esc(f.planet)} — ${esc(f.error)}</li>`)
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<title>Planet reference boards</title>
<style>body{margin:24px;background:#101215;color:#e8edf2;font:15px/1.5 system-ui,sans-serif}a{color:#9ecbff}
.warn{border-left:3px solid #e7b04a;background:#211c12;padding:10px 14px}</style></head><body>
<h1>Planet reference boards</h1>
<p class="warn"><b>Candidates, not approval.</b> Private local cache. Do not ship or republish these files.</p>
<ul>${rows}</ul>${failures ? `<h2>Failures</h2><ul>${failures}</ul>` : ''}
<p><a href="${esc(path.basename(aggregate.paths.report))}">Aggregate report JSON</a></p>
</body></html>`;
}

function identityFor(planet, { databankUrl, galleryUrl, newsUrls, locations }) {
  const pathname = value => {
    try {
      return new URL(value).pathname;
    } catch {
      return value || null;
    }
  };
  return {
    planet: planet.key,
    databank: pathname(databankUrl),
    gallery: pathname(galleryUrl),
    news: (newsUrls || []).map(pathname),
    ...(locations?.length ? {locations} : {})
  };
}

function stableId(identity) {
  return sha256(`planet-reference-intake/v1|${JSON.stringify(identity)}`);
}

function publicCandidate(c) {
  return {
    id: c.id,
    sourceId: c.sourceId,
    role: c.role,
    aspects: Object.keys(c.aspectStrength),
    aspectStrength: c.aspectStrength,
    aspectHits: c.aspectHits,
    metadataAspects: c.metadataAspects,
    spaceContext: c.spaceContext,
    caption: c.caption,
    captionSource: c.captionSource,
    pageTitle: c.pageTitle,
    pageUrl: c.pageUrl,
    imageUrl: c.foundUrl,
    directUrl: c.baseUrl,
    file: `images/${c.file}`,
    sha256: c.sha256,
    bytes: c.bytes,
    width: c.width,
    height: c.height,
    mime: c.mime,
    verification: 'bytes downloaded locally; caption/metadata classification only — inspect the board',
    relevance: c.relevance
  };
}

async function downloadCandidate(candidate, ctx, dir, totals) {
  if (candidate.bytes && candidate.file) return candidate;
  if (totals.bytes >= ctx.limits.maxTotalImageBytes) {
    throw new ReferenceIntakeError('REFERENCE_INTAKE_SIZE', 'Total image byte cap reached.');
  }
  totals.attempted++;
  const hit = await getImage(candidate.baseUrl, ctx);
  const info = imageInfo(hit.body);
  if (!info) {
    throw new ReferenceIntakeError('REFERENCE_INTAKE_IMAGE_TYPE', 'Downloaded bytes are not a readable image.');
  }
  const mime = info.type === 'jpeg' ? 'image/jpeg' : info.type === 'png' ? 'image/png' : 'image/webp';
  if (info.width && info.width < ctx.limits.minImageWidth) {
    throw new ReferenceIntakeError(
      'REFERENCE_INTAKE_IMAGE_SIZE',
      `Image is only ${info.width}px wide (minimum ${ctx.limits.minImageWidth}).`
    );
  }
  if (info.height && info.height < ctx.limits.minImageHeight) {
    throw new ReferenceIntakeError(
      'REFERENCE_INTAKE_IMAGE_SIZE',
      `Image is only ${info.height}px tall (minimum ${ctx.limits.minImageHeight}).`
    );
  }
  if (totals.bytes + hit.body.length > ctx.limits.maxTotalImageBytes) {
    throw new ReferenceIntakeError('REFERENCE_INTAKE_SIZE', 'Total image byte cap reached.');
  }
  const digest = sha256(hit.body);
  const ext = info.type === 'jpeg' ? 'jpg' : info.type;
  const file = `${digest}.${ext}`;
  await fsp.writeFile(path.join(dir, 'images', file), hit.body);
  totals.bytes += hit.body.length;
  ctx.bytesDownloaded += hit.body.length;
  return {
    ...candidate,
    sha256: digest,
    bytes: hit.body.length,
    width: info.width,
    height: info.height,
    mime,
    file
  };
}

function failureReport({ id, planet, job, error, sources, searched, requests, rejected, paths, warnings }) {
  return {
    format: FORMAT,
    kind: 'planet-reference-failure',
    approval: false,
    note: 'No usable reference candidates. Nothing was applied. This is a private local audit record.',
    id,
    generatedAt: new Date().toISOString(),
    planet: { name: planet.name, key: planet.key, aliases: planet.aliases },
    job: { id: job?.id || null, scope: job?.scope || null },
    error: { code: error.code || 'REFERENCE_INTAKE_EMPTY', message: error.message },
    sources,
    searched,
    requests,
    rejected,
    warnings,
    paths
  };
}

async function writeReportFiles(report, paths) {
  const json = JSON.stringify(report, null, 2) + '\n';
  await writeAtomic(paths.report, json);
  await writeAtomic(paths.latestReport, json);
  const html = boardHtml(report);
  await writeAtomic(paths.board, html);
  await writeAtomic(paths.latestBoard, html);
}

/**
 * Collect bounded, first-party image candidates for one planet.
 *
 * @param {object|null} job parent workbench job (only id/scope are recorded)
 * @param {string|object} planet name or { name, aliases, terrains, climates, limits }
 * @param {string} [home] temp home; defaults to OS temp/planet-reference-intake-v1
 * @param {{fetch?:Function, now?:Function}} [options] test hooks
 * @returns {Promise<object>} report with candidates and absolute result paths
 */
export async function collectReferences(job, planet, home, options = {}) {
  const p = parsePlanet(planet);
  const root = path.resolve(home || DEFAULT_HOME);
  const ctx = new RunContext({ planet: p, job, home: root, options });
  const dir = path.join(root, 'planets', p.key);
  await fsp.mkdir(path.join(dir, 'images'), { recursive: true });

  const candidates = [];
  const rejected = [];
  const pages = [];
  const sources = [
    {
      id: 'starwars-catalogue',
      label: 'starwars.com official sitemap catalogue',
      url: SITEMAP_URL,
      used: false
    },
    {
      id: 'starwars-databank',
      label: 'Star Wars Databank record',
      url: null,
      used: false
    },
    {
      id: 'starwars-gallery',
      label: 'official starwars.com history/location gallery',
      url: null,
      used: false
    },
    { id: 'starwars-news', label: 'official starwars.com article gallery', url: null, used: false }
  ];
  const searched = {
    catalogue: { url: SITEMAP_URL, matchedSlug: null, matchedUrl: null, method: null, error: null },
    pages,
    imageDownloads: { attempted: 0, kept: 0, rejected: 0, bytes: 0 }
  };
  let catalogue = null;
  let catalogueError = null;
  let record = null;
  const locations = [...new Set(options.placeSlugs ?? (p.key==='tatooine' ? ['beggar-s-canyon','jundland-wastes','the-lars-homestead','mos-eisley','mos-espa','jabba-the-hutts-palace'] : []))].slice(0,6);
  if (locations.some(s => !/^[a-z0-9][a-z0-9-]{1,70}$/.test(s))) throw Error('Invalid location slug');
  let databankUrl = null;
  let galleryUrl = null;
  let newsUrls = [];
  let meta = { title: '', description: '' };
  let planetAspects = inferAspects(
    [...p.terrains, ...p.climates, p.aliases.join(' ')].join(' ')
  );
  let budgetHit = null;

  try {
    try {
      catalogue = await loadCatalogue(ctx);
      sources[0].used = true;
    } catch (error) {
      catalogueError = error.message;
      ctx.warn(`Official sitemap catalogue unavailable: ${error.message}`);
      if (error instanceof BudgetStop) budgetHit = error;
    }

    if (catalogue) {
      const match = matchRecord(catalogue, p);
      if (match) {
        databankUrl = match.url;
        searched.catalogue.matchedSlug = match.slug;
        searched.catalogue.matchedUrl = match.url;
        searched.catalogue.method = match.method;
        galleryUrl = matchGallery(catalogue, p, match);
      } else {
        searched.catalogue.method = 'no-match';
      }
    }

    if (!databankUrl) {
      // The sitemap can lag. Probe one conventional databank slug (and one
      // stripped slug) before giving up; 404s are expected and bounded.
      for (const slug of unique([p.key, ...slugVariants(p)]).slice(0, 2)) {
        const probeUrl = `https://www.starwars.com/databank/${slug}`;
        try {
          const probe = await getText(probeUrl, ctx, { allow404: true });
          if (probe) {
            databankUrl = probeUrl;
            searched.catalogue.matchedSlug = slug;
            searched.catalogue.matchedUrl = probeUrl;
            searched.catalogue.method = 'probe';
            break;
          }
        } catch (error) {
          if (error instanceof BudgetStop) throw error;
        }
      }
      if (catalogue && searched.catalogue.matchedSlug && !galleryUrl) {
        galleryUrl = catalogue.galleries.get(searched.catalogue.matchedSlug) || null;
      }
    }

    if (databankUrl) {
      try {
        const page = await getText(databankUrl, ctx);
        meta = parseMeta(page.text);
        const slug = new URL(databankUrl).pathname.split('/').pop();
        record = parseDatabankRecord(page.text, slug, p, meta);
        record.title ||= meta.title;
        if (record.terrains.length) p.terrains = unique([...p.terrains, ...record.terrains]);
        if (record.climates.length) p.climates = unique([...p.climates, ...record.climates]);
        planetAspects = inferAspects(
          [...p.terrains, ...p.climates, record.description, p.aliases.join(' ')].join(' ')
        );
        sources[1].url = databankUrl;
        sources[1].used = true;
        pages.push({
          sourceId: 'starwars-databank',
          url: databankUrl,
          title: record.title,
          imagesSeen: 0,
          kept: 0,
          cached: page.cached
        });
        let recordBase = null;
        try {
          recordBase = normalizeImageUrl(record.imageUrl, databankUrl).base;
        } catch {
          /* metadata image is optional; gallery images can still carry the intake */
        }
        const extracted = extractCandidateImages(page.text, {
          pageUrl: databankUrl,
          pageTitle: record.title,
          sourceId: 'starwars-databank',
          role: 'databank',
          planet: p,
          recordImage: recordBase ? { base: recordBase } : null,
          planetAspects
        });
        const recordShot = recordCandidate(record, p, meta, planetAspects);
        if (recordShot) candidates.push(recordShot);
        candidates.push(...extracted.candidates);
        rejected.push(...extracted.skipped);
        pages.at(-1).imagesSeen = extracted.candidates.length + extracted.skipped.length;
        pages.at(-1).kept = extracted.candidates.length + (recordShot ? 1 : 0);
      } catch (error) {
        if (error instanceof BudgetStop) throw error;
        ctx.warn(`Databank page unavailable: ${error.message}`);
        rejected.push({ url: databankUrl, reason: error.message });
      }
    }

    // Prefer the hero image of a named location to narrative thumbnails. Restrict
    // this to official records, not related character/ship cards on the same page.
    for(const slug of locations){
      const url='https://www.starwars.com/databank/'+slug;
      try{const page=await getText(url,ctx,{allow404:true});if(!page)continue;const info=parseMeta(page.text),entry=parseDatabankRecord(page.text,slug,p,info);
        if(!entry.imageUrl||!hasPlanetToken(entry.description+' '+info.description,p).length)continue;
        const shot=recordCandidate({...entry,pageUrl:url,title:info.title},p,info,{});if(!shot||narrativeCaption(shot.caption))continue;
        shot.relevance.score+=18;shot.sourceId='starwars-place';candidates.push(shot);pages.push({sourceId:'starwars-place',url,title:info.title,kept:1,cached:page.cached});
      }catch(error){if(error instanceof BudgetStop)throw error;ctx.warn(`Location record unavailable: ${slug}`);}
    }
    if (galleryUrl) {
      try {
        const page = await getText(galleryUrl, ctx);
        const galleryMeta = parseMeta(page.text);
        sources[2].url = galleryUrl;
        sources[2].used = true;
        pages.push({
          sourceId: 'starwars-gallery',
          url: galleryUrl,
          title: galleryMeta.title,
          imagesSeen: 0,
          kept: 0,
          cached: page.cached
        });
        const extracted = extractCandidateImages(page.text, {
          pageUrl: galleryUrl,
          pageTitle: galleryMeta.title,
          sourceId: 'starwars-gallery',
          role: 'gallery',
          planet: p,
          planetAspects
        });
        candidates.push(...extracted.candidates);
        rejected.push(...extracted.skipped);
        pages.at(-1).imagesSeen = extracted.candidates.length + extracted.skipped.length;
        pages.at(-1).kept = extracted.candidates.length;
      } catch (error) {
        if (error instanceof BudgetStop) throw error;
        ctx.warn(`Official gallery unavailable: ${error.message}`);
        rejected.push({ url: galleryUrl, reason: error.message });
      }
    } else {
      if (catalogue) newsUrls = matchNews(catalogue, p, 2);
      if (!catalogue) {
        // No catalogue: one bounded conventional gallery probe.
        for (const slug of unique([p.key, ...slugVariants(p)]).slice(0, 2)) {
          const probeUrl = `https://www.starwars.com/${slug}-history-gallery`;
          try {
            const probe = await getText(probeUrl, ctx, { allow404: true });
            if (probe) {
              galleryUrl = probeUrl;
              const galleryMeta = parseMeta(probe.text);
              sources[2].url = galleryUrl;
              sources[2].used = true;
              pages.push({
                sourceId: 'starwars-gallery',
                url: galleryUrl,
                title: galleryMeta.title,
                imagesSeen: 0,
                kept: 0,
                cached: probe.cached
              });
              const extracted = extractCandidateImages(probe.text, {
                pageUrl: galleryUrl,
                pageTitle: galleryMeta.title,
                sourceId: 'starwars-gallery',
                role: 'gallery',
                planet: p,
                planetAspects
              });
              candidates.push(...extracted.candidates);
              rejected.push(...extracted.skipped);
              pages.at(-1).kept = extracted.candidates.length;
              break;
            }
          } catch (error) {
            if (error instanceof BudgetStop) throw error;
          }
        }
      }
      for (const newsUrl of newsUrls) {
        try {
          const page = await getText(newsUrl, ctx);
          const newsMeta = parseMeta(page.text);
          sources[3].url ||= newsUrl;
          sources[3].used = true;
          const extracted = extractCandidateImages(page.text, {
            pageUrl: newsUrl,
            pageTitle: newsMeta.title,
            sourceId: 'starwars-news',
            role: 'news',
            planet: p,
            planetAspects
          });
          candidates.push(...extracted.candidates);
          rejected.push(...extracted.skipped);
          pages.push({
            sourceId: 'starwars-news',
            url: newsUrl,
            title: newsMeta.title,
            imagesSeen: extracted.candidates.length + extracted.skipped.length,
            kept: extracted.candidates.length,
            cached: page.cached
          });
        } catch (error) {
          if (error instanceof BudgetStop) throw error;
          ctx.warn(`Article gallery unavailable: ${error.message}`);
          rejected.push({ url: newsUrl, reason: error.message });
        }
      }
    }
  } catch (error) {
    if (error instanceof BudgetStop) {
      budgetHit = error;
      ctx.warn(error.message);
    } else {
      throw error;
    }
  }

  const deduped = dedupeCandidates(candidates);
  const selected = [];
  const downloadLimit = Math.min(deduped.length, ctx.limits.maxImages + 4);
  for (const candidate of deduped.slice(0, downloadLimit)) {
    if (selected.length >= ctx.limits.maxImages) break;
    try {
      selected.push(await downloadCandidate(candidate, ctx, dir, searched.imageDownloads));
    } catch (error) {
      searched.imageDownloads.rejected++;
      rejected.push({ url: candidate.baseUrl, reason: error.message });
      if (error instanceof BudgetStop) {
        budgetHit = error;
        ctx.warn(error.message);
        break;
      }
    }
  }
  searched.imageDownloads.kept = selected.length;
  searched.imageDownloads.bytes = selected.reduce((n, c) => n + c.bytes, 0);

  const identity = identityFor(p, { databankUrl, galleryUrl, newsUrls, locations });
  const id = stableId(identity);
  const paths = {
    root,
    dir,
    images: path.join(dir, 'images'),
    report: path.join(dir, id + '.json'),
    latestReport: path.join(dir, 'report.json'),
    board: path.join(dir, id + '.html'),
    latestBoard: path.join(dir, 'board.html')
  };

  if (!selected.length) {
    const error =
      budgetHit ||
      new ReferenceIntakeError(
        'REFERENCE_INTAKE_EMPTY',
        `No relevant ground/foliage reference images found for ${p.name}. The first-party pages were searched; there is nothing to put on a board.`
      );
    const failureId = stableId({ ...identity, empty: true });
    const failurePath = path.join(dir, `${failureId}.failure.json`);
    const latestFailurePath = path.join(dir, 'failure.json');
    const failure = failureReport({
      id: failureId,
      planet: p,
      job,
      error,
      sources,
      searched: {
        ...searched,
        catalogue: { ...searched.catalogue, error: catalogueError },
        identity
      },
      requests: ctx.requests,
      rejected: rejected.slice(0, 40),
      paths: {
        root,
        dir,
        images: path.join(dir, 'images'),
        report: failurePath,
        latestReport: latestFailurePath,
        board: null,
        latestBoard: null
      },
      warnings: ctx.warnings
    });
    await writeAtomic(failurePath, JSON.stringify(failure, null, 2) + '\n');
    await writeAtomic(latestFailurePath, JSON.stringify(failure, null, 2) + '\n');
    throw new ReferenceIntakeError(error.code, error.message, {
      ...error.details,
      report: failurePath,
      latestReport: latestFailurePath,
      searched: searched.pages,
      rejected: rejected.slice(0, 40),
      catalogueError,
      requests: ctx.requests.length
    });
  }

  const ground = coverageFor('ground', selected, planetAspects);
  const foliage = coverageFor('foliage', selected, planetAspects);
  const complete = ground.state !== 'missing' && foliage.state !== 'missing';
  const confirmed = ground.state === 'covered' && foliage.state === 'covered';
  const warnings = [...ctx.warnings];
  if (ground.state === 'thin') {
    warnings.push('Ground is thin: only weak/page-level wording supports it. Inspect the board before choosing ground art.');
  }
  if (ground.state === 'missing') {
    warnings.push('Ground is missing: no downloaded candidate carries a ground signal. Do not decide ground from this intake alone.');
  }
  if (foliage.state === 'thin') {
    warnings.push('Foliage is thin: only weak/page-level wording supports it. Inspect the board before choosing foliage art.');
  }
  if (foliage.state === 'missing') {
    warnings.push('Foliage is missing: no downloaded candidate carries a foliage signal. Do not decide foliage from this intake alone.');
  }
  if (budgetHit) warnings.push(budgetHit.message);
  if (catalogueError) warnings.push(`Catalogue fallback used: ${catalogueError}`);

  const report = {
    format: FORMAT,
    kind: 'planet-reference-candidates',
    approval: false,
    note: 'Candidates for human visual review, not approval. Private local cache; no art is registered or shipped.',
    id,
    generatedAt: new Date(ctx.now()).toISOString(),
    seconds: Math.max(0, (ctx.now() - ctx.started) / 1000),
    job: { id: job?.id || null, scope: job?.scope || null, file: job?.file || null },
    planet: {
      name: p.name,
      key: p.key,
      aliases: p.aliases,
      tokens: p.tokens,
      terrains: p.terrains,
      climates: p.climates,
      description: text(record?.description || meta.description, 700),
      aspectsRequired: ['ground', 'foliage'],
      catalogueMetadataAspects: planetAspects
    },
    status: complete ? (confirmed ? 'complete' : 'partial') : 'partial',
    complete,
    confirmed,
    coverage: { ground, foliage },
    sources,
    searched: {
      ...searched,
      catalogue: { ...searched.catalogue, error: catalogueError },
      identity
    },
    requests: ctx.requests,
    candidates: selected.map(publicCandidate),
    rejected: rejected.slice(0, 40),
    warnings: unique(warnings),
    bounds: {
      maxRequests: ctx.limits.maxRequests,
      maxImages: ctx.limits.maxImages,
      maxImageBytes: ctx.limits.maxImageBytes,
      maxTotalImageBytes: ctx.limits.maxTotalImageBytes,
      maxSeconds: ctx.limits.maxSeconds
    },
    paths
  };
  await writeReportFiles(report, paths);
  return report;
}

/**
 * Collect several planets in one bounded pass. Each planet keeps its own cache,
 * report and board; one failure does not discard the others.
 */
export async function collectManyReferences(job, planets, home, options = {}) {
  const list = Array.isArray(planets) ? planets : [planets];
  const root = path.resolve(home || DEFAULT_HOME);
  const parsed = [];
  const parseFailures = [];
  for (const input of list) {
    try {
      parsed.push(parsePlanet(input));
    } catch (error) {
      parseFailures.push({ planet: typeof input === 'string' ? input : String(input?.name || '?'), error: error.message });
    }
  }
  if (parsed.length + parseFailures.length > DEFAULT_LIMITS.maxPlanets) {
    throw new ReferenceIntakeError(
      'REFERENCE_INTAKE_PLANETS',
      `At most ${DEFAULT_LIMITS.maxPlanets} planets per intake pass.`
    );
  }
  const results = [];
  const failures = [...parseFailures];
  for (const planet of parsed) {
    try {
      results.push(
        await collectReferences(
          job,
          {
            name: planet.name,
            key: planet.key,
            aliases: planet.aliases,
            terrains: planet.terrains,
            climates: planet.climates,
            limits: planet.limits
          },
          root,
          options
        )
      );
    } catch (error) {
      failures.push({ planet: planet.name, code: error.code || null, error: error.message, details: error.details || null });
    }
  }
  const identity = { planets: parsed.map(p => p.key).sort() };
  const id = sha256(`planet-reference-intake/v1/many|${JSON.stringify(identity)}`);
  const aggregate = {
    format: FORMAT,
    kind: 'planet-reference-set',
    approval: false,
    note: 'Candidates for human visual review, not approval. Private local cache.',
    id,
    generatedAt: new Date().toISOString(),
    job: { id: job?.id || null, scope: job?.scope || null },
    planets: parsed.map(p => ({ name: p.name, key: p.key })),
    results,
    failures,
    status: failures.length ? (results.length ? 'partial' : 'failed') : 'complete',
    paths: {
      root,
      dir: root,
      report: path.join(root, `index-${id}.json`),
      latestReport: path.join(root, 'index.json'),
      board: path.join(root, `index-${id}.html`),
      latestBoard: path.join(root, 'index.html')
    }
  };
  await writeAtomic(aggregate.paths.report, JSON.stringify(aggregate, null, 2) + '\n');
  await writeAtomic(aggregate.paths.latestReport, JSON.stringify(aggregate, null, 2) + '\n');
  const html = indexHtml(aggregate);
  await writeAtomic(aggregate.paths.board, html);
  await writeAtomic(aggregate.paths.latestBoard, html);
  if (!results.length) {
    throw new ReferenceIntakeError(
      'REFERENCE_INTAKE_EMPTY',
      'No planet produced any relevant reference candidates.',
      {
        report: aggregate.paths.report,
        latestReport: aggregate.paths.latestReport,
        failures
      }
    );
  }
  return aggregate;
}

// Small, documented exports for fixtures and future adapters.
export const internals = Object.freeze({
  inferAspects,
  aspectStrength,
  keyOf,
  parsePlanet,
  imageInfo,
  checkedUrl,
  normalizeImageUrl
});
