/**
 * Offline fixture tests for polyhaven.mjs. No network, no checkout writes.
 * Run: node --test test-polyhaven.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { DEFAULT_LIMITS, DonorIntakeError, donorBoard, internals } from './polyhaven.mjs';

const WORKBENCH = path.join(os.tmpdir(),'polyhaven-intake-tests');
const CATALOG = internals.CATALOG_URL;

/* ------------------------------------------------------------------ fixtures */

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

function png(width = 128, height = 128, seed = 0) {
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
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const md5 = value => createHash('md5').update(value).digest('hex');

const API_KEY = {
  diffuse: 'Diffuse',
  nor_gl: 'nor_gl',
  rough: 'Rough',
  disp: 'Displacement'
};
const FILE_TAG = { diffuse: 'diff', nor_gl: 'nor_gl', rough: 'rough', disp: 'disp' };

function mapUrl(id, slot) {
  return `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/${id}/${id}_${FILE_TAG[slot]}_2k.jpg`;
}

/** A first-party files manifest with a subset of the four 2K maps. */
function manifest(id, slots = ['diffuse', 'nor_gl', 'rough', 'disp']) {
  const out = {};
  slots.forEach((slot, index) => {
    out[API_KEY[slot]] = {
      '2k': {
        jpg: {
          url: mapUrl(id, slot),
          md5: md5(`${id}:${slot}`),
          size: 500000 + index * 1000
        },
        png: {
          url: mapUrl(id, slot).replace('/jpg/', '/png/').replace(/\.jpg$/, '.png'),
          md5: md5(`png:${id}:${slot}`),
          size: 900000 + index * 1000
        }
      }
    };
  });
  return out;
}

function asset(id, overrides = {}) {
  return {
    type: 1,
    tags: [],
    categories: ['terrain', 'rock'],
    category: 'Stone/Rock & Cliffs',
    attributes: { surface_use: 'ground', origin: 'natural', setting: 'outdoor', condition: ['dry'] },
    authors: { 'Marta Nowak': 'All' },
    max_resolution: [8192, 8192],
    dimensions: [12000, 12000],
    download_count: 1000,
    date_published: 1600000000,
    files_hash: `set-${id}`,
    img_version: 'v1',
    description: 'A dry mineral surface.',
    name: id.replace(/_/g, ' '),
    ...overrides
  };
}

function thumbUrl(id) {
  return `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=384&height=384&format=webp`;
}

function fixture({ thumbRedirect = null } = {}) {
  const catalog = {
    dry_cracked_basalt: asset('dry_cracked_basalt', {
      name: 'Dry Cracked Basalt "Chipped"',
      tags: ['dry', 'cracked', 'basalt', 'dust', 'grit', 'fine', 'pale', 'sparse', 'rock'],
      description:
        'Dry cracked basalt with fine pale dust, sparse grit & angular chips <2 mm. <script>alert(1)</script><img src=x onerror=alert(2)>',
      dimensions: [15000, 9000],
      download_count: 4200
    }),
    basalt_set_copy: asset('basalt_set_copy', {
      name: 'Dry Cracked Basalt Alt',
      tags: ['dry', 'cracked', 'basalt', 'dust', 'grit', 'fine', 'pale', 'sparse'],
      files_hash: 'set-dry_cracked_basalt',
      download_count: 900
    }),
    basalt_dry_incomplete: asset('basalt_dry_incomplete', {
      name: 'Dry Cracked Basalt Ridge',
      tags: ['dry', 'cracked', 'basalt', 'dust', 'grit', 'fine'],
      download_count: 800
    }),
    weathered_basalt_flow: asset('weathered_basalt_flow', {
      name: 'Weathered Basalt Flow',
      tags: ['basalt', 'weathered', 'dry', 'cracked', 'grit'],
      download_count: 300
    }),
    cliffside_basalt_wall: asset('cliffside_basalt_wall', {
      name: 'Cliffside Basalt Wall',
      tags: ['cracked', 'basalt', 'dry'],
      attributes: { surface_use: 'wall', origin: 'natural', setting: 'outdoor', condition: ['dry'] },
      download_count: 200
    }),
    lush_grass_meadow: asset('lush_grass_meadow', {
      name: 'Lush Grass Meadow',
      tags: ['grass', 'green', 'meadow', 'ground'],
      description: 'Lush grass meadow ground.',
      download_count: 9000
    }),
    snow_dusted_basalt: asset('snow_dusted_basalt', {
      name: 'Snow Dusted Basalt',
      tags: ['snow', 'basalt', 'cold'],
      description: 'Basalt under snow.',
      download_count: 5000
    }),
    basalt_lowres: asset('basalt_lowres', {
      name: 'Dry Cracked Basalt Small',
      tags: ['dry', 'cracked', 'basalt', 'dust', 'grit'],
      max_resolution: [1024, 1024],
      download_count: 7000
    })
  };

  const routes = new Map();
  const calls = [];

  routes.set(CATALOG, () => ({
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(catalog)
  }));
  for (const id of Object.keys(catalog)) {
    routes.set(`https://api.polyhaven.com/files/${id}`, () => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        id === 'basalt_dry_incomplete' ? manifest(id, ['diffuse', 'nor_gl', 'rough']) : manifest(id)
      )
    }));
    const bytes = png(128, 128, id.length);
    routes.set(thumbUrl(id), () => {
      if (thumbRedirect && id === thumbRedirect) {
        return { status: 302, headers: { location: 'https://evil.example/thumb.png' } };
      }
      return {
        headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) },
        body: bytes
      };
    });
  }

  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers || {} });
    const route = routes.get(String(url));
    if (!route) return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
    const hit = route();
    return new Response(hit.body, { status: hit.status || 200, headers: hit.headers || {} });
  };
  return { fakeFetch, routes, calls, catalog };
}

