/**
 * Terrain donor intake: Poly Haven texture candidates for human review.
 *
 * A donor board is a private, local comparison page. It answers one question:
 * "which first-party texture sets are plausible for this reviewed direction?"
 * It never chooses a material, never fills a slot, never cooks and never
 * approves anything.
 *
 * What the module guarantees:
 *   - Network is build-time only, inside donorBoard(); import does no I/O.
 *   - Only three first-party HTTPS hosts are fetched (api.polyhaven.com for the
 *     catalogue and per-asset file manifests, cdn.polyhaven.com for thumbnails).
 *     dl.polyhaven.org URLs are *pinned* for the eventual cook but never fetched
 *     here, so intake stays small. Redirects are re-validated per hop.
 *   - Every 2K map entry is checked structurally (Diffuse / nor_gl / Rough /
 *     Displacement, resolution key `2k`, jpg|png raster, first-party path naming
 *     the same asset and map, declared md5 + byte size). A set missing any of the
 *     four is not a donor for a cook and is rejected, not silently downgraded.
 *   - Thumbnails are the only bytes downloaded. They are content-addressed under
 *     the caller's existing private reference cache
 *     (<home>/references/reviewed-images/<sha256>, the same layout the planet
 *     reference intake uses) plus a board-local copy so the page renders.
 *   - Requests, bytes, candidates and wall-clock time are capped; every request
 *     is logged in the report.
 *
 * Public API:
 *   donorBoard(job, direction, query, home, options?) -> report (with `board`
 *   and `paths` pointing at the private HTML page and its JSON twin)
 *
 * `direction` accepts a reviewed direction document (tools/remaster/direction.mjs
 * shape), the path to one, or one of 'ground' | 'foliage' | 'landmark'. A bare
 * role carries no reviewed decision, which the board states plainly.
 *
 * `query` is the human visual intent in plain words, e.g.
 *   'dry cracked basalt, fine pale dust, sparse grit; no grass, no snow'
 * Clauses after "no"/"not"/"without"/"avoid"/"exclude" become negative terms.
 *
 * `options` is for tests and embedded use only:
 *   { fetch, now, limits }
 * `fetch` must be a fixture-compatible fetch implementation; it replaces every
 * request, so tests run fully offline. Limits may only lower the defaults.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const FORMAT = 1;
export const VERSION = '1.0.0';
export const DEFAULT_HOME = path.join(os.tmpdir(), 'terrain-donor-intake-v1');

const CATALOG_URL = 'https://api.polyhaven.com/assets?t=textures';
const API_HOST = 'api.polyhaven.com';
const THUMB_HOSTS = new Set(['cdn.polyhaven.com']);
const FILE_HOSTS = new Set(['dl.polyhaven.org']);
const ASSET_PAGE_HOST = 'polyhaven.com';
const USER_AGENT =
  'EmpireWarRemasteredTerrainDonorIntake/1.0 (private creator workbench; candidates for human review only)';
const ASSET_ID = /^[a-z0-9][a-z0-9_]{1,63}$/;
const ROLES = ['ground', 'foliage', 'landmark'];

/** The four maps an eventual terrain cook needs, all from the same 2K set. */
export const MAPS = Object.freeze([
  { slot: 'diffuse', api: 'Diffuse', file: 'diff' },
  { slot: 'nor_gl', api: 'nor_gl', file: 'nor_gl' },
  { slot: 'rough', api: 'Rough', file: 'rough' },
  { slot: 'disp', api: 'Displacement', file: 'disp' }
]);
export const RESOLUTION = '2k';
/** A 2K map is only native if the asset actually ships that many texels. */
export const MIN_EDGE = 2048;

export const DEFAULT_LIMITS = Object.freeze({
  maxCandidates: 6,
  maxCandidateCap: 8,
  maxFilesChecks: 12,
  maxRequests: 24,
  maxRedirects: 3,
  maxCatalogBytes: 8 * 1024 * 1024,
  maxFilesBytes: 2 * 1024 * 1024,
  maxThumbBytes: 900 * 1024,
  maxTotalThumbBytes: 6 * 1024 * 1024,
  maxSeconds: 45,
  maxQueryChars: 600,
  maxQueryTerms: 24,
  minThumbWidth: 64,
  minThumbHeight: 64,
  thumbSize: 384,
  cacheCatalogTtlMs: 6 * 60 * 60 * 1000,
  cacheFilesTtlMs: 6 * 60 * 60 * 1000,
  cacheAssetTtlMs: 30 * 24 * 60 * 60 * 1000
});

export class DonorIntakeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DonorIntakeError';
    this.code = code;
    this.details = details;
  }
}

class BudgetStop extends DonorIntakeError {}

/* ------------------------------------------------------------------ helpers */

const sha256 = value => createHash('sha256').update(value).digest('hex');
const unique = values => [...new Set(values)];

function text(value, max = 1200) {
  return String(value ?? '')
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
  const source = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_LIMITS;
  return {
    maxCandidates: positiveInt(source.maxCandidates, d.maxCandidates, d.maxCandidateCap),
    maxCandidateCap: d.maxCandidateCap,
    maxFilesChecks: positiveInt(source.maxFilesChecks, d.maxFilesChecks, 40),
    maxRequests: positiveInt(source.maxRequests, d.maxRequests, 60),
    maxRedirects: Number.isSafeInteger(source.maxRedirects) && source.maxRedirects >= 0
      ? Math.min(source.maxRedirects, d.maxRedirects)
      : d.maxRedirects,
    maxCatalogBytes: positiveInt(source.maxCatalogBytes, d.maxCatalogBytes, 32 * 1024 * 1024),
    maxFilesBytes: positiveInt(source.maxFilesBytes, d.maxFilesBytes, 8 * 1024 * 1024),
    maxThumbBytes: positiveInt(source.maxThumbBytes, d.maxThumbBytes, 4 * 1024 * 1024),
    maxTotalThumbBytes: positiveInt(source.maxTotalThumbBytes, d.maxTotalThumbBytes, 32 * 1024 * 1024),
    maxSeconds: positiveInt(source.maxSeconds, d.maxSeconds, 300),
    maxQueryChars: d.maxQueryChars,
    maxQueryTerms: d.maxQueryTerms,
    minThumbWidth: d.minThumbWidth,
    minThumbHeight: d.minThumbHeight,
    thumbSize: d.thumbSize,
    cacheCatalogTtlMs: d.cacheCatalogTtlMs,
    cacheFilesTtlMs: d.cacheFilesTtlMs,
    cacheAssetTtlMs: d.cacheAssetTtlMs
  };
}

/* --------------------------------------------------------- input validation */

function parseJob(job) {
  if (job === null || job === undefined) return { id: null, planet: null, scope: null, file: null };
  if (typeof job !== 'object' || Array.isArray(job)) {
    throw new DonorIntakeError('DONOR_JOB', 'job must be an object (or null) with an id and a planet.');
  }
  const id = typeof job.id === 'string' && job.id.trim() ? job.id.trim().slice(0, 128) : null;
  const planet = typeof job.planet === 'string' ? text(job.planet, 80) : null;
  return {
    id,
    planet,
    scope: typeof job.scope === 'string' ? text(job.scope, 80) : null,
    file: typeof job.file === 'string' ? text(job.file, 300) : null
  };
}

