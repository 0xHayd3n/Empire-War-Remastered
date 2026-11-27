/**
 * Offline fixture tests for references.mjs. No network, no checkout writes.
 * Run: node --test test-references.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {
  collectManyReferences,
  collectReferences,
  internals,
  ReferenceIntakeError
} from './references.mjs';

const SITEMAP = 'https://www.starwars.com/sitemap.xml';
const CHILD_0 = 'https://www.starwars.com/sitemap-0.xml';
const CHILD_1 = 'https://www.starwars.com/sitemap-1.xml';
const CDN = 'https://lumiere-a.akamaihd.net/v1/images/';
const YAVIN_DB = 'https://www.starwars.com/databank/yavin-4';
const YAVIN_GALLERY = 'https://www.starwars.com/yavin-4-history-gallery';
const ENDOR_DB = 'https://www.starwars.com/databank/endor';
const ENDOR_GALLERY = 'https://www.starwars.com/endor-history-gallery';
const SHA40 = 'b'.repeat(40);

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c ^= byte;
    for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function png(width = 640, height = 360, seed = 0) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const i = y * stride + 1 + x * 3;
      raw[i] = (seed * 37 + x) & 0xff;
      raw[i + 1] = (seed * 53 + y) & 0xff;
      raw[i + 2] = (seed * 71 + x + y) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const sha256 = value => createHash('sha256').update(value).digest('hex');

function xml(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset>${urls
    .map(url => `<url><loc>${url}</loc></url>`)
    .join('')}</urlset>`;
}

function databankPage({ name, slug, description, terrains, imageUrl }) {
  return `<!doctype html><html><head>
<meta property="og:title" content="${name} | Star Wars Databank">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${imageUrl}">
<title>${name} | Star Wars Databank</title></head><body>
<img class="thumb reserved-ratio" src="${imageUrl}" alt="${name}">
<img class="thumb reserved-ratio" src="${CDN}Death-Star-I-copy_36ad2500_fixture.png" alt="Death Star">
<script>window.__RECORD__ = {"content_path":"/databank/${slug}","terrains":${JSON.stringify(
    terrains
  )},"climates":["Temperate"],"image_asset":{"_id":"x","api_params":{},"asset_type":"PNG","base_url":"${imageUrl}","height":360,"sha":"${SHA40}","width":640}};</script>
</body></html>`;
}

function galleryPage({ title, hero, thumbs, extra = '' }) {
  return `<!doctype html><html><head>
<meta property="og:title" content="${title}">
<meta property="og:image" content="${CDN}og-generic_02031d2b_fixture.png">
<title>${title}</title></head><body>
<img src="${CDN}tiktok-logo-white_dd1a4867.svg" alt="TikTok">
<img src="${CDN}sw_logo_stacked_2x-52b4f6d33087_7ef430af.png" alt="Star Wars Logo">
<img src="${CDN}star-wars-galaxy-map-shared-desktop_1f515fc1.png" alt="Galaxy map">
<img src="${CDN}sw_nav_kids_937ed58b.svg" alt="Star Wars Kids">
<img src="${hero}" alt="">
${thumbs.map(t => `<img class="thumbnail-image" src="${t.url}" alt="${t.alt}">`).join('')}
<img class="thumb reserved-ratio" src="${CDN}coruscant-city_fixture.png" alt="Coruscant city">
${extra}
</body></html>`;
}

function fixture({
  yavin = true,
  endor = false,
  yavinThumbs = null,
  yavinExtra = '',
  limits = null
} = {}) {
  const routes = new Map();
  const calls = [];
  const databank = [];
  const galleries = [];
  if (yavin) {
    databank.push(YAVIN_DB);
    galleries.push(YAVIN_GALLERY);
  }
  if (endor) {
    databank.push(ENDOR_DB);
    galleries.push(ENDOR_GALLERY);
  }
  routes.set(SITEMAP, {
    headers: { 'content-type': 'application/xml' },
    body: `<?xml version="1.0" encoding="UTF-8"?><sitemapindex><sitemap><loc>${CHILD_0}</loc></sitemap><sitemap><loc>${CHILD_1}</loc></sitemap></sitemapindex>`
  });
  routes.set(CHILD_0, {
    headers: { 'content-type': 'application/xml' },
    body: xml([...databank, ...galleries])
  });
  routes.set(CHILD_1, { headers: { 'content-type': 'application/xml' }, body: xml([]) });

  const yavinShot = CDN + 'databank_yavin4_01_169_fixture.png';
  const yavinJungle = CDN + 'yavin-jungle-floor_fixture.png';
  const yavinCanopy = CDN + 'yavin-jungle-canopy_fixture.png';
  const yavinHero = CDN + 'yavin-4-bio-1_fixture.png';
  const yavinContext = CDN + 'yavin-ceremony_fixture.png';
  const yavinSpace = CDN + 'yavin-space-battle_fixture.png';
  const evil = 'https://evil.example/x.png';
  const privateIp = 'https://127.0.0.1/x.png';
  const lookalike = 'https://lumiere-a.akamaihd.net.evil.example/x.png';
  const redirect = CDN + 'redirect_fixture.png';

  if (yavin) {
    routes.set(YAVIN_DB, {
      headers: { 'content-type': 'text/html' },
      body: databankPage({
        name: 'Yavin 4',
        slug: 'yavin-4',
        description: 'A steamy world covered in jungle and forest.',
        terrains: ['Forests', 'Jungles'],
        imageUrl: yavinShot
      })
    });
    routes.set(YAVIN_GALLERY, {
      headers: { 'content-type': 'text/html' },
      body: galleryPage({
        title: 'Yavin 4 History Gallery | Star Wars',
        hero: yavinHero,
        thumbs: yavinThumbs || [
          {
            url: yavinJungle,
            alt: 'A steamy jungle moon; an ancient stone temple rises from the jungle floor. Yavin 4 & "stone" ground.'
          },
          {
            url: yavinCanopy,
            alt: 'Squadrons rise above Yavin 4’s jungle canopy.'
          },
          {
            url: yavinContext,
            alt: 'A ceremony on Yavin 4 after the battle.'
          },
          {
            url: yavinSpace,
            alt: 'X-wings attack the Death Star above Yavin 4’s jungle.'
          },
          { url: evil, alt: 'Yavin 4 jungle from an untrusted host.' },
          { url: privateIp, alt: 'Yavin 4 jungle from a private address.' },
          { url: lookalike, alt: 'Yavin 4 jungle from a lookalike host.' },
          { url: redirect, alt: 'Yavin 4 jungle behind an off-host redirect.' }
        ],
        extra: yavinExtra
      })
    });
    routes.set(redirect, {
      status: 302,
      headers: { location: 'https://evil.example/redirected.png' }
    });
    for (const [url, seed] of [
      [yavinShot, 1],
      [yavinJungle, 2],
      [yavinCanopy, 3],
      [yavinHero, 4],
      [yavinContext, 5],
      [yavinSpace, 9]
    ]) {
      const bytes = png(640, 360, seed);
      routes.set(url, {
        headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) },
        body: bytes
      });
    }
  }

  if (endor) {
    const endorShot = CDN + 'databank_endor_01_169_fixture.png';
    const endorForest = CDN + 'endor-forest-moon_fixture.png';
    routes.set(ENDOR_DB, {
      headers: { 'content-type': 'text/html' },
      body: databankPage({
        name: 'Endor',
        slug: 'endor',
        description: 'A remote forest moon with grasslands and mountains.',
        terrains: ['Grasslands', 'Mountains'],
        imageUrl: endorShot
      })
    });
    routes.set(ENDOR_GALLERY, {
      headers: { 'content-type': 'text/html' },
      body: galleryPage({
        title: 'Endor History Gallery | Star Wars',
        hero: CDN + 'Endor-1-cropped_fixture.png',
        thumbs: [
          {
            url: endorForest,
            alt: 'Among the ancient trees of the lush green forest moon of Endor.'
          }
        ]
      })
    });
    for (const [url, seed] of [
      [endorShot, 6],
      [endorForest, 7],
      [CDN + 'Endor-1-cropped_fixture.png', 8]
    ]) {
      const bytes = png(640, 360, seed);
      routes.set(url, {
        headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) },
        body: bytes
      });
    }
  }

  const fakeFetch = async (url, init) => {
    calls.push(String(url));
    const route = routes.get(String(url));
    if (!route) {
      return new Response('missing', { status: 404, headers: { 'content-type': 'text/html' } });
    }
    if (typeof route === 'function') return route(url, init);
    return new Response(route.body, {
      status: route.status || 200,
      headers: route.headers || {}
    });
  };
  return { fakeFetch, routes, calls, limits };
}

function tempHome(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `planet-ref-${label}-`));
}

const job = { id: 'fixture-job', scope: 'fixture', file: 'fixture' };

test('Yavin 4 fixture: searches catalogue, downloads bytes, covers ground and foliage', async () => {
  const home = tempHome('yavin');
  const { fakeFetch, calls } = fixture();
  const report = await collectReferences(job, 'Yavin 4', home, { fetch: fakeFetch });

  assert.equal(report.approval, false);
  assert.match(report.note, /not approval/i);
  assert.equal(report.searched.catalogue.matchedSlug, 'yavin-4');
  assert.equal(report.coverage.ground.state, 'covered');
  assert.equal(report.coverage.foliage.state, 'covered');
  assert.equal(report.complete, true);
  assert.equal(report.confirmed, true);
  assert.ok(report.candidates.length >= 2, `expected databank and jungle-floor leads, got ${report.candidates.length}`);
  assert(!report.candidates.some(c=>/ceremony|squadrons rise/i.test(c.caption)), 'story stills do not pad a location board');
  assert.ok(report.requests.length < report.bounds.maxRequests, 'request budget must stay bounded');

  for (const candidate of report.candidates) {
    assert.match(candidate.directUrl, /^https:\/\/lumiere-a\.akamaihd\.net\/v1\/images\//);
    assert.match(candidate.file, /^images\/[a-f0-9]{64}\.png$/);
    assert.ok(candidate.bytes > 0);
    assert.ok(candidate.width >= 480 && candidate.height >= 240);
    assert.doesNotMatch(candidate.caption, /TikTok|Star Wars Logo|Galaxy map/i);
    const filePath = path.join(report.paths.dir, candidate.file);
    const bytes = fs.readFileSync(filePath);
    assert.equal(sha256(bytes), candidate.sha256);
    assert.equal(bytes.length, candidate.bytes);
  }

  assert.ok(fs.existsSync(report.paths.report));
  assert.ok(fs.existsSync(report.paths.latestReport));
  assert.ok(fs.existsSync(report.paths.board));
  assert.ok(fs.existsSync(report.paths.latestBoard));
  assert.ok(report.paths.report.includes(path.join('planets', 'yavin-4')));
  assert.ok(report.paths.report.endsWith(report.id + '.json'));

  const board = fs.readFileSync(report.paths.board, 'utf8');
  assert.match(board, /Candidates, not approval\./);
  assert.match(board, /src="images\/[a-f0-9]{64}\.png"/);
  assert.doesNotMatch(board, /<img[^>]+src="https:\/\//);
  assert.ok(!board.includes('<script>alert(1)</script>'));
  const spaceShot = report.candidates.find(c => /Death Star above Yavin 4/i.test(c.caption));
  assert.equal(spaceShot,undefined,'an orbital establishing shot is not a land reference');

  const json = JSON.parse(fs.readFileSync(report.paths.report, 'utf8'));
  assert.equal(json.kind, 'planet-reference-candidates');
  assert.equal(json.approval, false);
  assert.equal(json.id, report.id);
  assert.equal(json.coverage.ground.state, 'covered');

  // Page chrome, unrelated cards, evil hosts and off-host redirects never fetched.
  assert.ok(!calls.some(url => url.includes('evil.example')));
  assert.ok(!calls.some(url => url.includes('127.0.0.1')));
  assert.ok(!calls.some(url => url.includes('lumiere-a.akamaihd.net.evil.example')));
  assert.ok(!calls.some(url => url.includes('tiktok-logo')));
  assert.ok(!calls.some(url => url.includes('sw_logo')));
  assert.ok(!calls.some(url => url.includes('galaxy-map')));
  assert.ok(report.rejected.some(row => /untrusted host|allowlist|Private|HTTPS|redirect/i.test(row.reason)));

  // Stable report id across a fresh cache with the same fixture.
  const otherHome = tempHome('yavin-stable');
  const second = fixture();
  const repeat = await collectReferences(job, 'Yavin 4', otherHome, { fetch: second.fakeFetch });
  assert.equal(repeat.id, report.id);

  // Offline rerun from the first home serves page and image bytes from cache.
  const offline = await collectReferences(job, 'Yavin 4', home, {
    fetch: async () => {
      throw new Error('offline');
    }
  });
  assert.equal(offline.id, report.id);
  assert.equal(offline.candidates.length, report.candidates.length);
  assert.ok(offline.requests.some(row => row.cached));
});

test('multiple planets keep separate reports and boards; thin ground is reported honestly', async () => {
  const home = tempHome('many');
  const { fakeFetch } = fixture({ endor: true });
  const aggregate = await collectManyReferences(job, ['Yavin 4', 'Endor'], home, {
    fetch: fakeFetch
  });

  assert.equal(aggregate.results.length, 2);
  assert.equal(aggregate.failures.length, 0);
  assert.equal(aggregate.status, 'complete');
  assert.ok(fs.existsSync(aggregate.paths.report));
  assert.ok(fs.existsSync(aggregate.paths.board));
  const index = fs.readFileSync(aggregate.paths.board, 'utf8');
  assert.match(index, /Yavin 4/);
  assert.match(index, /Endor/);
  assert.match(index, /Candidates, not approval\./);

  const yavin = aggregate.results.find(r => r.planet.key === 'yavin-4');
  const endor = aggregate.results.find(r => r.planet.key === 'endor');
  assert.ok(yavin && endor);
  assert.notEqual(yavin.paths.dir, endor.paths.dir);
  assert.equal(yavin.coverage.ground.state, 'covered');
  assert.equal(endor.coverage.foliage.state, 'covered');
  assert.equal(endor.coverage.ground.state, 'thin');
  assert.equal(endor.status, 'partial');
  assert.ok(endor.warnings.some(w => /Ground is thin/.test(w)));
  assert.ok(fs.existsSync(yavin.paths.board));
  assert.ok(fs.existsSync(endor.paths.board));
});

test('empty search fails clearly and leaves a failure report', async () => {
  const home = tempHome('empty');
  const { fakeFetch } = fixture();
  await assert.rejects(
    () => collectReferences(job, 'Nowhere', home, { fetch: fakeFetch }),
    error => {
      assert.ok(error instanceof ReferenceIntakeError);
      assert.equal(error.code, 'REFERENCE_INTAKE_EMPTY');
      assert.match(error.message, /No relevant ground\/foliage reference images found for Nowhere/);
      assert.ok(error.details.report);
      assert.ok(fs.existsSync(error.details.report));
      const failure = JSON.parse(fs.readFileSync(error.details.report, 'utf8'));
      assert.equal(failure.kind, 'planet-reference-failure');
      assert.equal(failure.approval, false);
      assert.equal(failure.error.code, 'REFERENCE_INTAKE_EMPTY');
      return true;
    }
  );
});

test('image count and request caps bound a large gallery', async () => {
  const home = tempHome('bounds');
  const thumbs = [];
  const routes = [];
  for (let i = 0; i < 12; i++) {
    const url = CDN + `yavin-jungle-${i}_fixture.png`;
    thumbs.push({ url, alt: `Yavin 4 jungle floor and stone ground ${i}` });
    routes.push([url, i + 20]);
  }
  const base = fixture({ yavinThumbs: thumbs });
  for (const [url, seed] of routes) {
    const bytes = png(640, 360, seed);
    base.routes.set(url, {
      headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) },
      body: bytes
    });
  }
  const report = await collectReferences(
    job,
    { name: 'Yavin 4', limits: { maxImages: 3, maxRequests: 10 } },
    home,
    { fetch: base.fakeFetch }
  );
  assert.equal(report.candidates.length, 3);
  assert.equal(report.bounds.maxImages, 3);
  assert.equal(report.searched.imageDownloads.attempted, 3);
  const imageCalls = base.calls.filter(url => url.endsWith('.png') && url.includes('/v1/images/'));
  assert.ok(imageCalls.length <= 3, `downloaded ${imageCalls.length} images`);
});

test('URL guard rejects non-HTTPS, private, lookalike, query and chrome URLs', () => {
  assert.throws(
    () => internals.checkedUrl('http://www.starwars.com/databank/yavin-4'),
    /Only HTTPS/
  );
  assert.throws(() => internals.checkedUrl('https://evil.example/x'), /allowlist/);
  assert.throws(() => internals.checkedUrl('https://127.0.0.1/x'), /Private/);
  assert.throws(
    () => internals.checkedUrl('https://lumiere-a.akamaihd.net.evil.example/v1/images/x.png', undefined, { image: true }),
    /allowlist/
  );
  assert.throws(
    () => internals.checkedUrl('https://www.starwars.com/search?q=yavin'),
    /Query-string/
  );
  assert.throws(
    () => internals.normalizeImageUrl(`${CDN}logo_fixture.svg`, YAVIN_DB),
    /Unsupported image path/
  );
  assert.throws(
    () => internals.normalizeImageUrl(`${CDN}sw_logo_stacked_2x.png`, YAVIN_DB),
    /Page chrome/
  );
});

test('planet aliases and aspect classification are deterministic', () => {
  const planet = internals.parsePlanet({ name: 'Yavin 4', aliases: ['Yavin'] });
  assert.equal(planet.key, 'yavin-4');
  assert.deepEqual(planet.tokens, ['yavin']);
  assert.equal(internals.aspectStrength(internals.inferAspects('jungle floor and stone ground')).ground, 'strong');
  assert.equal(internals.aspectStrength(internals.inferAspects('jungle floor and stone ground')).foliage, 'strong');
  assert.equal(internals.aspectStrength(internals.inferAspects('forest moon')).ground, 'weak');
  assert.equal(internals.aspectStrength(internals.inferAspects('forest moon')).foliage, 'strong');
});