function tempHome(label) {
  fs.mkdirSync(WORKBENCH, { recursive: true });
  return fs.mkdtempSync(path.join(WORKBENCH, `test-${label}-`));
}

const directionDoc = {
  job: 'fixture-job',
  planet: 'Yavin 4',
  views: [{ sha256: 'a'.repeat(64) }, { sha256: 'b'.repeat(64) }],
  ground: {
    decision: 'Dry cracked basalt with pale dust and sparse grit; harsh starlight, no water sheen.',
    reject: 'Lush grass, wet mud and snow',
    evidence: ['a'.repeat(64)]
  },
  foliage: {
    decision: 'Sparse scrub, dry and low to the ground.',
    reject: 'Broadleaf jungle canopy',
    evidence: ['b'.repeat(64)]
  },
  uncertain: 'Whether any ground cover survives the dry season.'
};

const job = { id: 'fixture-job', planet: 'Yavin 4', scope: 'fixture', file: 'fixture' };
const INTENT = 'dry cracked basalt, fine pale dust, sparse grit; no grass, no snow';

/* --------------------------------------------------------------------- tests */

test('builds a private board from verified native 2K sets and rejects the rest', async () => {
  const home = tempHome('main');
  const { fakeFetch, calls } = fixture();
  const report = await donorBoard(job, directionDoc, INTENT, home, {
    fetch: fakeFetch,
    role: 'ground',
    limits: { maxCandidates: 2, maxFilesChecks: 5 }
  });

  assert.equal(report.kind, 'terrain-donor-candidates');
  assert.equal(report.approval, false);
  assert.equal(report.autoApproved, false);
  assert.equal(report.requiresHumanReview, true);
  assert.match(report.note, /not approval/i);
  assert.equal(report.direction.role, 'ground');
  assert.equal(report.direction.roleSource, 'reviewed-direction');
  assert.match(report.direction.decision, /Dry cracked basalt/);
  assert.equal(report.job.id, 'fixture-job');

  // Selection: best verified set, then the next verified set; duplicate, incomplete,
  // negatively matched and non-native-2K sets never become donors.
  assert.equal(report.candidates.length, 2, JSON.stringify(report.candidates.map(c => c.id)));
  assert.deepEqual(
    report.candidates.map(c => c.id),
    ['dry_cracked_basalt', 'weathered_basalt_flow']
  );

  for (const candidate of report.candidates) {
    assert.equal(candidate.verification.ok, true);
    assert.equal(candidate.verification.resolution, '2k');
    assert.equal(candidate.verification.native, true);
    assert.deepEqual(candidate.verification.required, ['diffuse', 'nor_gl', 'rough', 'disp']);
    assert.deepEqual(Object.keys(candidate.maps).sort(), ['diffuse', 'disp', 'nor_gl', 'rough']);
    for (const map of Object.values(candidate.maps)) {
      assert.match(map.url, /^https:\/\/dl\.polyhaven\.org\/file\/ph-assets\/Textures\/jpg\/2k\//);
      assert.match(map.path, new RegExp(`/2k/${candidate.id}/${candidate.id}_`));
      assert.match(map.md5, /^[0-9a-f]{32}$/);
      assert.ok(map.size > 0);
      assert.equal(map.resolution, '2k');
    }
    // Pinned first-party URLs/checksums + artist/physical metadata.
    assert.equal(candidate.pinned.assetPage, `https://polyhaven.com/a/${candidate.id}`);
    assert.equal(candidate.pinned.filesApi, `https://api.polyhaven.com/files/${candidate.id}`);
    assert.deepEqual(Object.keys(candidate.pinned.checksums).sort(), ['diffuse', 'disp', 'nor_gl', 'rough']);
    assert.equal(candidate.catalog.artists[0].name, 'Marta Nowak');
    assert.equal(candidate.catalog.dimensionsMm.length, 2);
    assert.deepEqual(candidate.catalog.maxResolution, [8192, 8192]);
    // Human-review artifact exists and is content-addressed beside the reference cache.
    assert.ok(candidate.thumbnail, 'thumbnail should be cached');
    const cached = fs.readFileSync(candidate.thumbnail.cachedPath);
    assert.equal(
      candidate.thumbnail.cachedPath,
      path.join(home, 'references', 'reviewed-images', candidate.thumbnail.sha256)
    );
    assert.equal(createHash('sha256').update(cached).digest('hex'), candidate.thumbnail.sha256);
    assert.ok(fs.existsSync(path.join(report.paths.dir, candidate.thumbnail.file)));
    assert.equal(candidate.thumbnail.bytes, cached.length);
  }
  assert.deepEqual(
    report.candidates.map(c => c.catalog.dimensionsMm),
    [
      [15000, 9000],
      [12000, 12000]
    ],
    'per-asset physical size comes from the catalogue'
  );

  const reasons = report.rejected.map(r => r.reason);
  assert.ok(reasons.includes('negative-term'), reasons.join(','));
  assert.ok(reasons.includes('not-native-2k'), reasons.join(','));
  assert.ok(reasons.includes('duplicate-set'), reasons.join(','));
  assert.ok(reasons.includes('incomplete-2k-set'), reasons.join(','));
  const incomplete = report.rejected.find(r => r.id === 'basalt_dry_incomplete');
  assert.equal(incomplete.reason, 'incomplete-2k-set');
  assert.deepEqual(incomplete.detail.map(d => d.slot), ['disp']);
  assert.ok(!report.candidates.some(c => c.id === 'basalt_dry_incomplete'));
  assert.ok(report.rejected.some(r => r.id === 'lush_grass_meadow' && /grass/.test(JSON.stringify(r.detail))));
  assert.ok(report.rejected.some(r => r.id === 'snow_dusted_basalt' && /snow/.test(JSON.stringify(r.detail))));

  // Negative terms are labelled by source.
  const negatives = report.query.negative.map(n => n.text);
  assert.ok(negatives.includes('grass'));
  assert.ok(negatives.includes('snow'));
  assert.ok(report.query.negative.some(n => n.sources.includes('direction-reject')));
  assert.ok(
    report.query.positive.every(p => Number.isFinite(p.documentFrequency) && Number.isFinite(p.rarity)),
    'each positive term carries its catalogue rarity'
  );

  // Bounds and endpoint discipline.
  assert.ok(report.requests.length <= report.bounds.maxRequests);
  const hosts = new Set(calls.map(c => new URL(c.url).hostname));
  assert.deepEqual([...hosts].sort(), ['api.polyhaven.com', 'cdn.polyhaven.com']);
  for (const call of calls) {
    assert.equal(call.headers['user-agent'], internals.USER_AGENT);
    assert.match(call.headers['user-agent'], /EmpireWarRemastered/);
  }
  assert.ok(!calls.some(c => c.url.includes('dl.polyhaven.org')), 'intake must not fetch 2K binaries');

  // Files and board.
  for (const file of [report.paths.report, report.paths.latestReport, report.paths.board, report.paths.latestBoard]) {
    assert.ok(fs.existsSync(file), `missing ${file}`);
  }
  assert.equal(report.board, report.paths.board);
  assert.equal(report.reportFile, report.paths.report);
  assert.ok(report.paths.dir.startsWith(home));

  const board = fs.readFileSync(report.paths.board, 'utf8');
  assert.match(board, /Candidates, not approval\./);
  assert.match(board, /Nothing here is chosen, applied, cooked, registered or shipped/);
  assert.match(board, /noindex,nofollow/);
  assert.doesNotMatch(board, /<script/i);
  assert.doesNotMatch(board, /<img[^>]*onerror/i);
  assert.match(board, /Basalt &quot;Chipped&quot;/);
  assert.match(board, /sparse grit &amp; angular chips/);
  assert.doesNotMatch(board, /<img[^>]+src="https:\/\//, 'board must render only local thumbnails');
  assert.match(board, /src="thumbs\/[a-f0-9]{64}\.png"/);
  assert.match(board, /4\/4 maps @ 2k/);
  assert.match(board, /Dry cracked basalt/);
  assert.match(board, /Marta Nowak/);
  assert.match(board, /15,000 × 9,000 mm/);
  assert.match(board, /grass/);
  assert.doesNotMatch(board, /undefined/);

  // Same inputs, same report id; a fresh home still converges on the same identity.
  const again = await donorBoard(job, directionDoc, INTENT, tempHome('main-2'), {
    fetch: fixture().fakeFetch,
    role: 'ground',
    limits: { maxCandidates: 2, maxFilesChecks: 5 }
  });
  assert.equal(again.id, report.id);
});

test('missing 2K maps fail the whole candidate instead of downgrading it', async () => {
  const home = tempHome('incomplete');
  const { fakeFetch } = fixture();
  const report = await donorBoard(job, directionDoc, INTENT, home, {
    fetch: fakeFetch,
    role: 'ground',
    limits: { maxCandidates: 1, maxFilesChecks: 5 }
  });
  assert.equal(report.candidates[0].id, 'dry_cracked_basalt');
  assert.ok(
    !report.rejected.some(r => r.id === 'basalt_dry_incomplete'),
    'candidate cap is reached before the bad set is inspected'
  );
  assert.ok(report.search.filesChecked >= 1);

  // Force only the incomplete set to be reachable: no verified candidate survives.
  const routes = fixture();
  const onlyIncomplete = async (url, init) => {
    if (String(url) === CATALOG) {
      return new Response(
        JSON.stringify({
          basalt_dry_incomplete: routes.catalog.basalt_dry_incomplete,
          lush_grass_meadow: routes.catalog.lush_grass_meadow
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return routes.fakeFetch(url, init);
  };
  const emptyHome = tempHome('no-verified');
  await assert.rejects(
    donorBoard(job, directionDoc, INTENT, emptyHome, {
      fetch: onlyIncomplete,
      role: 'ground',
      limits: { maxCandidates: 3 }
    }),
    error => {
      assert.ok(error instanceof DonorIntakeError);
      assert.equal(error.code, 'DONOR_NO_VERIFIED');
      assert.ok(fs.existsSync(error.details.report));
      const failure = JSON.parse(fs.readFileSync(error.details.report, 'utf8'));
      assert.equal(failure.kind, 'terrain-donor-failure');
      assert.equal(failure.approval, false);
      assert.ok(failure.rejected.some(r => r.reason === 'incomplete-2k-set'));
      return true;
    }
  );
});

test('unmatched intent fails closed and records why', async () => {
  const home = tempHome('nomatch');
  const { fakeFetch, calls } = fixture();
  await assert.rejects(
    donorBoard(job, 'ground', 'polished chrome microscope slide, machined aluminium', home, { fetch: fakeFetch }),
    error => {
      assert.equal(error.code, 'DONOR_NO_MATCH');
      const failure = JSON.parse(fs.readFileSync(error.details.report, 'utf8'));
      assert.equal(failure.kind, 'terrain-donor-failure');
      assert.equal(failure.error.code, 'DONOR_NO_MATCH');
      assert.equal(failure.search.filesChecked, 0, 'no manifest is fetched when nothing matches');
      return true;
    }
  );
  assert.equal(calls.filter(c => c.url !== CATALOG).length, 0);
});

test('a bare role still renders a board but states there is no reviewed decision', async () => {
  const home = tempHome('role-only');
  const report = await donorBoard(job, 'ground', INTENT, home, {
    fetch: fixture().fakeFetch,
    limits: { maxCandidates: 1 }
  });
  assert.equal(report.direction.role, 'ground');
  assert.equal(report.direction.roleSource, 'role-only');
  assert.equal(report.direction.decision, null);
  const board = fs.readFileSync(report.paths.board, 'utf8');
  assert.match(board, /No reviewed decision attached/);
});

test('an off-host thumbnail redirect is refused and recorded, not followed', async () => {
  const home = tempHome('redirect');
  const { fakeFetch, calls } = fixture({ thumbRedirect: 'dry_cracked_basalt' });
  const report = await donorBoard(job, directionDoc, INTENT, home, {
    fetch: fakeFetch,
    role: 'ground',
    limits: { maxCandidates: 1 }
  });
  assert.equal(report.candidates[0].id, 'dry_cracked_basalt');
  assert.equal(report.candidates[0].thumbnail, null);
  assert.ok(
    report.warnings.some(w => /dry_cracked_basalt/.test(w) && /refused/i.test(w)),
    report.warnings.join(' | ')
  );
  assert.ok(calls.every(c => new URL(c.url).hostname !== 'evil.example'));
  const reviewed = path.join(home, 'references', 'reviewed-images');
  assert.ok(!fs.existsSync(reviewed) || !fs.readdirSync(reviewed).length);
});

test('input validation happens before any request or write', async () => {
  const home = tempHome('validation');
  const { fakeFetch, calls } = fixture();

  await assert.rejects(
    donorBoard(job, directionDoc, 'dry', home, { fetch: fakeFetch, role: 'ground' }),
    error => error.code === 'DONOR_QUERY'
  );
  await assert.rejects(
    donorBoard(job, directionDoc, 'no grass, no snow, no mud', home, { fetch: fakeFetch, role: 'ground' }),
    error => error.code === 'DONOR_QUERY'
  );
  await assert.rejects(
    donorBoard(job, directionDoc, INTENT, home, {
      fetch: fakeFetch,
      role: 'ground',
      limits: { maxCatalogBytes: 512 }
    }),
    error => error.code === 'DONOR_SIZE'
  );
  // Two roles, no options.role -> refused rather than guessed.
  await assert.rejects(
    donorBoard(job, directionDoc, INTENT, tempHome('ambiguous'), { fetch: fakeFetch }),
    error => error.code === 'DONOR_DIRECTION'
  );
  assert.equal(calls.filter(c => c.url === CATALOG).length, 1, 'only the catalogue size probe reached the network');
  assert.equal(DEFAULT_LIMITS.maxCandidates, 6);
});

test('limits can only tighten the defaults', () => {
  const limits = internals.sanitizeLimits({
    maxCandidates: 99,
    maxCandidateCap: 3,
    maxRequests: 9999,
    maxSeconds: 100000,
    maxCatalogBytes: 1
  });
  assert.equal(limits.maxCandidates, DEFAULT_LIMITS.maxCandidateCap);
  assert.equal(limits.maxRequests, 60);
  assert.equal(limits.maxSeconds, 300);
  assert.equal(limits.maxCatalogBytes, 1);
});

test('map and host validation rejects lookalike or private endpoints', () => {
  const id = 'dry_cracked_basalt';
  assert.throws(
    () =>
      internals.checkedUrl('https://evil.polyhaven.org/file/ph-assets/Textures/jpg/2k/x/x_diff_2k.jpg', {
        kind: 'map',
        id,
        slotFile: 'diff'
      }),
    /first-party|must come from/i
  );
  assert.throws(
    () =>
      internals.checkedUrl(
        'http://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/' + id + '/' + id + '_diff_2k.jpg',
        { kind: 'map', id, slotFile: 'diff' }
      ),
    /HTTPS/i
  );
  assert.throws(
    () => internals.checkedUrl('https://10.0.0.5/file/ph-assets/', { kind: 'map', id, slotFile: 'diff' }),
    /Private|literal/i
  );
  assert.throws(
    () =>
      internals.checkedUrl(
        `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/4k/${id}/${id}_diff_4k.jpg`,
        { kind: 'map', id, slotFile: 'diff' }
      ),
    /2K|path/i
  );
  assert.throws(
    () =>
      internals.checkedUrl(
        `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/${id}/${id}_rough_2k.jpg`,
        { kind: 'map', id, slotFile: 'diff' }
      ),
    /slot/i
  );
  assert.throws(
    () => internals.checkedUrl('https://api.polyhaven.com/assets?t=hdris', { kind: 'catalog' }),
    /catalogue endpoint/i
  );
  assert.throws(
    () => internals.checkedUrl('https://api.polyhaven.com/files/../assets', { kind: 'files', id }),
    /files endpoint/i
  );
  assert.ok(
    internals
      .checkedUrl(`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/${id}/${id}_diff_2k.jpg`, {
        kind: 'map',
        id,
        slotFile: 'diff'
      })
      .href.includes('_diff_2k.jpg')
  );
});
