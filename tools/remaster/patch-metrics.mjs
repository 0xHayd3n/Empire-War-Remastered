// Patch/adjacency metrics for painted tactical terrain material maps.
//
// Input model: `ids` is a row-major grid of per-vertex material ids (width*height
// entries, vertex (x, y) at index y*width+x). Ids may be numbers, strings or any
// value usable as a Map key; nothing about the id is interpreted as a color here.
// Adjacency is 4-connected (left/right/up/down) vertex adjacency, never diagonal.
//
// Units and exclusions (all reported fractions are dimensionless in [0, 1]):
// - A vertex is *included* unless `mask` is given and mask[i] is falsy. Excluded
//   vertices are removed from every denominator, from patch connectivity (a mask
//   hole splits a patch, it does not bridge it) and from color means.
// - An adjacency *edge* is eligible only when both endpoints are included. Edges
//   are counted between horizontal/vertical neighbours only, so an edge count
//   equals the number of vertex pairs sharing a quad side inside the mask.
// - `adjacency.fraction` = boundary edges (material id differs) / eligible edges.
//   It is 0 for a single material and near 1 for a per-vertex checkerboard.
//   A single vertex has no eligible edges, so the fraction is null, not 0.
// - Patches are maximal 4-connected regions of one material id inside the mask.
//   "Small" patches have <= `smallMax` vertices (default 4). `smallVertexFraction`
//   is small-patch vertices / included vertices. Vertices, not area, are the unit.
// - `dominantShare` is the largest single patch's share of included vertices.
//   `materials.dominant.share` is the largest *material family's* share, which
//   differs when one material is scattered over many small patches.
// - `color.meanContrast` is the mean Euclidean distance between normalized RGB
//   triples of the two materials across boundary (id-changing) edges only. Palette
//   channels must be finite numbers in [0, 1]; distance range is [0, sqrt(3)].
//   `palette` may be a Map or plain object keyed by material id, or an array
//   indexed by encoded class (first-seen row-major order) for pre-encoded inputs.
//   Boundary edges whose material is absent from `palette` are excluded from the
//   mean and counted in `color.missingPaletteEdges`. Same-material edges are never
//   seams and contribute nothing. Without a palette, `color` is null.
//
// The pass is deterministic and O(n) in vertices with no sorting of geometry:
// ids are encoded to dense integers once, adjacency and patch unions run in one
// row-major sweep, and patch sizes come from one union-find root scan. Histogram
// output is ordered by vertex count then by id text, so repeated runs over the
// same input give byte-identical reports. Nothing here approves art: numbers are
// evidence, not a decision, and a low histogram does not prove a seam is unseen.

const SQRT3 = Math.sqrt(3);

const isGrid = (v, min) => Number.isInteger(v) && v >= min;

function paletteColors(palette, classes, classIds) {
  const has = new Uint8Array(classes);
  const rgb = new Float64Array(classes * 3);
  if (palette == null) return { has, rgb };
  // Accepted forms: Map<id, rgb>, plain object<id, rgb>, or an array indexed by
  // encoded class (first-seen order), which only fits pre-encoded inputs.
  const byClass = Array.isArray(palette);
  if (byClass && palette.length !== classes) throw Error('palette array must be indexed by encoded class (' + classes + ' entries)');
  const byId = palette instanceof Map ? id => palette.get(id) : id => palette[String(id)];
  for (let c = 0; c < classes; c++) {
    const id = classIds[c];
    const triple = byClass ? palette[c] : byId(id);
    if (triple == null) continue;
    if (!Array.isArray(triple) || triple.length < 3) throw Error('palette value needs [r,g,b]: ' + String(id));
    for (let k = 0; k < 3; k++) {
      const v = triple[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)
        throw Error('palette channel must be normalized [0,1]: ' + String(id));
      rgb[c * 3 + k] = v;
    }
    has[c] = 1;
  }
  return { has, rgb };
}

/**
 * @param {ArrayLike<*>} ids row-major material ids, length width*height
 * @param {number} width
 * @param {number} height
 * @param {{mask?: ArrayLike<*>, palette?: Map<*, number[]>|Record<string, number[]>|number[][], smallMax?: number}} [options]
 */