function readDirectionFile(file) {
  const resolved = path.resolve(file);
  let raw;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch {
    throw new DonorIntakeError('DONOR_DIRECTION', `Direction file is not readable: ${resolved}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new DonorIntakeError('DONOR_DIRECTION', `Direction file is not JSON: ${resolved}`);
  }
}

/**
 * Normalize `direction` into { role, decision, reject, planet, job, file, source }.
 * A reviewed document supplies human wording; a bare role only scopes the search.
 */
function parseDirection(direction, options) {
  const fromDocument = (doc, file) => {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new DonorIntakeError('DONOR_DIRECTION', 'Direction document must be an object.');
    }
    const present = ROLES.filter(role => doc[role] && typeof doc[role] === 'object');
    const requested = typeof options.role === 'string' ? options.role : null;
    if (requested && !ROLES.includes(requested)) {
      throw new DonorIntakeError('DONOR_DIRECTION', `Unknown direction role: ${requested}`);
    }
    const role = requested || (present.length === 1 ? present[0] : null);
    if (!role) {
      throw new DonorIntakeError(
        'DONOR_DIRECTION',
        present.length
          ? `Direction covers ${present.join(', ')}; pass options.role to pick the one being sourced.`
          : 'Direction document has no ground, foliage or landmark decision.'
      );
    }
    const block = doc[role] && typeof doc[role] === 'object' ? doc[role] : null;
    return {
      role,
      roleSource: block ? 'reviewed-direction' : 'role-only',
      decision: block?.decision ? text(block.decision, 1200) : null,
      reject: block?.reject ? text(block.reject, 1200) : null,
      planet: doc.planet ? text(doc.planet, 80) : null,
      job: typeof doc.job === 'string' ? doc.job : null,
      file: file || null
    };
  };

  if (typeof direction === 'string') {
    const value = direction.trim();
    if (ROLES.includes(value)) {
      return { role: value, roleSource: 'role-only', decision: null, reject: null, planet: null, job: null, file: null };
    }
    if (value === '') {
      throw new DonorIntakeError('DONOR_DIRECTION', 'Pass a reviewed direction document, its path, or ground/foliage/landmark.');
    }
    return fromDocument(readDirectionFile(value), path.resolve(value));
  }
  if (!direction || typeof direction !== 'object' || Array.isArray(direction)) {
    throw new DonorIntakeError('DONOR_DIRECTION', 'Pass a reviewed direction document, its path, or ground/foliage/landmark.');
  }
  if (ROLES.includes(direction.role) && !direction.views) {
    // A pre-shaped { role, decision? } block.
    return {
      role: direction.role,
      roleSource: direction.decision ? 'reviewed-direction' : 'role-only',
      decision: direction.decision ? text(direction.decision, 1200) : null,
      reject: direction.reject ? text(direction.reject, 1200) : null,
      planet: direction.planet ? text(direction.planet, 80) : null,
      job: typeof direction.job === 'string' ? direction.job : null,
      file: null
    };
  }
  return fromDocument(direction, null);
}

const NEGATIVE_MARKERS = /^(?:no|not?|without|avoid|avoiding|exclude|excluding|skip|never|minus|not?)\b[\s:,-]*/i;
const CLAUSE_SPLIT = /[,;.\n]+/;
const CONNECTOR_SPLIT = /[,;.\n]+|\band\b|\bor\b/i;
const CONNECTORS = new Set(['and', 'or', 'with', 'plus', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'but', 'so', 'then']);
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'without', 'no', 'not',
  'is', 'are', 'be', 'been', 'very', 'some', 'more', 'most', 'less', 'like', 'look', 'looks',
  'feel', 'feels', 'should', 'would', 'could', 'want', 'wants', 'need', 'needs', 'only', 'also',
  'but', 'then', 'than', 'that', 'this', 'these', 'those', 'it', 'its', 'as', 'at', 'by', 'from',
  'into', 'over', 'under', 'near', 'around', 'between', 'ground', 'terrain', 'texture', 'surface',
  'please', 'maybe', 'kind', 'sort', 'overall', 'mostly', 'slight', 'slightly', 'bit', 'quite'
]);

function termFrom(phrase) {
  const words = unique(wordsOf(phrase)).filter(w => w.length > 1 && !STOP_WORDS.has(w));
  return words.length ? { text: words.join(' '), words } : null;
}

/**
 * Turn human visual intent into bounded positive/negative terms.
 * Negation comes from explicit markers in the query clause and from the
 * reviewed direction's rejected alternative — both stay labelled in the report.
 */
function parseIntent(query, direction, limits) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new DonorIntakeError('DONOR_QUERY', 'Describe the visual intent for this surface in plain words.');
  }
  const raw = text(query, limits.maxQueryChars);
  if (raw.replace(/\s+/g, '').length < 12) {
    throw new DonorIntakeError('DONOR_QUERY', 'Visual intent is too short to search; describe material, tone and what to avoid.');
  }

  const positive = [];
  const negative = [];
  const addTerm = (list, phrase, source) => {
    const term = termFrom(phrase);
    if (!term) return;
    const exists = list.find(t => t.text === term.text);
    if (exists) {
      if (!exists.sources.includes(source)) exists.sources.push(source);
      return;
    }
    list.push({ ...term, sources: [source] });
  };

  for (const clause of raw.split(CLAUSE_SPLIT)) {
    const trimmed = clause.trim();
    if (!trimmed) continue;
    if (NEGATIVE_MARKERS.test(trimmed)) {
      addTerm(negative, trimmed.replace(NEGATIVE_MARKERS, ''), 'query');
      continue;
    }
    if (trimmed.startsWith('-') || trimmed.startsWith('!')) {
      addTerm(negative, trimmed.slice(1), 'query');
      continue;
    }
    for (const part of trimmed.split(/\s+/)) {
      if (part.startsWith('-') && part.length > 2) {
        addTerm(negative, part.slice(1), 'query');
      } else {
        addTerm(positive, part, 'query');
      }
    }
  }

  if (direction.reject) {
    for (const clause of direction.reject.split(CONNECTOR_SPLIT)) {
      const trimmed = clause.trim().replace(NEGATIVE_MARKERS, '');
      if (!trimmed) continue;
      addTerm(negative, trimmed, 'direction-reject');
    }
  }

  const dedupeNegatives = negative.filter(n => !positive.some(p => p.text === n.text));
  const positives = positive.slice(0, limits.maxQueryTerms);
  const negatives = dedupeNegatives.slice(0, limits.maxQueryTerms);
  if (!positives.length) {
    throw new DonorIntakeError('DONOR_QUERY', 'Visual intent needs at least one surface word, not only exclusions.');
  }
  return {
    raw,
    positive: positives,
    negative: negatives,
    directionDecision: direction.decision,
    directionReject: direction.reject
  };
}

/* ------------------------------------------------------------ URL validation */

function isIpish(host) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (host.startsWith('[') || host.includes(':')) return true;
  return host === 'localhost' || /\.(?:localhost|local|internal|localdomain)$/.test(host);
}

/**
 * Validate a URL before it is fetched (kind 'catalog' | 'files' | 'thumb') or
 * pinned for the cook (kind 'map' | 'page'). Nothing else is ever requested.
 */
function checkedUrl(value, { kind, id, slotFile } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new DonorIntakeError('DONOR_URL', `Not a valid URL: ${text(value, 160)}`);
  }
  if (url.protocol !== 'https:') {
    throw new DonorIntakeError('DONOR_URL', `Only HTTPS is allowed: ${url.href}`);
  }
  if (url.username || url.password) {
    throw new DonorIntakeError('DONOR_URL', 'URLs with credentials are refused.');
  }
  if (url.port && url.port !== '443') {
    throw new DonorIntakeError('DONOR_URL', `Non-standard port refused: ${url.href}`);
  }
  const host = url.hostname.toLowerCase();
  if (isIpish(host)) {
    throw new DonorIntakeError('DONOR_HOST', `Private or literal address refused: ${host}`);
  }

  if (kind === 'catalog') {
    if (host !== API_HOST || url.pathname !== '/assets' || url.search !== '?t=textures') {
      throw new DonorIntakeError('DONOR_URL', `Unexpected catalogue endpoint: ${url.href}`);
    }
    return url;
  }

  if (kind === 'files') {
    if (host !== API_HOST || !ASSET_ID.test(id || '')) {
      throw new DonorIntakeError('DONOR_HOST', `Files API must be ${API_HOST} for a valid asset id.`);
    }
    if (url.pathname !== `/files/${id}` || url.search) {
      throw new DonorIntakeError('DONOR_URL', `Unexpected files endpoint: ${url.pathname}${url.search}`);
    }
    return url;
  }

  if (kind === 'thumb') {
    if (!THUMB_HOSTS.has(host) || !ASSET_ID.test(id || '')) {
      throw new DonorIntakeError(
        'DONOR_HOST',
        `Thumbnail host refused: only ${[...THUMB_HOSTS].join('/')} may serve thumbnails for this asset id.`
      );
    }
    if (!new RegExp(`^/asset_img/thumbs/${id}\\.(?:png|webp|jpe?g)$`).test(url.pathname)) {
      throw new DonorIntakeError('DONOR_URL', `Unexpected thumbnail path: ${url.pathname}`);
    }
    for (const [key, val] of url.searchParams) {
      if (!['width', 'height', 'format', 'v'].includes(key)) {
        throw new DonorIntakeError('DONOR_URL', `Unexpected thumbnail parameter: ${key}`);
      }
      if (key === 'width' || key === 'height') {
        const n = Number(val);
        if (!Number.isSafeInteger(n) || n < 16 || n > 1024) {
          throw new DonorIntakeError('DONOR_URL', `Thumbnail ${key} out of range: ${val}`);
        }
      }
      if (key === 'format' && !['webp', 'png', 'jpg'].includes(val)) {
        throw new DonorIntakeError('DONOR_URL', `Unsupported thumbnail format: ${val}`);
      }
    }
    return url;
  }

  if (kind === 'map') {
    if (!FILE_HOSTS.has(host) || !ASSET_ID.test(id || '')) {
      throw new DonorIntakeError('DONOR_HOST', `2K map URLs must come from ${[...FILE_HOSTS].join('/')} for a valid asset id.`);
    }
    // /file/ph-assets/Textures/<fmt>/2k/<id>/<id>_<slot>_2k.<ext>
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 7 || parts[0] !== 'file' || parts[1] !== 'ph-assets' || parts[2] !== 'Textures') {
      throw new DonorIntakeError('DONOR_URL', `Unexpected 2K map path: ${url.pathname}`);
    }
    const [fmt, res, dir, file] = parts.slice(3);
    if (!['jpg', 'png'].includes(fmt) || res !== RESOLUTION || dir !== id) {
      throw new DonorIntakeError('DONOR_URL', `2K map path does not match its asset: ${url.pathname}`);
    }
    if (!new RegExp(`^${id}_${slotFile}_${RESOLUTION}\\.${fmt}$`).test(file)) {
      throw new DonorIntakeError('DONOR_URL', `2K map filename does not match its slot: ${file}`);
    }
    if (url.search) throw new DonorIntakeError('DONOR_URL', `2K map URLs carry no query string: ${url.pathname}`);
    return url;
  }

  if (kind === 'page') {
    if (host !== ASSET_PAGE_HOST || !ASSET_ID.test(id || '') || url.pathname !== `/a/${id}` || url.search) {
      throw new DonorIntakeError('DONOR_URL', `Unexpected asset page: ${url.href}`);
    }
    return url;
  }

  throw new DonorIntakeError('DONOR_URL', `Unvalidated URL kind: ${kind}`);
}

const assetPageUrl = id => `https://polyhaven.com/a/${id}`;
const filesApiUrl = id => `https://api.polyhaven.com/files/${id}`;
const thumbnailUrl = (id, size) =>
  `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=${size}&height=${size}&format=webp`;

/* --------------------------------------------------------------- disk cache */

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

  async write(url, body, meta) {
    await fsp.mkdir(this.root, { recursive: true });
    const base = this.fileFor(url, '');
    await writeAtomic(base + '.bin', body);
    await writeAtomic(
      base + '.json',
      JSON.stringify({ url, fetchedAt: this.now(), ...meta }, null, 2) + '\n'
    );
  }
}

async function writeAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}`;
  await fsp.writeFile(tmp, data);
  await fsp.rm(file, { force: true }).catch(() => {});
  await fsp.rename(tmp, file);
}

/* -------------------------------------------------------------- http layer */

async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new DonorIntakeError(
      'DONOR_SIZE',
      `Response is larger than the ${Math.round(maxBytes / 1024)} KiB cap.`
    );
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new DonorIntakeError('DONOR_SIZE', 'Response exceeded the byte cap.');
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
        throw new DonorIntakeError(
          'DONOR_SIZE',
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

class RunContext {
  constructor({ home, limits, options }) {
    this.home = home;
    this.limits = limits;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.fetchImpl = options.fetch || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new DonorIntakeError('DONOR_FETCH', 'This Node runtime has no fetch(), and no fixture fetch was injected.');
    }
    this.cache = new DiskCache(path.join(home, 'http-cache', 'polyhaven'), limits, this.now);
    this.started = this.now();
    this.deadline = this.started + limits.maxSeconds * 1000;
    this.requestCount = 0;
    this.requests = [];
    this.warnings = [];
  }

  warn(message) {
    if (message && !this.warnings.includes(message)) this.warnings.push(message);
  }

  msLeft() {
    return this.deadline - this.now();
  }

  async takeRequest(url) {
    if (this.requestCount >= this.limits.maxRequests) {
      throw new BudgetStop('DONOR_REQUEST_BUDGET', `Stopped after ${this.limits.maxRequests} requests.`);
    }
    const left = this.msLeft();
    if (left < 500) {
      throw new BudgetStop('DONOR_TIMEOUT', `Stopped after ${this.limits.maxSeconds}s.`);
    }
    this.requestCount++;
    return left;
  }

  logRequest(entry) {
    this.requests.push(entry);
  }
}

const JSON_TYPES = /^application\/(?:json|[a-z0-9.+-]+\+json)\b/i;
const IMAGE_TYPES = /^image\/(?:jpeg|jpg|png|webp)\b/i;

/**
 * One bounded, re-validated HTTPS GET with a disk cache.
 * `kind` decides which allowlist and content type apply.
 */
async function httpGet(url, ctx, { kind, maxBytes, accept, id, slotFile, allow404 = false }) {
  checkedUrl(url, { kind, id, slotFile });
  const cached = await ctx.cache.read(url);
  if (cached?.fresh) {
    ctx.logRequest({ url, kind, status: 200, bytes: cached.body.length, cached: true, ms: 0 });
    return { body: cached.body, cached: true, contentType: cached.meta.contentType || '' };
  }

  let current = url;
  const started = ctx.now();
  try {
    for (let hop = 0; hop <= ctx.limits.maxRedirects; hop++) {
      const left = await ctx.takeRequest(current);
      const signal = AbortSignal.timeout(Math.max(1000, Math.min(left, 20000)));
      const response = await ctx.fetchImpl(current, {
        redirect: 'manual',
        signal,
        headers: {
          accept,
          'accept-language': 'en',
          'user-agent': USER_AGENT
        }
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === ctx.limits.maxRedirects) {
          throw new DonorIntakeError('DONOR_REDIRECT', 'Too many redirects.');
        }
        const location = response.headers.get('location');
        if (!location) throw new DonorIntakeError('DONOR_REDIRECT', 'Redirect without a location.');
        // Re-validate every hop: an off-host redirect never gets fetched.
        current = checkedUrl(new URL(location, current).href, { kind, id, slotFile }).href;
        continue;
      }

      if (response.status === 404 && allow404) return null;
      if (response.status !== 200) {
        throw new DonorIntakeError('DONOR_HTTP', `${current} returned HTTP ${response.status}.`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (kind === 'thumb') {
        if (!IMAGE_TYPES.test(contentType)) {
          throw new DonorIntakeError('DONOR_TYPE', `Not an image (${contentType || 'unknown'}).`);
        }
      } else if (!JSON_TYPES.test(contentType)) {
        throw new DonorIntakeError('DONOR_TYPE', `Not JSON (${contentType || 'unknown'}).`);
      }

      const body = await readCapped(response, maxBytes);
      await ctx.cache.write(current, body, {
        contentType,
        kind,
        expiresAt:
          ctx.now() +
          (kind === 'thumb'
            ? ctx.limits.cacheAssetTtlMs
            : kind === 'catalog'
              ? ctx.limits.cacheCatalogTtlMs
              : ctx.limits.cacheFilesTtlMs)
      });
      ctx.logRequest({
        url,
        kind,
        status: 200,
        bytes: body.length,
        cached: false,
        ms: Math.round(ctx.now() - started)
      });
      return { body, cached: false, contentType };
    }
    throw new DonorIntakeError('DONOR_REDIRECT', 'Too many redirects.');
  } catch (error) {
    if (cached && !(error instanceof BudgetStop)) {
      ctx.warn(`Used stale cache for ${new URL(url).pathname} after a network error.`);
      ctx.logRequest({ url, kind, status: 200, bytes: cached.body.length, cached: true, stale: true, ms: 0 });
      return { body: cached.body, cached: true, stale: true, contentType: cached.meta.contentType || '' };
    }
    throw error;
  }
}

async function getJson(url, ctx, { kind, maxBytes, id } = {}) {
  const hit = await httpGet(url, ctx, {
    kind,
    id,
    maxBytes,
    accept: 'application/json'
  });
  try {
    return { json: JSON.parse(hit.body.toString('utf8')), cached: hit.cached, bytes: hit.body.length };
  } catch {
    throw new DonorIntakeError('DONOR_JSON', `${url} did not return parseable JSON.`);
  }
}

/* --------------------------------------------------------- image inspection */

function imageInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
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
        return { type: 'jpeg', height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
      }
      i += 2 + length;
    }
    return { type: 'jpeg', width: null, height: null };
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buffer.toString('ascii', 12, 16);
    if (kind === 'VP8X' && buffer.length >= 30) {
      return { type: 'webp', width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
    if (kind === 'VP8 ' && buffer.length >= 30) {
      return { type: 'webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (kind === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return { type: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return { type: 'webp', width: null, height: null };
  }
  return null;
}

/* --------------------------------------------------------------- scoring */

const FIELDS = [
  { key: 'name', weight: 3 },
  { key: 'tags', weight: 2.4 },
  { key: 'category', weight: 1.6 },
  { key: 'attributes', weight: 1.4 },
  { key: 'description', weight: 0.8 }
];

const HARD_NEGATIVE_FIELDS = ['name', 'tags', 'category', 'attributes'];

const ROLE_SURFACE = {
  ground: ['ground', 'floor', 'paving'],
  foliage: ['ground', 'floor'],
  landmark: ['object', 'wall', 'roof']
};

function prepareAsset(id, asset) {
  const name = text(asset.name, 200) || id;
  const tags = Array.isArray(asset.tags) ? asset.tags.filter(t => typeof t === 'string').slice(0, 40) : [];
  const categories = Array.isArray(asset.categories)
    ? asset.categories.filter(c => typeof c === 'string').slice(0, 20)
    : [];
  const attributes = asset.attributes && typeof asset.attributes === 'object' ? asset.attributes : {};
  const condition = Array.isArray(attributes.condition)
    ? attributes.condition.filter(c => typeof c === 'string')
    : [];
  const description = text(asset.description, 700);
  const authors = asset.authors && typeof asset.authors === 'object' ? asset.authors : {};
  const maxResolution = Array.isArray(asset.max_resolution)
    ? asset.max_resolution.filter(n => Number.isFinite(n) && n > 0)
    : [];
  const dims = Array.isArray(asset.dimensions)
    ? asset.dimensions.filter(n => Number.isFinite(n) && n > 0)
    : [];

  return {
    id,
    name,
    tags,
    categories,
    category: text(asset.category, 200),
    attributes: {
      surface_use: typeof attributes.surface_use === 'string' ? attributes.surface_use : null,
      origin: typeof attributes.origin === 'string' ? attributes.origin : null,
      setting: typeof attributes.setting === 'string' ? attributes.setting : null,
      aerial: attributes.aerial === true,
      condition
    },
    description,
    authors: Object.entries(authors)
      .filter(([who]) => typeof who === 'string' && who.trim())
      .slice(0, 8)
      .map(([who, link]) => ({
        name: text(who, 80),
        url: typeof link === 'string' && link.startsWith('https://') ? link : null
      })),
    maxResolution,
    dimensionsMm: dims.length === 2 ? [dims[0], dims[1]] : null,
    downloadCount: Number.isFinite(asset.download_count) ? asset.download_count : null,
    publishedAt: Number.isFinite(asset.date_published)
      ? new Date(asset.date_published * 1000).toISOString()
      : null,
    filesHash: typeof asset.files_hash === 'string' ? asset.files_hash : null,
    imgVersion: typeof asset.img_version === 'string' ? asset.img_version : null,
    words: {
      name: new Set(wordsOf(`${name} ${id.replace(/_/g, ' ')}`)),
      tags: new Set(wordsOf(tags.join(' '))),
      category: new Set(wordsOf(`${asset.category || ''} ${categories.join(' ')}`)),
      attributes: new Set(
        wordsOf(
          [attributes.surface_use, attributes.origin, attributes.setting, condition.join(' ')]
            .filter(Boolean)
            .join(' ')
        )
      ),
      description: new Set(wordsOf(description))
    }
  };
}

function termScore(asset, term) {
  let best = 0;
  let field = null;
  let partial = 0;
  for (const f of FIELDS) {
    const hits = term.words.filter(w => asset.words[f.key].has(w)).length;
    if (hits === term.words.length && f.weight > best) {
      best = f.weight;
      field = f.key;
    }
    partial += (hits / term.words.length) * f.weight * 0.2;
  }
  return best ? { score: best, field } : { score: partial, field: null };
}

const matchesAnyField = (asset, term) =>
  FIELDS.some(f => term.words.every(w => asset.words[f.key].has(w)));

/**
 * Weight each intent term by how rare it is in the catalogue, so 'basalt' counts
 * for more than 'dry'. Without this a query's distinctive noun loses to the
 * common adjectives and the board fills with the wrong material.
 */
function applyRarity(intent, prepared) {
  const n = prepared.length || 1;
  const weight = term => {
    let df = 0;
    for (const asset of prepared) if (matchesAnyField(asset, term)) df++;
    const raw = Math.log((1 + n) / (1 + df));
    const rarity = Number(Math.max(0.35, Math.min(4, raw)).toFixed(3));
    return { ...term, documentFrequency: df, rarity };
  };
  return { ...intent, positive: intent.positive.map(weight), negative: intent.negative.map(weight) };
}

function negativeHit(asset, term) {
  const hard = HARD_NEGATIVE_FIELDS.filter(
    key => term.words.every(w => asset.words[key].has(w))
  );
  if (hard.length) return { strength: 'hard', fields: hard };
  if (term.words.every(w => asset.words.description.has(w))) {
    return { strength: 'soft', fields: ['description'] };
  }
  return null;
}

function scoreAsset(asset, intent, role) {
  let score = 0;
  const matched = [];
  for (const term of intent.positive) {
    const hit = termScore(asset, term);
    if (!hit.score) continue;
    score += hit.score * (term.rarity ?? 1);
    if (hit.field) matched.push({ term: term.text, field: hit.field, rarity: term.rarity ?? 1 });
  }
  const negatives = [];
  for (const term of intent.negative) {
    const hit = negativeHit(asset, term);
    if (hit) negatives.push({ term: term.text, ...hit, sources: term.sources });
  }
  // A role hint only nudges a real textual match; it never invents one.
  const surfaces = ROLE_SURFACE[role] || [];
  const roleBoost =
    score > 0 && asset.attributes.surface_use && surfaces.includes(asset.attributes.surface_use) ? 0.8 : 0;
  return {
    score: Math.max(0, Number((score + roleBoost).toFixed(3))),
    matched,
    negatives,
    hardNegatives: negatives.filter(n => n.strength === 'hard'),
    softNegatives: negatives.filter(n => n.strength === 'soft'),
    roleBoost: roleBoost > 0
  };
}

/* ------------------------------------------------------- 2K files manifest */

function mapEntry(slot) {
  return { slot: slot.slot, api: slot.api, file: slot.file };
}

/**
 * Resolve Diffuse / nor_gl / Rough / Displacement from one files manifest.
 * Only the native `2k` key counts; jpg or png rasters only; the URL must name
 * this asset and this slot on the pinned first-party download host.
 */
function resolveMaps(id, manifest) {
  const maps = {};
  const missing = [];
  for (const slot of MAPS) {
    const entry = manifest?.[slot.api];
    const res = entry && typeof entry === 'object' ? entry[RESOLUTION] : null;
    if (!res || typeof res !== 'object') {
      missing.push({ slot: slot.slot, api: slot.api, reason: `no native ${RESOLUTION} entry` });
      continue;
    }
    const format = ['jpg', 'png'].find(
      f => res[f] && typeof res[f] === 'object' && typeof res[f].url === 'string'
    );
    if (!format) {
      missing.push({ slot: slot.slot, api: slot.api, reason: `no jpg/png raster at ${RESOLUTION}` });
      continue;
    }
    const declared = res[format];
    const md5 = typeof declared.md5 === 'string' ? declared.md5.toLowerCase() : '';
    const size = Number(declared.size);
    if (!/^[0-9a-f]{32}$/.test(md5)) {
      missing.push({ slot: slot.slot, api: slot.api, reason: 'no md5 checksum declared' });
      continue;
    }
    if (!Number.isSafeInteger(size) || size <= 0) {
      missing.push({ slot: slot.slot, api: slot.api, reason: 'no byte size declared' });
      continue;
    }
    try {
      const url = checkedUrl(declared.url, { kind: 'map', id, slotFile: slot.file });
      maps[slot.slot] = {
        ...mapEntry(slot),
        resolution: RESOLUTION,
        format,
        url: url.href,
        md5,
        size
      };
    } catch (error) {
      missing.push({ slot: slot.slot, api: slot.api, reason: error.message });
    }
  }
  return { maps, missing, ok: missing.length === 0 };
}

/* -------------------------------------------------------------- thumbnails */

const MIME_BY_TYPE = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const EXT_BY_TYPE = { png: 'png', jpeg: 'jpg', webp: 'webp' };

async function attachThumbnail(asset, ctx, boardDir, reviewedRoot, totals) {
  const source = thumbnailUrl(asset.id, ctx.limits.thumbSize);
  checkedUrl(source, { kind: 'thumb', id: asset.id });
  if (totals.bytes >= ctx.limits.maxTotalThumbBytes) {
    throw new DonorIntakeError('DONOR_SIZE', 'Total thumbnail byte cap reached.');
  }
  const hit = await httpGet(source, ctx, {
    kind: 'thumb',
    id: asset.id,
    maxBytes: ctx.limits.maxThumbBytes,
    accept: 'image/webp,image/png,image/jpeg'
  });
  const info = imageInfo(hit.body);
  if (!info) {
    throw new DonorIntakeError('DONOR_TYPE', 'Thumbnail bytes are not a readable image.');
  }
  if (
    (info.width && info.width < ctx.limits.minThumbWidth) ||
    (info.height && info.height < ctx.limits.minThumbHeight)
  ) {
    throw new DonorIntakeError('DONOR_SIZE', `Thumbnail is only ${info.width || '?'}x${info.height || '?'}.`);
  }
  if (totals.bytes + hit.body.length > ctx.limits.maxTotalThumbBytes) {
    throw new DonorIntakeError('DONOR_SIZE', 'Total thumbnail byte cap reached.');
  }
  const digest = sha256(hit.body);
  const mime = MIME_BY_TYPE[info.type];
  const ext = EXT_BY_TYPE[info.type];
  const canonical = path.join(reviewedRoot, digest);
  let fromCache = fs.existsSync(canonical);
  if (!fromCache) {
    await writeAtomic(canonical, hit.body);
  } else {
    const existing = await fsp.readFile(canonical);
    if (sha256(existing) !== digest) await writeAtomic(canonical, hit.body);
  }
  const boardCopy = path.join(boardDir, 'thumbs', `${digest}.${ext}`);
  await writeAtomic(boardCopy, hit.body);
  if (!fromCache) totals.bytes += hit.body.length;
  totals.count++;
  return {
    sourceUrl: source,
    sha256: digest,
    bytes: hit.body.length,
    width: info.width,
    height: info.height,
    mime,
    file: `thumbs/${digest}.${ext}`,
    cachedPath: canonical,
    fromCache,
    cachedFetch: hit.cached === true
  };
}

/* ----------------------------------------------------------- board render */

function mm(value) {
  return Math.round(value).toLocaleString('en-US');
}

function physicalText(mm2) {
  if (!mm2) return null;
  const [w, h] = mm2;
  return `${mm(w)} × ${mm(h)} mm (${(w / 1000).toFixed(1)} × ${(h / 1000).toFixed(1)} m tiling area)`;
}

function chipList(intent) {
  return intent.positive.map(t => `<span class="chip pos">${esc(t.text)}</span>`).join('');
}

function cardHtml(c) {
  const thumb = c.thumbnail
    ? `<a class="shot" href="${esc(c.thumbnail.file)}" target="_blank" rel="noreferrer">
          <img src="${esc(c.thumbnail.file)}" alt="${esc(c.name)} thumbnail" loading="lazy">
        </a>`
    : `<div class="shot missing">no thumbnail<br><span class="meta">open the asset page</span></div>`;
  const maps = Object.values(c.maps)
    .map(
      m => `<li><b>${esc(m.slot)}</b> · ${esc(m.format)} · ${esc(RESOLUTION)} ·
        ${(m.size / 1024).toFixed(0)} KiB ·
        <a href="${esc(m.url)}" target="_blank" rel="noreferrer">file</a>
        <code>md5 ${esc(m.md5.slice(0, 12))}…</code></li>`
    )
    .join('');
  const artists = c.catalog.artists.length
    ? c.catalog.artists.map(a => (a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noreferrer">${esc(a.name)}</a>` : esc(a.name))).join(', ')
    : '<span class="meta">artist not declared by the catalogue</span>';
  const tags = c.catalog.tags.slice(0, 8).map(t => `<span class="chip">${esc(t)}</span>`).join('');
  const matched = c.matched.length
    ? c.matched.map(m => `<span class="chip hit">${esc(m.term)} · ${esc(m.field)}</span>`).join('')
    : '<span class="meta">no direct term hit</span>';
  const soft = c.softNegatives.length
    ? `<p class="warnline">Weak warning: ${c.softNegatives
        .map(n => `<code>${esc(n.term)}</code> appears only in the description`)
        .join(', ')}. Inspect before choosing.</p>`
    : '';
  const grouped = unique(c.catalog.categories).slice(0, 6).join(' · ');
  return `
      <article class="card">
        ${thumb}
        <div class="body">
          <h3>${esc(c.name)} <span class="muted">${esc(c.id)}</span></h3>
          <div class="chips">
            <span class="chip ok">4/4 maps @ ${esc(RESOLUTION)}</span>
            <span class="chip role">${esc(c.role)}</span>
            ${c.catalog.attributes.surface_use ? `<span class="chip">${esc(c.catalog.attributes.surface_use)}</span>` : ''}
            <span class="chip">score ${esc(c.score)}</span>
          </div>
          <p class="meta">${esc(c.catalog.category || grouped || 'uncategorised')}</p>
          ${grouped ? `<p class="meta">${esc(grouped)}</p>` : ''}
          ${tags ? `<div class="chips">${tags}</div>` : ''}
          <p class="desc">${esc(c.catalog.description || '(no description)')}</p>
          <p class="artist"><b>Artist:</b> ${artists}</p>
          <p class="meta">${esc(physicalText(c.catalog.dimensionsMm) || 'physical size not declared')}
            · max ${esc((c.catalog.maxResolution || []).join('×') || '?')} px
            · ${esc(c.catalog.downloadCount ?? '?')} downloads
            · published ${esc(c.catalog.publishedAt || '?')}</p>
          <p class="meta">Matched: ${matched}</p>
          ${soft}
          <p class="meta">Verified maps (pinned md5 + size from the first-party files API; binaries not downloaded at intake):</p>
          <ul class="maps">${maps}</ul>
          <p class="meta">
            <a href="${esc(c.pageUrl)}" target="_blank" rel="noreferrer">asset page</a>
            · <a href="${esc(c.pinned.filesApi)}" target="_blank" rel="noreferrer">files API</a>
            ${c.thumbnail ? ` · thumbnail <code>${esc(c.thumbnail.sha256.slice(0, 16))}…</code>` : ''}
            ${c.catalog.filesHash ? ` · set <code>${esc(c.catalog.filesHash.slice(0, 12))}…</code>` : ''}
          </p>
        </div>
      </article>`;
}

