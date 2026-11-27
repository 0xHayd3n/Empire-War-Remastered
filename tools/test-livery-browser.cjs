// Optional integration test: compiles the generated Army Painter shader in a
// real WebGL context and reads pixels back. Requires Chrome, no retail data.
// CHROME=<path to chrome> node tools/test-livery-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

globalThis.fetch = async () => new Response(null, { status: 404 });

const CHROME =
  process.env.CHROME ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].find(f => fs.existsSync(f));

const SIZE = 64;

(async () => {
  assert(CHROME, 'Chrome not found; set CHROME=<path>');
  const livery = await import(pathToFileURL(path.join(__dirname, '../public/js/livery.js')).href);
  const { programSources } = await import(pathToFileURL(path.join(__dirname, '../public/js/model.js')).href);
  const full = JSON.stringify({ vert: programSources.VERT, frag: programSources.FRAG });

  const VERT = `
precision highp float;
#define LIVERY 1
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
${livery.LIVERY_VERT_DECL}
void main() {
  vUv = uv;
  ${livery.LIVERY_VERT_SET}
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
  const FRAG = `
precision highp float;
#define LIVERY 1
uniform sampler2D map;
varying vec2 vUv;
${livery.LIVERY_FRAG_DECL}
void main() {
  vec4 base = texture2D(map, vUv);
  vec3 albedo = base.rgb;
  ${livery.LIVERY_FRAG_APPLY}
  gl_FragColor = vec4(albedo, 1.0);
}`;

  const palette = [
    [0.24, 0.35, 0.5],
    [0.93, 0.42, 0.3],
    [0.88, 0.98, 0.99],
    [0.16, 0.2, 0.25]
  ];
  // The shader mixes `albedo` with `paint * shade` where shade follows the
  // texture luma; predict it here so pixels can be attributed to a channel.
  const GREY = 128 / 255;
  const shade = Math.min(1.65, Math.max(0.14, 0.52 + 1.15 * GREY));
  const expected = palette.map(c => c.map(v => GREY * (1 - livery.LIVERY_AMOUNT) + v * shade * livery.LIVERY_AMOUNT));

  const page = `<!doctype html><meta charset="utf-8"><body><script>
const VERT = ${JSON.stringify(VERT)};
const FRAG = ${JSON.stringify(FRAG)};
const SIZE = ${SIZE};
const patterns = ${JSON.stringify(livery.LIVERY_PATTERNS)};
const palette = ${JSON.stringify(palette)};
const colors = ${JSON.stringify(expected.map(rgb => rgb.map(v => Math.round(v * 255))))};
const full = ${full};
const result = { errors: [], patterns: {}, stock: null, full: {} };

const canvas = document.createElement('canvas');
canvas.width = canvas.height = SIZE;
const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
result.webgl = gl && typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 2 : 1;

const compile = (type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { result.errors.push(gl.getShaderInfoLog(shader)); result.failed = true; }
  return shader;
};
const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { result.errors.push(gl.getProgramInfoLog(program)); result.failed = true; }
if (result.failed) { document.body.textContent = JSON.stringify(result); throw new Error('shader'); }
gl.useProgram(program);

// A 65x65 mesh whose model-space z follows the screen's vertical axis, so the
// z-based patterns (standard/banded) and the x-based split all get to show.
const verts = [], indices = [];
for (let j = 0; j <= SIZE; j++) {
  for (let i = 0; i <= SIZE; i++) {
    const x = (i / SIZE) * 2 - 1, y = (j / SIZE) * 2 - 1;
    verts.push(x, y, y, x * 0.5 + 0.5, y * 0.5 + 0.5);
  }
}
for (let j = 0; j < SIZE; j++) {
  for (let i = 0; i < SIZE; i++) {
    const a = j * (SIZE + 1) + i, b = a + 1, c = a + SIZE + 1, d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
}
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
const ibo = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
const positionAt = gl.getAttribLocation(program, 'position'), uvAt = gl.getAttribLocation(program, 'uv');
gl.enableVertexAttribArray(positionAt);
gl.vertexAttribPointer(positionAt, 3, gl.FLOAT, false, 20, 0);
gl.enableVertexAttribArray(uvAt);
gl.vertexAttribPointer(uvAt, 2, gl.FLOAT, false, 20, 12);

const texture = (stripe) => {
  const tex = document.createElement('canvas');
  tex.width = tex.height = SIZE;
  const g = tex.getContext('2d');
  for (let x = 0; x < SIZE; x++) {
    const v = stripe ? 96 + (x % 8 < 4 ? 40 : 0) : 128;
    g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
    g.fillRect(x, 0, 1, SIZE);
  }
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
};

gl.activeTexture(gl.TEXTURE0);
gl.uniform1i(gl.getUniformLocation(program, 'map'), 0);
gl.uniform3f(gl.getUniformLocation(program, 'liveryCenter'), 0, 0, 0);
gl.uniform3f(gl.getUniformLocation(program, 'liveryHalf'), 1, 1, 1);
const params = gl.getUniformLocation(program, 'liveryParams');
palette.forEach((c, i) => gl.uniform4f(gl.getUniformLocation(program, 'liveryColor' + i), c[0], c[1], c[2], 1));

const draw = (textureUnit, amount) => {
  gl.bindTexture(gl.TEXTURE_2D, textureUnit);
  gl.uniform4f(params, 0, amount, 0, 0);
  gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return Array.from({ length: SIZE * SIZE }, (_, i) => [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]]);
};

// The real model shader must still compile with LIVERY on, next to the stock
// defines it meets in a battle. This mirrors the GLSL3 prefix three.js adds.
const NL = String.fromCharCode(10);
const VERT_PREFIX = [
  '#version 300 es',
  'precision highp float;',
  'uniform mat4 modelMatrix, viewMatrix, projectionMatrix;',
  'in vec3 position;',
  'in vec3 normal;',
  'in vec2 uv;',
  '#define attribute in',
  '#define varying out',
  '#define texture2D texture'
];
const FRAG_PREFIX = [
  '#version 300 es',
  'precision highp float;',
  'uniform mat4 modelMatrix, viewMatrix, projectionMatrix;',
  'uniform vec3 cameraPosition;',
  'out vec4 pc_fragColor;',
  '#define gl_FragColor pc_fragColor',
  '#define varying in',
  '#define texture2D texture'
];
const fullProgram = (defines) => {
  const head = VERT_PREFIX.concat(
    defines.map(d => '#define ' + d),
    ['precision highp float;']
  ).join(NL);
  const fragHead = FRAG_PREFIX.concat(
    defines.map(d => '#define ' + d),
    ['precision highp float;']
  ).join(NL);
  const vs = compile(gl.VERTEX_SHADER, head + NL + full.vert);
  const fs = compile(gl.FRAGMENT_SHADER, fragHead + NL + full.frag);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  const ok = !!gl.getProgramParameter(p, gl.LINK_STATUS);
  if (!ok) result.errors.push(gl.getProgramInfoLog(p));
  gl.deleteProgram(p);
  return ok;
};
result.full.plain = fullProgram(['LIVERY 1']);
result.full.colorized = fullProgram(['LIVERY 1', 'COLORIZE 1', 'USE_VCOLOR 1']);
result.full.alpha = fullProgram(['LIVERY 1', 'ALPHA 1', 'GLOSSMAP 1']);
result.full.stock = fullProgram([]);

const flat = texture(false), stripe = texture(true);
// amount 0 is the stock path: the texture must come through untouched.
result.stock = draw(flat, 0);
for (const pattern of patterns) {
  gl.bindTexture(gl.TEXTURE_2D, flat);
  gl.uniform4f(params, patterns.indexOf(pattern), ${livery.LIVERY_AMOUNT}, 0, 0);
  gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  result.patterns[pattern] = Array.from({ length: SIZE * SIZE }, (_, i) => [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]]);
}
result.stripes = draw(stripe, ${livery.LIVERY_AMOUNT});
document.body.textContent = JSON.stringify(result);
</script>`;

  const file = path.join(os.tmpdir(), 'livery-browser-check.html');
  fs.writeFileSync(file, page);
  const run = spawnSync(
    CHROME,
    ['--headless=new', '--enable-unsafe-swiftshader', '--allow-file-access-from-files', '--dump-dom', pathToFileURL(file).href],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 }
  );
  const dom = run.stdout || '';
  const json = /(<body>)({[\s\S]*?})(<\/body>)/.exec(dom);
  assert(json, 'no result from Chrome: ' + (run.stderr || dom).slice(0, 800));
  const result = JSON.parse(json[2]);
  assert.deepEqual(result.errors, [], 'the generated shader compiles cleanly');
  assert.equal(result.webgl >= 1, true);
  assert.deepEqual(result.full, { plain: true, colorized: true, alpha: true, stock: true }, 'full model shader compiles with LIVERY');

  const px = ({ 0: r, 1: g, 2: b }) => [r, g, b];

  // Stock path: amount 0 leaves the texture untouched.
  for (const pixel of result.stock) assert(Math.abs(pixel[0] - 128) <= 1 && pixel[1] === pixel[0] && pixel[2] === pixel[0]);

  // Channel attribution: nearest predicted palette colour, tolerance for 8-bit.
  const channelOf = rgb => {
    let best = -1,
      distance = Infinity;
    expected.forEach((c, i) => {
      const d = Math.abs(rgb[0] - c[0] * 255) + Math.abs(rgb[1] - c[1] * 255) + Math.abs(rgb[2] - c[2] * 255);
      if (d < distance) {
        distance = d;
        best = i;
      }
    });
    return distance <= 6 ? best : -1;
  };
  const channels = {};
  for (const pattern of livery.LIVERY_PATTERNS) {
    const counts = [0, 0, 0, 0],
      unknown = [0];
    const tagged = result.patterns[pattern].map(pixel => {
      const c = channelOf(px(pixel));
      if (c >= 0) counts[c]++;
      else unknown[0]++;
      return c;
    });
    channels[pattern] = { counts, unknown: unknown[0], tagged };
    // Accents are thin by design: a 2-3 pixel line over 64 rows is still 60+ px.
    counts.forEach((n, i) => assert(n > 60, `${pattern} paints a region of palette channel ${i} (${counts.join('/')})`));
    // Soft band edges blend two channels, which is intended, not a failure.
    assert(unknown[0] / tagged.length < 0.2, `${pattern} blends only at its edges (${unknown[0]} px)`);
  }

  // Patterns must actually paint different pixels.
  for (let i = 0; i < livery.LIVERY_PATTERNS.length; i++)
    for (let j = i + 1; j < livery.LIVERY_PATTERNS.length; j++) {
      const a = result.patterns[livery.LIVERY_PATTERNS[i]],
        b = result.patterns[livery.LIVERY_PATTERNS[j]];
      let changed = 0;
      for (let p = 0; p < a.length; p++) {
        const d = Math.abs(a[p][0] - b[p][0]) + Math.abs(a[p][1] - b[p][1]) + Math.abs(a[p][2] - b[p][2]);
        if (d > 12) changed++;
      }
      assert(changed / a.length > 0.15, `${livery.LIVERY_PATTERNS[i]} and ${livery.LIVERY_PATTERNS[j]} paint differently (${changed} px)`);
    }

  // Texture detail survives: the 8px grey stripes stay visible through the paint.
  let varied = 0;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE - 1; x++) {
      const a = result.stripes[y * SIZE + x],
        b = result.stripes[y * SIZE + x + 1];
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 2) varied++;
    }
  assert(varied > 200, 'texture detail survives the paint (' + varied + ' varying pixels)');

  console.log(
    'PASS: WebGL compiled the Army Painter shader; all four channels render, the four patterns differ, the stock path is untouched and texture detail survives',
    result.webgl === 2 ? '(WebGL2)' : '(WebGL1)'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