export function patchMetrics(ids, width, height, options = {}) {
  const { mask = null, palette = null, smallMax = 4 } = options;
  if (!isGrid(width, 1) || !isGrid(height, 1)) throw Error('width and height must be positive integers');
  if (!ids || ids.length !== width * height) throw Error('ids length must equal width*height');
  if (!isGrid(smallMax, 1)) throw Error('smallMax must be a positive integer');
  if (mask != null && mask.length !== ids.length) throw Error('mask length must equal ids length');
  const n = ids.length;

  // Pass 1: dense material classes; code[i] = -1 for excluded vertices.
  const classIds = [];
  const classIndex = new Map();
  const code = new Int32Array(n).fill(-1);
  const parent = new Int32Array(n);
  const size = new Int32Array(n);
  const materialVertices = [];
  let included = 0;
  for (let i = 0; i < n; i++) {
    if (mask != null && !mask[i]) continue;
    const id = ids[i];
    if (id === undefined) throw Error('undefined material id at vertex ' + i);
    let c = classIndex.get(id);
    if (c === undefined) {
      c = classIds.length;
      classIndex.set(id, c);
      classIds.push(id);
      materialVertices.push(0);
    }
    code[i] = c;
    parent[i] = i;
    size[i] = 1;
    materialVertices[c]++;
    included++;
  }

  let color = null;

  const find = i => {
    let r = i;
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]];
      r = parent[r];
    }
    return r;
  };

  // Pass 2: eligible adjacency edges; union same-material neighbours.
  let edges = 0;
  let boundaries = 0;
  const visit = (i, j) => {
    edges++;
    const a = code[i];
    const b = code[j];
    if (a === b) {
      const ra = find(i);
      const rb = find(j);
      if (ra !== rb) {
        if (size[ra] < size[rb]) {
          parent[ra] = rb;
          size[rb] += size[ra];
        } else {
          parent[rb] = ra;
          size[ra] += size[rb];
        }
      }
      return;
    }
    boundaries++;
    if (color && !(color.has[a] && color.has[b])) color.missingPaletteEdges++;
    else if (color) {
      const dr = color.rgb[a * 3] - color.rgb[b * 3];
      const dg = color.rgb[a * 3 + 1] - color.rgb[b * 3 + 1];
      const db = color.rgb[a * 3 + 2] - color.rgb[b * 3 + 2];
      color.sum += Math.sqrt(dr * dr + dg * dg + db * db);
      color.coloredEdges++;
    }
  };
  const classes = classIds.length;
  if (palette != null)
    color = { ...paletteColors(palette, classes, classIds), sum: 0, coloredEdges: 0, missingPaletteEdges: 0 };
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      if (code[i] < 0) continue;
      const right = x + 1 < width ? i + 1 : -1;
      if (right >= 0 && code[right] >= 0) visit(i, right);
      if (y + 1 < height && code[i + width] >= 0) visit(i, i + width);
    }
  }

  // Pass 3: patch sizes from union-find roots, then per-family aggregation.
  const patchSize = new Int32Array(n);
  for (let i = 0; i < n; i++) if (code[i] >= 0) patchSize[find(i)]++;
  const patchCount = new Int32Array(classes);
  const smallPatchCount = new Int32Array(classes);
  const smallVertices = new Int32Array(classes);
  let patches = 0;
  let smallPatches = 0;
  let totalSmallVertices = 0;
  let maxPatch = 0;
  for (let r = 0; r < n; r++) {
    const s = patchSize[r];
    if (!s) continue;
    const m = code[r];
    patches++;
    patchCount[m]++;
    maxPatch = Math.max(maxPatch, s);
    if (s <= smallMax) {
      smallPatches++;
      smallPatchCount[m]++;
      smallVertices[m] += s;
      totalSmallVertices += s;
    }
  }

  let dominantMaterial = -1;
  for (let m = 0; m < classes; m++)
    if (dominantMaterial < 0 || materialVertices[m] > materialVertices[dominantMaterial]) dominantMaterial = m;
  const share = v => (included ? v / included : 0);
  const histogram = classIds
    .map((id, m) => ({
      id,
      vertices: materialVertices[m],
      share: share(materialVertices[m]),
      patches: patchCount[m],
      smallPatches: smallPatchCount[m],
      smallVertexFraction: share(smallVertices[m]),
    }))
    .sort((a, b) => b.vertices - a.vertices || String(a.id).localeCompare(String(b.id)));

  return {
    width,
    height,
    vertices: n,
    included,
    excluded: n - included,
    smallMax,
    adjacency: {
      edges,
      boundaries,
      fraction: edges ? boundaries / edges : null,
    },
    patches: {
      count: patches,
      smallCount: smallPatches,
      smallVertices: totalSmallVertices,
      smallVertexFraction: share(totalSmallVertices),
      maxSize: maxPatch,
      dominantShare: share(maxPatch),
    },
    materials: {
      distinct: classes,
      dominant: dominantMaterial < 0 ? null : { id: classIds[dominantMaterial], vertices: materialVertices[dominantMaterial], share: share(materialVertices[dominantMaterial]) },
      histogram,
    },
    color: !color
      ? null
      : {
          seamEdges: boundaries,
          coloredEdges: color.coloredEdges,
          missingPaletteEdges: color.missingPaletteEdges,
          meanContrast: color.coloredEdges ? color.sum / color.coloredEdges : null,
          meanContrastNormalized: color.coloredEdges ? color.sum / color.coloredEdges / SQRT3 : null,
          minContrast: 0,
          maxContrast: SQRT3,
        },
  };
}