function boardHtml(report) {
  const rejected = report.rejected
    .map(
      r => `<li><code>${esc(r.id || '?')}</code> — ${esc(r.reason)}${
        r.detail?.length
          ? `: ${r.detail.map(d => (typeof d === 'string' ? esc(d) : esc(`${d.slot}: ${d.reason}`))).join('; ')}`
          : ''
      }</li>`
    )
    .join('');
  const negatives = report.query.negative
    .map(n => `<span class="chip neg">${esc(n.text)} · ${esc(n.sources.join('/'))}</span>`)
    .join('');
  const direction = report.direction;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(direction.role)} donors — ${esc(direction.planet || report.job.planet || report.job.id || 'unlinked job')}</title>
<style>
  :root { color-scheme: dark; --bg:#101215; --panel:#181c21; --line:#2c333c; --ink:#e8edf2; --muted:#98a4b3; --accent:#e7b04a; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui,sans-serif; }
  h1 { margin:0 0 4px; font-size:24px; } h2 { margin:26px 0 8px; font-size:17px; }
  .warn { border-left:3px solid var(--accent); background:#211c12; padding:10px 14px; margin:14px 0; }
  .muted { color:var(--muted); } code { font:12px ui-monospace,monospace; color:#b9c7d8; }
  ul { margin:6px 0; padding-left:20px; } li { margin:2px 0; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:14px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .shot img { display:block; width:100%; height:auto; background:#0b0d10; }
  .shot.missing { padding:32px 12px; text-align:center; color:var(--muted); background:#0b0d10; }
  .body { padding:10px 12px 12px; } h3 { margin:2px 0 8px; font-size:16px; }
  h3 .muted { font-size:12px; font-weight:400; }
  .chips { display:flex; gap:6px; flex-wrap:wrap; margin:4px 0 6px; }
  .chip { font-size:11px; padding:2px 7px; border-radius:999px; background:#25303b; }
  .chip.ok { background:#17452f; color:#b8ffd6; } .chip.pos { background:#17332a; color:#c8f5dd; }
  .chip.neg { background:#40202a; color:#ffd0dc; } .chip.hit { background:#1d3348; color:#cfe7ff; }
  .chip.role { background:#2a2640; color:#d9d1ff; }
  .desc { margin:6px 0 8px; } .meta { margin:2px 0; color:var(--muted); font-size:12px; }
  .artist { margin:6px 0; font-size:13px; } .warnline { border-left:2px solid #7a5a1c; padding-left:10px; font-size:12px; }
  .maps { font-size:12px; } a { color:#9ecbff; } details { margin-top:18px; }
  summary { cursor:pointer; color:var(--muted); }
</style>
</head>
<body>
<h1>${esc(direction.role)} donors — ${esc(direction.planet || report.job.planet || 'unlinked job')}</h1>
<p class="warn"><b>Candidates, not approval.</b> Nothing here is chosen, applied, cooked, registered or shipped.
  This is a private local review board: compare the thumbnails against the inspected planet references, then decide the
  material, its slots and the cook yourself.</p>
<p class="muted">Board <code>${esc(report.id)}</code> · ${esc(report.generatedAt)} · ${report.seconds.toFixed(1)}s ·
  ${report.candidates.length} verified candidate(s) · ${report.requests.length} request(s) ·
  ${esc(report.catalog.assets)} catalogue asset(s) · job ${esc(report.job.id || 'unlinked')} (${esc(report.job.scope || 'no scope')})</p>

<h2>Reviewed direction</h2>
${direction.decision
    ? `<p>${esc(direction.decision)}</p>`
    : `<p class="warn">No reviewed decision attached: this board was run from the bare role <code>${esc(direction.role)}</code>.
        Treat the search as a starting point, not a reading of the planet.</p>`}
${direction.reject ? `<p class="muted"><b>Rejected in review:</b> ${esc(direction.reject)}</p>` : ''}
<p class="muted">Direction source: ${esc(direction.roleSource)}${direction.file ? ` · <code>${esc(direction.file)}</code>` : ''}</p>

<h2>Search intent</h2>
<p>${esc(report.query.raw)}</p>
<div class="chips">${chipList(report.query)}</div>
<div class="chips">${negatives}</div>
<p class="muted">Positive terms are scored against name, tags, category, catalogue attributes and description in that order of weight.
  A negative term found in name/tags/category/attributes removes a candidate; a description-only hit is only a warning.</p>

<h2>Donor candidates</h2>
<div class="grid">${report.candidates.map(cardHtml).join('')}</div>
${report.warnings.length ? `<h2>Warnings</h2><ul>${report.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}

<details><summary>Rejected (${report.rejected.length})</summary>
<ul>${rejected || '<li>none</li>'}</ul>
</details>
<p class="muted">Report: <code>${esc(report.paths.report)}</code> ·
  thumbnails cached beside inspected references in <code>${esc(report.paths.reviewedImages)}</code>.</p>
</body>
</html>
`;
}

/* ------------------------------------------------------------ report paths */

function reportKey(job, direction, query) {
  const stem = job?.id ? job.id.replace(/[^a-z0-9]+/gi, '').slice(0, 12) || 'job' : 'nojob';
  const intent = sha256(query.raw).slice(0, 10);
  return `${stem}-${direction.role}-${intent}`.toLowerCase();
}

function stableId(job, direction, query) {
  return sha256(
    `terrain-donor-intake/v1|${JSON.stringify({
      job: job?.id || null,
      planet: job?.planet || direction.planet || null,
      role: direction.role,
      direction: direction.decision || null,
      reject: direction.reject || null,
      query: query.raw,
      catalog: CATALOG_URL
    })}`
  );
}

/* ------------------------------------------------------------------ public */

/**
 * Build a private donor comparison board for one surface direction.
 *
 * @param {object|null} job workbench job; only id/planet/scope are recorded
 * @param {string|object} direction reviewed direction document, its path, or ground/foliage/landmark
 * @param {string} query human visual intent, in plain words
 * @param {string} [home] temp home; defaults to OS temp/terrain-donor-intake-v1
 * @param {{fetch?:Function, now?:Function, limits?:object, role?:string}} [options] test hooks
 * @returns {Promise<object>} report with absolute `paths` and a convenience `board` path
 */
export async function donorBoard(job, direction, query, home, options = {}) {
  const j = parseJob(job);
  const root = path.resolve(home || DEFAULT_HOME);
  const limits = sanitizeLimits(options.limits);
  const d = parseDirection(direction, options);
  const intent = parseIntent(query, d, limits);
  const id = stableId(j, d, intent);
  const ctx = new RunContext({ home: root, limits, options });

  const key = reportKey(j, d, intent);
  const dir = path.join(root, 'donors', key);
  const reviewedRoot = path.join(root, 'references', 'reviewed-images');
  const paths = {
    root,
    dir,
    board: path.join(dir, `${id}.html`),
    latestBoard: path.join(dir, 'board.html'),
    report: path.join(dir, `${id}.json`),
    latestReport: path.join(dir, 'report.json'),
    thumbnails: path.join(dir, 'thumbs'),
    reviewedImages: reviewedRoot
  };

  const rejected = [];
  const searched = {
    considered: 0,
    scored: 0,
    notNative2k: 0,
    negativeRejected: 0,
    duplicateRejected: 0,
    filesChecked: 0,
    incomplete: 0,
    filesErrors: 0,
    selected: 0
  };
  const catalog = {
    url: CATALOG_URL,
    assets: 0,
    bytes: 0,
    cached: false,
    fetchedAt: new Date(ctx.now()).toISOString()
  };
  let catalogBody = null;
  try {
    catalogBody = await getJson(CATALOG_URL, ctx, {
      kind: 'catalog',
      maxBytes: limits.maxCatalogBytes
    });
    catalog.assets = catalogBody.json && typeof catalogBody.json === 'object'
      ? Object.keys(catalogBody.json).length
      : 0;
    catalog.bytes = catalogBody.bytes;
    catalog.cached = catalogBody.cached;
  } catch (error) {
    if (error instanceof DonorIntakeError) throw error;
    throw new DonorIntakeError(
      'DONOR_CATALOG',
      `Poly Haven texture catalogue is unavailable: ${error.message}`,
      { report: null, requests: ctx.requests }
    );
  }
  const rawCatalog = catalogBody.json;
  if (!rawCatalog || typeof rawCatalog !== 'object' || Array.isArray(rawCatalog)) {
    throw new DonorIntakeError('DONOR_CATALOG', 'Catalogue JSON is not an object keyed by asset id.');
  }

  const prepared = [];
  for (const [assetId, asset] of Object.entries(rawCatalog)) {
    if (!ASSET_ID.test(assetId) || !asset || typeof asset !== 'object') continue;
    searched.considered++;
    const preparedAsset = prepareAsset(assetId, asset);
    const tooSmall =
      preparedAsset.maxResolution.length !== 2 ||
      preparedAsset.maxResolution.some(n => n < MIN_EDGE);
    if (tooSmall) {
      searched.notNative2k++;
      rejected.push({
        id: assetId,
        name: preparedAsset.name,
        reason: 'not-native-2k',
        detail: [`max resolution ${preparedAsset.maxResolution.join('×') || 'unknown'} < ${MIN_EDGE}`]
      });
      continue;
    }
    prepared.push(preparedAsset);
  }
  const weightedIntent = applyRarity(intent, prepared);

  const ranked = prepared
    .map(asset => ({ asset, ...scoreAsset(asset, weightedIntent, d.role) }))
    .filter(entry => {
      if (entry.hardNegatives.length) {
        searched.negativeRejected++;
        rejected.push({
          id: entry.asset.id,
          name: entry.asset.name,
          reason: 'negative-term',
          detail: entry.hardNegatives.map(n => `${n.term} in ${n.fields.join('/')}`)
        });
        return false;
      }
      return entry.score > 0;
    })
    .sort(
      (x, y) =>
        y.score - x.score ||
        (y.asset.downloadCount || 0) - (x.asset.downloadCount || 0) ||
        x.asset.id.localeCompare(y.asset.id)
    );
  searched.scored = ranked.length;

  if (!ranked.length) {
    const failure = failureReport({
      id,
      j,
      d,
      intent: weightedIntent,
      error: {
        code: 'DONOR_NO_MATCH',
        message:
          `No catalogue texture matches "${intent.raw}" without a rejected term. ` +
          'Describe the material you can see (substance, grain, tone) and try again.'
      },
      catalog,
      searched,
      rejected,
      ctx,
      limits,
      paths
    });
    await writeFailure(failure, paths);
    throw new DonorIntakeError('DONOR_NO_MATCH', failure.error.message, {
      report: paths.report,
      latestReport: paths.latestReport,
      rejected: rejected.slice(0, 40)
    });
  }

  // Pick the best sets first, verify the four native 2K maps, then download thumbnails.
  const selected = [];
  const seenSets = new Set();
  const thumbTotals = { bytes: 0, count: 0 };
  let budgetHit = null;

  for (const entry of ranked) {
    if (selected.length >= limits.maxCandidates) break;
    const setKey = entry.asset.filesHash || entry.asset.id;
    if (seenSets.has(setKey)) {
      searched.duplicateRejected++;
      rejected.push({
        id: entry.asset.id,
        name: entry.asset.name,
        reason: 'duplicate-set',
        detail: [`same files_hash as an earlier candidate (${entry.asset.filesHash?.slice(0, 12)}…)`]
      });
      continue;
    }
    if (searched.filesChecked >= limits.maxFilesChecks) {
      ctx.warn(`Stopped verifying manifests after ${limits.maxFilesChecks} files checks; raise maxFilesChecks to inspect more.`);
      break;
    }
    searched.filesChecked++;
    let manifest;
    try {
      const hit = await getJson(filesApiUrl(entry.asset.id), ctx, {
        kind: 'files',
        id: entry.asset.id,
        maxBytes: limits.maxFilesBytes
      });
      manifest = hit.json;
    } catch (error) {
      if (error instanceof BudgetStop) {
        budgetHit = error;
        break;
      }
      searched.filesErrors++;
      rejected.push({
        id: entry.asset.id,
        name: entry.asset.name,
        reason: 'files-api-error',
        detail: [error.message]
      });
      continue;
    }
    if (!manifest || typeof manifest !== 'object') {
      searched.filesErrors++;
      rejected.push({ id: entry.asset.id, name: entry.asset.name, reason: 'files-api-shape', detail: ['manifest is not an object'] });
      continue;
    }
    const resolved = resolveMaps(entry.asset.id, manifest);
    if (!resolved.ok) {
      searched.incomplete++;
      rejected.push({
        id: entry.asset.id,
        name: entry.asset.name,
        reason: 'incomplete-2k-set',
        detail: resolved.missing
      });
      continue;
    }
    seenSets.add(setKey);
    selected.push({ ...entry, maps: resolved.maps });
  }

  if (!selected.length) {
    const failure = failureReport({
      id,
      j,
      d,
      intent: weightedIntent,
      error: {
        code: 'DONOR_NO_VERIFIED',
        message:
          'No candidate passed the four-map native 2K check (diffuse, nor_gl, rough, disp). ' +
          'None of these sets can feed a cook; nothing was selected.'
      },
      catalog,
      searched,
      rejected,
      ctx,
      limits,
      paths
    });
    await writeFailure(failure, paths);
    throw new DonorIntakeError('DONOR_NO_VERIFIED', failure.error.message, {
      report: paths.report,
      latestReport: paths.latestReport,
      rejected: rejected.slice(0, 40)
    });
  }

  for (const entry of selected) {
    try {
      entry.thumbnail = await attachThumbnail(entry.asset, ctx, dir, reviewedRoot, thumbTotals);
    } catch (error) {
      entry.thumbnail = null;
      if (error instanceof BudgetStop) {
        budgetHit = error;
        ctx.warn(`Thumbnail download stopped by budget: ${error.message}`);
        break;
      }
      ctx.warn(`Thumbnail unavailable for ${entry.asset.id}: ${error.message}`);
    }
  }

  if (budgetHit) ctx.warn(budgetHit.message);
  searched.selected = selected.length;

  const candidates = selected.map(entry => {
    const a = entry.asset;
    const maps = Object.fromEntries(
      Object.entries(entry.maps).map(([slot, m]) => [
        slot,
        {
          slot: m.slot,
          api: m.api,
          resolution: m.resolution,
          format: m.format,
          url: m.url,
          md5: m.md5,
          size: m.size,
          path: new URL(m.url).pathname
        }
      ])
    );
    return {
      id: a.id,
      name: a.name,
      role: d.role,
      score: entry.score,
      matched: entry.matched,
      softNegatives: entry.softNegatives.map(n => ({ term: n.term, sources: n.sources })),
      roleHint: entry.roleBoost,
      pageUrl: assetPageUrl(a.id),
      api: { catalog: CATALOG_URL, files: filesApiUrl(a.id) },
      catalog: {
        artists: a.authors,
        tags: a.tags,
        categories: a.categories,
        category: a.category,
        description: a.description,
        attributes: a.attributes,
        maxResolution: a.maxResolution,
        dimensionsMm: a.dimensionsMm,
        downloadCount: a.downloadCount,
        publishedAt: a.publishedAt,
        filesHash: a.filesHash,
        imgVersion: a.imgVersion
      },
      verification: {
        ok: true,
        resolution: RESOLUTION,
        native: Math.min(...a.maxResolution) >= MIN_EDGE,
        required: MAPS.map(m => m.slot),
        maps: Object.keys(maps),
        checkedAt: new Date(ctx.now()).toISOString(),
        note:
          'First-party files API declares all four maps at native 2K with md5 and byte size. ' +
          'Binaries are pinned but not downloaded at intake; verify md5 at cook time.'
      },
      maps,
      pinned: {
        assetPage: assetPageUrl(a.id),
        catalogApi: CATALOG_URL,
        filesApi: filesApiUrl(a.id),
        filesHash: a.filesHash,
        imgVersion: a.imgVersion,
        thumbnailSha256: entry.thumbnail?.sha256 || null,
        checksums: Object.fromEntries(Object.values(maps).map(m => [m.slot, { md5: m.md5, size: m.size, url: m.url }]))
      },
      thumbnail: entry.thumbnail
    };
  });

  const report = {
    format: FORMAT,
    kind: 'terrain-donor-candidates',
    donor: 'polyhaven',
    approval: false,
    autoApproved: false,
    requiresHumanReview: true,
    note:
      'Candidates for human visual review, not approval. Nothing was chosen, applied, cooked, registered or shipped. ' +
      'Private local cache.',
    id,
    generatedAt: new Date(ctx.now()).toISOString(),
    seconds: Math.max(0, (ctx.now() - ctx.started) / 1000),
    job: j,
    direction: {
      role: d.role,
      roleSource: d.roleSource,
      planet: d.planet || j.planet || null,
      job: d.job,
      file: d.file,
      decision: d.decision,
      reject: d.reject
    },
    query: {
      raw: intent.raw,
      positive: weightedIntent.positive.map(t => ({
        text: t.text,
        sources: t.sources,
        documentFrequency: t.documentFrequency,
        rarity: t.rarity
      })),
      negative: intent.negative.map(t => ({ text: t.text, sources: t.sources }))
    },
    catalog,
    search: searched,
    candidates,
    rejected: rejected.slice(0, 60),
    requests: ctx.requests,
    warnings: ctx.warnings,
    bounds: {
      maxCandidates: limits.maxCandidates,
      maxRequests: limits.maxRequests,
      maxFilesChecks: limits.maxFilesChecks,
      maxCatalogBytes: limits.maxCatalogBytes,
      maxFilesBytes: limits.maxFilesBytes,
      maxThumbBytes: limits.maxThumbBytes,
      maxTotalThumbBytes: limits.maxTotalThumbBytes,
      maxSeconds: limits.maxSeconds
    },
    paths
  };

  const json = JSON.stringify(report, null, 2) + '\n';
  const html = boardHtml(report);
  await writeAtomic(paths.report, json);
  await writeAtomic(paths.latestReport, json);
  await writeAtomic(paths.board, html);
  await writeAtomic(paths.latestBoard, html);

  return { ...report, board: paths.board, reportFile: paths.report };
}

function failureReport({ id, j, d, intent, error, catalog, searched, rejected, ctx, limits, paths }) {
  return {
    format: FORMAT,
    kind: 'terrain-donor-failure',
    donor: 'polyhaven',
    approval: false,
    autoApproved: false,
    requiresHumanReview: true,
    note: 'No usable donor candidates. Nothing was selected, applied or cooked. Private local audit record.',
    id,
    generatedAt: new Date(ctx.now()).toISOString(),
    seconds: Math.max(0, (ctx.now() - ctx.started) / 1000),
    job: j,
    direction: {
      role: d.role,
      roleSource: d.roleSource,
      planet: d.planet || j.planet || null,
      file: d.file,
      decision: d.decision,
      reject: d.reject
    },
    query: {
      raw: intent.raw,
      positive: intent.positive.map(t => ({
        text: t.text,
        sources: t.sources,
        documentFrequency: t.documentFrequency,
        rarity: t.rarity
      })),
      negative: intent.negative.map(t => ({ text: t.text, sources: t.sources }))
    },
    error,
    catalog,
    search: searched,
    requests: ctx.requests,
    rejected: rejected.slice(0, 60),
    warnings: ctx.warnings,
    bounds: { maxCandidates: limits.maxCandidates, maxRequests: limits.maxRequests, maxSeconds: limits.maxSeconds },
    paths: { ...paths, board: null, latestBoard: null }
  };
}

async function writeFailure(report, paths) {
  const json = JSON.stringify(report, null, 2) + '\n';
  await writeAtomic(paths.report, json);
  await writeAtomic(paths.latestReport, json);
}

/* ---------------------------------------------------------------- internals */

export const internals = Object.freeze({
  CATALOG_URL,
  USER_AGENT,
  API_HOST,
  FILE_HOSTS,
  THUMB_HOSTS,
  MIN_EDGE,
  checkedUrl,
  parseIntent,
  parseDirection,
  prepareAsset,
  resolveMaps,
  scoreAsset,
  imageInfo,
  sanitizeLimits,
  text,
  wordsOf,
  boardHtml
});
