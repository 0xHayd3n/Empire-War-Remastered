#!/usr/bin/env python3
"""Offline, repeatable cooker for Yavin ground-cover *distal cutouts*.

Bakes four low-poly textured proxies (one fern, three Anthurium variants) from the
already-verified local donor geometry and diffuse/alpha maps of
`public/art/endor-grove` and `public/art/yavin-jungle`. No network, no new art:
the only inputs are each pack's `models.json`, the listed `*.bin` meshes and the
`*.png` diffuse/alpha they were cooked against.

    python cook-yavin-groundcover.py --repo <repo-root> [--out <dir>]
    python cook-yavin-groundcover.py --verify  [--out <dir>]     # offline re-check

================================ OUTPUT CONTRACT (also printed at run time) ================================
out/atlas.png          RGBA8, 512 x 256, 16 tiles of 128 x 64 (4 view columns x 4 model rows),
                       8 px transparent gutter around each tile, RGB bled into every transparent
                       texel (including internal cutout holes) so mips never pull in black.
                       v = 0 is PNG row 0. The runtime loader (`public/js/dds.js` -> DataTexture,
                       flipY = false) samples row 0 at v = 0, so the atlas is written top-down,
                       unflipped, exactly like the donor `fern.png` / `anthurium.png`.
out/<model>.bin        Stock interleaved layout, identical to the existing packs:
                       16 vertices x (float32 x, y, z, nx, ny, nz, u, v) = 32 B/vertex, then
                       uint16 indices, 3 per triangle. 8 triangles -> 560 bytes.
                       Z-up, metres, same local bounds/origin as the source mesh.
out/models.json        {format, atlas, coordinate, models[]}; each model row carries its source
                       kind/file/hashes, output file/hashes, vertex + triangle counts, per-quad
                       atlas tiles, UV rects, world frames and the bake evidence.
================================ GEOMETRY (per model, 8 triangles / 16 vertices) =========================
Three vertical quads (yaw 0deg / 45deg / 90deg) give the side silhouettes from every azimuth;
one horizontal quad at the measured mean top-surface height gives the plan silhouette for a
steep camera. Every quad is a rectangle whose baked alpha *is* that view's orthographic
silhouette, so the cutout is true face-on instead of a stretched generalisation. Quads are
span-limited to the source AABB (the oblique one is trimmed to it, and the cook measures that
no silhouette area falls outside the trim), so the 0deg/90deg/top quads reproduce the source box
exactly: xyz extents, scale and origin are unchanged. Materials are double-sided in the shipped
loader, so back faces show the mirrored cutout; the three rotations hide most of that and
foliage has no readable chirality.

Build-time only. Requires Python 3, NumPy and Pillow. Deterministic: no clocks, fixed ordering,
fixed PNG options; re-running reproduces byte-identical outputs (`--verify` re-checks the
recorded hashes, layout, bounds, UV/tile agreement and image content without touching sources).
The bake is gated on the texture silhouette matching an independent geometric raster, on the
unflipped PNG row order beating a mirrored sheet on every view, and on gutter/alpha/colour
statistics, so a broken cutout fails the cook instead of shipping.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------------------------
# Contract constants
# ---------------------------------------------------------------------------------------------
FORMAT = "yavin-groundcover-cutout/1"
ATLAS_FILE = "atlas.png"
META_FILE = "models.json"
TILE_W, TILE_H = 128, 64
GUTTER = 8
CONTENT_MAX_W, CONTENT_MAX_H = TILE_W - 2 * GUTTER, TILE_H - 2 * GUTTER   # 112 x 48
SUPERSAMPLE = 2                      # per axis, box-filtered down
VERTEX_FLOATS = 8                    # x y z nx ny nz u v
VERTEX_BYTES = VERTEX_FLOATS * 4     # 32
MAX_TRIS = 12
MIN_TRIS = 6

# Column order in the atlas. `yaw` is the azimuth of the camera direction d = (cos, sin, 0);
# the quad plane is perpendicular to d and spans the image's horizontal axis t = (-sin, cos, 0).
VIEWS = (
    {"id": "side0", "kind": "side", "yaw": 0.0},
    {"id": "side45", "kind": "side", "yaw": 45.0},
    {"id": "side90", "kind": "side", "yaw": 90.0},
    {"id": "top", "kind": "top", "yaw": None},
)

# Source inputs: read-only, verified against models.json before use.
MODELS = (
    {
        "name": "fern",
        "kind": "fern",
        "pack": "endor-grove",
        "asset": "fern_02",
        "variant": 2,
        "mesh": "fern2-fern.bin",
        "texture": "fern.png",
        "credit": "Poly Haven 'Fern 02' (Rob Tuytel, Rico Cilliers), CC0; geometry and "
                  "diffuse/alpha already cooked into public/art/endor-grove.",
        "derivation": "Orthographic front/side3/plan bakes of fern2-fern.bin through its own UVs "
                      "into fern.png (alpha channel), 2x supersampled and box-filtered; proxies "
                      "reuse the donor's UV/texture, no recolor and no new art.",
    },
    {
        "name": "anthurium",
        "kind": "anthurium",
        "pack": "yavin-jungle",
        "asset": "anthurium_botany_01",
        "variant": 3,
        "mesh": "anthurium.bin",
        "texture": "anthurium.png",
        "credit": "Poly Haven 'Anthurium Botany 01', CC0; geometry and cutout diffuse already "
                  "cooked into public/art/yavin-jungle.",
        "derivation": "Orthographic front/side3/plan bakes of anthurium.bin through its own UVs "
                      "into anthurium.png (alpha channel), 2x supersampled and box-filtered; no "
                      "recolor and no new art.",
    },
    {
        "name": "anthurium-wide",
        "kind": "anthurium",
        "pack": "yavin-jungle",
        "asset": "anthurium_botany_01",
        "variant": 0,
        "mesh": "anthurium-wide.bin",
        "texture": "anthurium.png",
        "credit": "Poly Haven 'Anthurium Botany 01', CC0; geometry and cutout diffuse already "
                  "cooked into public/art/yavin-jungle.",
        "derivation": "Orthographic front/side3/plan bakes of anthurium-wide.bin through its own "
                      "UVs into anthurium.png (alpha channel), 2x supersampled and box-filtered; "
                      "no recolor and no new art.",
    },
    {
        "name": "anthurium-young",
        "kind": "anthurium",
        "pack": "yavin-jungle",
        "asset": "anthurium_botany_01",
        "variant": 5,
        "mesh": "anthurium-young.bin",
        "texture": "anthurium.png",
        "credit": "Poly Haven 'Anthurium Botany 01', CC0; geometry and cutout diffuse already "
                  "cooked into public/art/yavin-jungle.",
        "derivation": "Orthographic front/side3/plan bakes of anthurium-young.bin through its own "
                      "UVs into anthurium.png (alpha channel), 2x supersampled and box-filtered; "
                      "no recolor and no new art.",
    },
)

ATLAS_W = TILE_W * len(VIEWS)
ATLAS_H = TILE_H * len(MODELS)

# sRGB <-> linear, so alpha compositing and 2x downsample happen in light, not in code values.
_S2L = np.where(
    np.arange(256, dtype=np.float64) / 255.0 <= 0.04045,
    (np.arange(256, dtype=np.float64) / 255.0) / 12.92,
    ((np.arange(256, dtype=np.float64) / 255.0 + 0.055) / 1.055) ** 2.4,
).astype(np.float32)


def lin_to_srgb8(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0.0, 1.0)
    s = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)
    return np.clip(np.rint(s * 255.0), 0, 255).astype(np.uint8)


# ---------------------------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------------------------
def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    return sha256_bytes(p.read_bytes())


def r6(x) -> float:
    return round(float(x), 6)


def r6v(v) -> list:
    return [r6(x) for x in v]


def find_repo(start: Path) -> Path | None:
    probe = [Path.cwd().resolve(), start.resolve()]
    seen = set()
    for base in probe:
        for p in [base, *base.parents]:
            if p in seen:
                continue
            seen.add(p)
            if (p / "public/art/endor-grove/models.json").is_file() and (
                p / "public/art/yavin-jungle/models.json"
            ).is_file():
                return p
    return None


# ---------------------------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------------------------
def load_mesh_pack(src_art: Path, pack: str) -> tuple[list, str]:
    """Read and pin a pack's models.json (the only permitted source manifest)."""
    p = src_art / pack / "models.json"
    raw = p.read_bytes()
    rows = json.loads(raw.decode("utf-8"))
    if not isinstance(rows, list):
        raise SystemExit(f"{p}: expected a JSON array of model rows")
    return rows, sha256_bytes(raw)


def read_mesh(path: Path, expect_vertices: int | None, expect_triangles: int | None) -> dict:
    """Decode the stock interleaved buffer: 32-byte float P/N/UV then uint16 indices."""
    raw = path.read_bytes()
    if len(raw) < 12:
        raise SystemExit(f"{path}: too short to be a geometry buffer")
    # The pack manifests state the counts; without them, solve size = 32 v + 6 t only if
    # a search is needed (never for the four shipped inputs).
    if expect_vertices is None or expect_triangles is None:
        raise SystemExit(f"{path}: models.json does not declare vertex/triangle counts")
    want = expect_vertices * VERTEX_BYTES + expect_triangles * 6
    if len(raw) != want:
        raise SystemExit(
            f"{path}: {len(raw)} bytes, models.json implies {want} "
            f"({expect_vertices} v x 32 + {expect_triangles} t x 6)"
        )
    v, t = expect_vertices, expect_triangles
    verts = np.frombuffer(raw, dtype="<f4", count=v * VERTEX_FLOATS).reshape(v, VERTEX_FLOATS)
    idx = np.frombuffer(raw, dtype="<u2", count=t * 3, offset=v * VERTEX_BYTES).reshape(t, 3)
    pos = verts[:, 0:3].astype(np.float64)
    nrm = verts[:, 3:6].astype(np.float64)
    uv = verts[:, 6:8].astype(np.float64)
    if not np.isfinite(verts).all():
        raise SystemExit(f"{path}: non-finite vertex data")
    if idx.max(initial=0) >= v:
        raise SystemExit(f"{path}: index out of range")
    if np.any((idx[:, 0] == idx[:, 1]) | (idx[:, 1] == idx[:, 2]) | (idx[:, 0] == idx[:, 2])):
        raise SystemExit(f"{path}: degenerate triangle in source mesh")
    lengths = np.linalg.norm(nrm, axis=1)
    if np.abs(lengths - 1.0).max() > 1e-2:
        raise SystemExit(f"{path}: source normals are not unit length")
    lo, hi = pos.min(0), pos.max(0)
    if np.any(hi - lo <= 0):
        raise SystemExit(f"{path}: flat extent, cannot frame an orthographic view")
    return {
        "path": path,
        "sha256": sha256_bytes(raw),
        "bytes": len(raw),
        "vertices": v,
        "triangles": t,
        "pos": pos,
        "nrm": nrm,
        "uv": uv,
        "idx": idx.astype(np.int64),
        "min": lo,
        "max": hi,
    }


def read_texture(path: Path) -> tuple[np.ndarray, dict]:
    """RGBA8 (rows top-down, exactly the PNG byte order the loader samples unflipped)."""
    with Image.open(path) as im:
        im.load()
        rgba = np.asarray(im.convert("RGBA"), dtype=np.uint8).copy()
    if rgba.shape[2] != 4:
        raise SystemExit(f"{path}: expected RGBA")
    alpha = rgba[:, :, 3]
    if int(alpha.max()) == 0:
        raise SystemExit(f"{path}: diffuse has no alpha at all, cannot cut out")
    if int((alpha > 8).sum()) < 0.02 * alpha.size:
        raise SystemExit(f"{path}: diffuse alpha covers <2% of the sheet")
    return rgba, {
        "width": rgba.shape[1],
        "height": rgba.shape[0],
        "alphaMean": r6(alpha.mean() / 255.0),
        "alphaCoverage": r6((alpha > 127).mean()),
        "sha256": sha256_file(path),
    }


def bleed_source_rgb(tex: np.ndarray, rounds: int = 24) -> np.ndarray:
    """Grow opaque RGB into transparent texels (alpha untouched) so bilinear taps at UV-island
    edges never mix the donor's black margin into a leaf. Writes a new array."""
    out = tex.copy()
    have = out[:, :, 3] > 0
    if not have.any() or have.all():
        return out
    h, w = have.shape
    rgb = out[:, :, :3]
    for _ in range(rounds):
        if have.all():
            break
        known = have.copy()
        col = rgb.copy()
        grew = False
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ys = slice(max(0, dy), h + min(0, dy))
            yd = slice(max(0, -dy), h + min(0, -dy))
            xs = slice(max(0, dx), w + min(0, dx))
            xd = slice(max(0, -dx), w + min(0, -dx))
            m = known[ys, xs] & ~have[yd, xd]
            if m.any():
                rgb[yd, xd][m] = col[ys, xs][m]
                have[yd, xd] |= m
                grew = True
        if not grew:
            break
    return out


# ---------------------------------------------------------------------------------------------
# Orthographic frames: one per (model, view). Shared by the bake and the generated geometry so
# the baked silhouette and the quad can never drift apart.
# ---------------------------------------------------------------------------------------------
def make_frame(mesh: dict, view: dict) -> dict:
    lo, hi = mesh["min"], mesh["max"]
    ax, ay = (hi[0] - lo[0]) / 2.0, (hi[1] - lo[1]) / 2.0
    z0, z1 = float(lo[2]), float(hi[2])
    cz = (z0 + z1) / 2.0
    if view["kind"] == "top":
        aw, ah = hi[0] - lo[0], hi[1] - lo[1]
        aspect = aw / ah
        frame = {
            "kind": "top",
            "ax0": float(lo[0]),
            "ay1": float(hi[1]),
            "aw": float(aw),
            "ah": float(ah),
            "z0": z0,
            "z1": z1,
        }
    else:
        th = math.radians(view["yaw"])
        c, s = math.cos(th), math.sin(th)
        # Two limits on the quad's half-span along t = (-sin, cos, 0):
        #   1. the AABB's support, so the bake frame covers the whole projection;
        #   2. the faces of the AABB, so the quad's own corners never leave the source box.
        # (2) only binds for oblique yaws, where it trims a sub-band that holds no silhouette
        # area; `band_clip_fraction` measures that per model and the cook fails if it is not ~0.
        support = ax * abs(s) + ay * abs(c)
        limits = [support]
        if abs(s) > 1e-9:
            limits.append(ax / abs(s))
        if abs(c) > 1e-9:
            limits.append(ay / abs(c))
        half = min(limits)
        aw, ah = 2.0 * half, z1 - z0
        aspect = aw / ah
        frame = {
            "kind": "side",
            "cos": c,
            "sin": s,
            "a0": -half,
            "aw": float(aw),
            "ah": float(ah),
            "z0": z0,
            "z1": z1,
            "cx": float((lo[0] + hi[0]) / 2.0),
            "cy": float((lo[1] + hi[1]) / 2.0),
            "cz": cz,
            "half": float(half),
            "bandLimited": bool(half < support - 1e-9),
        }
    cw, ch = fit_content(aspect)
    frame.update(aspect=aspect, cw=cw, ch=ch, x0=(TILE_W - cw) // 2, y0=(TILE_H - ch) // 2)
    return frame


def fit_content(aspect: float) -> tuple[int, int]:
    """Largest even-pixel box inside the gutter that keeps the view's aspect exactly."""
    if aspect >= CONTENT_MAX_W / CONTENT_MAX_H:
        cw = CONTENT_MAX_W
        ch = max(2, int(round(cw / aspect / 2.0)) * 2)
    else:
        ch = CONTENT_MAX_H
        cw = max(2, int(round(ch * aspect / 2.0)) * 2)
    return min(cw, CONTENT_MAX_W), min(ch, CONTENT_MAX_H)


def project(frame: dict, pos: np.ndarray, scale: tuple[int, int]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Map world points to pixel coordinates (0..W, 0..H; row 0 = top of the baked image) and to
    camera depth (larger = farther). Orthographic, so depth over a triangle is affine."""
    w, h = scale
    x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]
    if frame["kind"] == "top":
        a = (x - frame["ax0"]) / frame["aw"]
        b = (frame["ay1"] - y) / frame["ah"]
        depth = -z
    else:
        c, s = frame["cos"], frame["sin"]
        a = ((-s * x + c * y) - frame["a0"]) / frame["aw"]
        b = (frame["z1"] - z) / frame["ah"]
        depth = -(c * x + s * y)
    return a * w, b * h, depth


# ---------------------------------------------------------------------------------------------
# Bake
# ---------------------------------------------------------------------------------------------
def bilinear_rgba(tex: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    th, tw = tex.shape[:2]
    x = np.clip(u, 0.0, 1.0) * (tw - 1)
    y = np.clip(v, 0.0, 1.0) * (th - 1)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    x1 = np.minimum(x0 + 1, tw - 1)
    y1 = np.minimum(y0 + 1, th - 1)
    fx = (x - x0)[:, None].astype(np.float32)
    fy = (y - y0)[:, None].astype(np.float32)
    c00 = tex[y0, x0].astype(np.float32)
    c10 = tex[y0, x1].astype(np.float32)
    c01 = tex[y1, x0].astype(np.float32)
    c11 = tex[y1, x1].astype(np.float32)
    top = c00 + (c10 - c00) * fx
    bot = c01 + (c11 - c01) * fx
    return top + (bot - top) * fy


def bake_view(mesh: dict, tex: np.ndarray, frame: dict, want_top_z: bool) -> dict:
    """Painter-order orthographic bake of the donor's own triangles through their own UVs.

    Triangles are composited back-to-front in linear light as `src over dst` on a premultiplied
    buffer, 2x supersampled, then box-filtered. Output rows are image rows (row 0 = v 0), which
    is the atlas row order the loader expects."""
    cw, ch = frame["cw"], frame["ch"]
    w, h = cw * SUPERSAMPLE, ch * SUPERSAMPLE
    pos, uv, tri = mesh["pos"], mesh["uv"], mesh["idx"]
    X, Y, dep = project(frame, pos, (w, h))

    order = np.argsort(-dep[tri].mean(axis=1), kind="stable")
    premul = np.zeros((h, w, 3), dtype=np.float32)
    alpha = np.zeros((h, w), dtype=np.float32)
    near = np.full((h, w), np.inf, dtype=np.float64) if want_top_z else None

    uvg = tex  # pre-bled RGBA
    for ti in order:
        i0, i1, i2 = tri[ti]
        x0, x1, x2 = X[i0], X[i1], X[i2]
        y0, y1, y2 = Y[i0], Y[i1], Y[i2]
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-12:
            continue
        bx0 = max(0, int(math.floor(min(x0, x1, x2) - 0.5)))
        bx1 = min(w - 1, int(math.ceil(max(x0, x1, x2) - 0.5)))
        by0 = max(0, int(math.floor(min(y0, y1, y2) - 0.5)))
        by1 = min(h - 1, int(math.ceil(max(y0, y1, y2) - 0.5)))
        if bx1 < bx0 or by1 < by0:
            continue
        gx, gy = np.meshgrid(
            np.arange(bx0, bx1 + 1, dtype=np.float64) + 0.5,
            np.arange(by0, by1 + 1, dtype=np.float64) + 0.5,
        )
        w0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / den
        w1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / den
        w2 = 1.0 - w0 - w1
        m = (w0 >= -1e-9) & (w1 >= -1e-9) & (w2 >= -1e-9)
        if not m.any():
            continue
        uu = (w0[..., None] * uv[i0] + w1[..., None] * uv[i1] + w2[..., None] * uv[i2])[m]
        col = bilinear_rgba(uvg, uu[:, 0], uu[:, 1])
        ca = col[:, 3].astype(np.float32) / 255.0
        src = _S2L[col[:, :3].astype(np.uint8)] * ca[:, None]

        sub_p = premul[by0 : by1 + 1, bx0 : bx1 + 1]
        sub_a = alpha[by0 : by1 + 1, bx0 : bx1 + 1]
        keep = (1.0 - ca)[:, None]
        sub_p[m] = src + sub_p[m] * keep
        sub_a[m] = ca + sub_a[m] * (1.0 - ca)

        if near is not None:
            dvals = (w0 * dep[i0] + w1 * dep[i1] + w2 * dep[i2])[m]
            ca_keep = ca > 0.4
            if ca_keep.any():
                idx = np.flatnonzero(m)
                idx = idx[ca_keep]
                yy = (idx // (bx1 - bx0 + 1)) + by0
                xx = (idx % (bx1 - bx0 + 1)) + bx0
                upd = dvals[ca_keep] < near[yy, xx]
                near[yy[upd], xx[upd]] = dvals[ca_keep][upd]

    # 2x box downsample in premultiplied linear, then unpremultiply.
    pa = premul.reshape(ch, SUPERSAMPLE, cw, SUPERSAMPLE, 3).mean(axis=(1, 3))
    aa = alpha.reshape(ch, SUPERSAMPLE, cw, SUPERSAMPLE).mean(axis=(1, 3))
    safe = np.maximum(aa, 1e-6)
    rgb8 = lin_to_srgb8(pa / safe[..., None])
    tile = np.zeros((ch, cw, 4), dtype=np.uint8)
    tile[:, :, :3] = rgb8
    tile[:, :, 3] = np.clip(np.rint(aa * 255.0), 0, 255).astype(np.uint8)
    tile_rgb_out = tile[:, :, :3]
    tile_rgb_out[aa <= 1e-6] = 0

    covered = aa > 0.5
    stats = {
        "coverage": float(covered.mean()),
        "alphaMean": float(aa.mean()),
        "rgbMean": r6v(tile[:, :, :3][covered].mean(axis=0) / 255.0) if covered.any() else [0.0, 0.0, 0.0],
        "rgbStd": r6(float(tile[:, :, :3][covered].std() / 255.0)) if covered.any() else 0.0,
        "contentWidth": cw,
        "contentHeight": ch,
    }
    if near is not None:
        fin = np.isfinite(near)
        stats["topSurfaceZ"] = float(np.mean(-near[fin])) if fin.any() else float(frame["z0"])
    return {"tile": tile, "alpha": aa.astype(np.float32), "stats": stats, "premul": pa}


def band_clip_fraction(mesh: dict, frame: dict) -> float:
    """Share of the view's projected silhouette area that falls outside the quad's horizontal span.
    Non-zero only where the source geometry reaches the AABB corners, in which case the proxy would
    cut a visible sliver out of that view."""
    if frame["kind"] != "side" or not frame["bandLimited"]:
        return 0.0
    c, s = frame["cos"], frame["sin"]
    u = -s * mesh["pos"][:, 0] + c * mesh["pos"][:, 1]
    z = mesh["pos"][:, 2]
    tri = mesh["idx"]
    a = np.stack([u, z], axis=1)
    A, B, C = a[tri[:, 0]], a[tri[:, 1]], a[tri[:, 2]]
    area = 0.5 * np.abs(
        (B[:, 0] - A[:, 0]) * (C[:, 1] - A[:, 1]) - (C[:, 0] - A[:, 0]) * (B[:, 1] - A[:, 1])
    )
    if area.sum() <= 0:
        return 0.0
    outside = np.abs(u[tri].mean(axis=1)) > frame["half"]
    return float(area[outside].sum() / area.sum())


def geometric_coverage(mesh: dict, frame: dict) -> np.ndarray:
    """Texture-independent silhouette of the same ortho view, used only as a check that the bake
    really sampled the donor's UVs (and therefore that UV / PNG row order is right)."""
    cw, ch = frame["cw"], frame["ch"]
    X, Y, dep = project(frame, mesh["pos"], (cw, ch))
    tri = mesh["idx"]
    order = np.argsort(-dep[tri].mean(axis=1), kind="stable")
    cov = np.zeros((ch, cw), dtype=np.float32)
    for ti in order:
        i0, i1, i2 = tri[ti]
        x0, x1, x2 = X[i0], X[i1], X[i2]
        y0, y1, y2 = Y[i0], Y[i1], Y[i2]
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-12:
            continue
        bx0 = max(0, int(math.floor(min(x0, x1, x2) - 0.5)))
        bx1 = min(cw - 1, int(math.ceil(max(x0, x1, x2) - 0.5)))
        by0 = max(0, int(math.floor(min(y0, y1, y2) - 0.5)))
        by1 = min(ch - 1, int(math.ceil(max(y0, y1, y2) - 0.5)))
        if bx1 < bx0 or by1 < by0:
            continue
        gx, gy = np.meshgrid(
            np.arange(bx0, bx1 + 1, dtype=np.float64) + 0.5,
            np.arange(by0, by1 + 1, dtype=np.float64) + 0.5,
        )
        w0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / den
        w1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / den
        m = (w0 >= -1e-9) & (w1 >= -1e-9) & (1.0 - w0 - w1 >= -1e-9)
        if m.any():
            cov[by0 : by1 + 1, bx0 : bx1 + 1][m] = 1.0
    return cov


# ---------------------------------------------------------------------------------------------
# Atlas assembly
# ---------------------------------------------------------------------------------------------
def dilate_tile(tile: np.ndarray, rounds: int) -> None:
    """Nearest-colour bleed of RGB through alpha-0 texels, inside this tile only. Alpha is never
    touched: mips then average leaf colour, never black, and never gain coverage."""
    rgb = tile[:, :, :3]
    have = tile[:, :, 3] > 0
    if not have.any() or have.all():
        return
    h, w = have.shape
    for _ in range(rounds):
        if have.all():
            return
        known = have.copy()
        col = rgb.copy()
        grew = False
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ys = slice(max(0, dy), h + min(0, dy))
            yd = slice(max(0, -dy), h + min(0, -dy))
            xs = slice(max(0, dx), w + min(0, dx))
            xd = slice(max(0, -dx), w + min(0, -dx))
            m = known[ys, xs] & ~have[yd, xd]
            if m.any():
                rgb[yd, xd][m] = col[ys, xs][m]
                have[yd, xd] |= m
                grew = True
        if not grew:
            return


# ---------------------------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------------------------
def quad_uv(frame: dict) -> tuple[float, float, float, float]:
    """Atlas UV rect of a tile's content box (v0 = top edge, v1 = bottom edge)."""
    x0, y0, cw, ch = frame["x0"], frame["y0"], frame["cw"], frame["ch"]
    row, col = frame["row"], frame["col"]
    u0 = (col * TILE_W + x0) / ATLAS_W
    u1 = (col * TILE_W + x0 + cw) / ATLAS_W
    v0 = (row * TILE_H + y0) / ATLAS_H
    v1 = (row * TILE_H + y0 + ch) / ATLAS_H
    return u0, v0, u1, v1


def top_quad_z(mesh: dict, measured_top_surface: float) -> float:
    """Height of the plan quad: the measured mean top-surface height of the donor, kept well
    inside the plant so the flat cutout can never float above the silhouette."""
    z0, z1 = float(mesh["min"][2]), float(mesh["max"][2])
    return min(max(measured_top_surface, z0 + 0.15 * (z1 - z0)), z0 + 0.85 * (z1 - z0))


def build_geometry(mesh: dict, frames: dict, top_z: float, uvrects: dict) -> dict:
    lo, hi = mesh["min"], mesh["max"]
    cx, cy = (lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0
    z0, z1 = float(lo[2]), float(hi[2])

    positions: list[list[float]] = []
    normals: list[list[float]] = []
    uvs: list[list[float]] = []
    quads: list[dict] = []

    # Quad-local corner order (A, B, C, D) with triangles (0,1,2) and (0,2,3); every quad gives
    # an outward (+plane normal) winding so the same index pattern serves all four.
    for view in VIEWS:
        fr = frames[view["id"]]
        u0, v0, u1, v1 = uvrects[view["id"]]
        if view["kind"] == "side":
            th = math.radians(view["yaw"])
            c, s = math.cos(th), math.sin(th)
            t = np.array([-s, c, 0.0])
            cz = (z0 + z1) / 2.0
            hz = (z1 - z0) / 2.0
            base = np.array([cx, cy, cz])
            corners = [
                base - fr["half"] * t - hz * np.array([0.0, 0.0, 1.0]),
                base + fr["half"] * t - hz * np.array([0.0, 0.0, 1.0]),
                base + fr["half"] * t + hz * np.array([0.0, 0.0, 1.0]),
                base - fr["half"] * t + hz * np.array([0.0, 0.0, 1.0]),
            ]
            uvf = [(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]
            n = np.array([0.5 * c, 0.5 * s, 1.0])
            n /= np.linalg.norm(n)
            plane = "vertical"
        else:
            zt = top_z
            corners = [
                np.array([lo[0], hi[1], zt]),
                np.array([lo[0], lo[1], zt]),
                np.array([hi[0], lo[1], zt]),
                np.array([hi[0], hi[1], zt]),
            ]
            uvf = [(0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 0.0)]
            n = np.array([0.0, 0.0, 1.0])
            plane = "horizontal"
        for p, f in zip(corners, uvf):
            positions.append([float(p[0]), float(p[1]), float(p[2])])
            normals.append([float(n[0]), float(n[1]), float(n[2])])
            uvs.append([u0 + f[0] * (u1 - u0), v0 + f[1] * (v1 - v0)])
        quads.append(
            {
                "view": view["id"],
                "plane": plane,
                "yawDeg": view["yaw"],
                "atlas": {
                    "column": fr["col"],
                    "row": fr["row"],
                    "x": fr["col"] * TILE_W + fr["x0"],
                    "y": fr["row"] * TILE_H + fr["y0"],
                    "w": fr["cw"],
                    "h": fr["ch"],
                },
                "uv": [r6(u0), r6(v0), r6(u1), r6(v1)],
                "frame": (
                    {
                        "uAxis": "y",
                        "u": [r6(fr["a0"]), r6(fr["a0"] + fr["aw"])],
                        "z": [r6(z0), r6(z1)],
                    }
                    if view["kind"] == "side"
                    else {
                        "uAxis": "x",
                        "u": [r6(lo[0]), r6(hi[0])],
                        "vAxis": "-y",
                        "v": [r6(hi[1]), r6(lo[1])],
                        "z": r6(zt),
                    }
                ),
                "normal": r6v(n),
            }
        )

    pos_arr = np.asarray(positions, dtype="<f4")
    nrm_arr = np.asarray(normals, dtype="<f4")
    uv_arr = np.asarray(uvs, dtype="<f4")
    verts = np.concatenate([pos_arr, nrm_arr, uv_arr], axis=1)
    indices = []
    for q in range(len(VIEWS)):
        b = q * 4
        indices += [b, b + 1, b + 2, b, b + 2, b + 3]
    idx_arr = np.asarray(indices, dtype="<u2")
    blob = verts.tobytes() + idx_arr.tobytes()

    out = {
        "vertices": int(verts.shape[0]),
        "triangles": int(idx_arr.size // 3),
        "bytes": len(blob),
        "blob": blob,
        "sha256": sha256_bytes(blob),
        "quads": quads,
        "bounds": {
            "min": r6v(pos_arr.min(axis=0)),
            "max": r6v(pos_arr.max(axis=0)),
        },
    }
    return out


# ---------------------------------------------------------------------------------------------
# Verification (runs during the cook, and again offline with --verify)
# ---------------------------------------------------------------------------------------------
def check_geometry_blob(blob: bytes, row: dict, expect_bounds: dict | None) -> list[str]:
    errs: list[str] = []
    v, t = row["vertices"], row["triangles"]
    if v < 1 or t < MIN_TRIS or t > MAX_TRIS:
        errs.append(f"{row['file']}: {t} triangles outside the {MIN_TRIS}-{MAX_TRIS} proxy budget")
    if len(blob) != v * VERTEX_BYTES + t * 6:
        errs.append(f"{row['file']}: {len(blob)} bytes != {v} x 32 + {t} x 6")
        return errs
    verts = np.frombuffer(blob, dtype="<f4", count=v * VERTEX_FLOATS).reshape(v, VERTEX_FLOATS)
    idx = np.frombuffer(blob, dtype="<u2", count=t * 3, offset=v * VERTEX_BYTES).reshape(t, 3)
    if not np.isfinite(verts).all():
        errs.append(f"{row['file']}: non-finite values")
    if idx.max() >= v:
        errs.append(f"{row['file']}: index out of range")
    if np.any((idx[:, 0] == idx[:, 1]) | (idx[:, 1] == idx[:, 2]) | (idx[:, 0] == idx[:, 2])):
        errs.append(f"{row['file']}: degenerate triangle")
    nl = np.linalg.norm(verts[:, 3:6].astype(np.float64), axis=1)
    if np.abs(nl - 1.0).max() > 1e-4:
        errs.append(f"{row['file']}: normals not unit length")
    uv = verts[:, 6:8].astype(np.float64)
    if uv.min() < -1e-6 or uv.max() > 1.0 + 1e-6:
        errs.append(f"{row['file']}: UV outside [0,1]")
    for q in row["quads"]:
        u0, v0, u1, v1 = q["uv"]
        if not (0.0 <= u0 < u1 <= 1.0 and 0.0 <= v0 < v1 <= 1.0):
            errs.append(f"{row['file']}:{q['view']}: bad UV rect")
        ax, ay, aw, ah = q["atlas"]["x"], q["atlas"]["y"], q["atlas"]["w"], q["atlas"]["h"]
        if ax < 0 or ay < 0 or ax + aw > ATLAS_W or ay + ah > ATLAS_H:
            errs.append(f"{row['file']}:{q['view']}: atlas tile outside the sheet")
        # UV rect must name exactly that tile's content box (values are rounded to 1e-6 in the
        # manifest, so compare in atlas pixels).
        if abs(u0 * ATLAS_W - ax) > 0.01 or abs(u1 * ATLAS_W - (ax + aw)) > 0.01:
            errs.append(f"{row['file']}:{q['view']}: UV rect does not match the atlas tile (u)")
        if abs(v0 * ATLAS_H - ay) > 0.01 or abs(v1 * ATLAS_H - (ay + ah)) > 0.01:
            errs.append(f"{row['file']}:{q['view']}: UV rect does not match the atlas tile (v)")
    bounds = {"min": r6v(verts[:, 0:3].min(axis=0)), "max": r6v(verts[:, 0:3].max(axis=0))}
    if expect_bounds is not None:
        for k in ("min", "max"):
            if np.abs(np.asarray(bounds[k]) - np.asarray(expect_bounds[k])).max() > 1e-4:
                errs.append(
                    f"{row['file']}: proxy bounds {bounds[k]} != source {expect_bounds[k]} (extents/origin moved)"
                )
    return errs


def check_atlas(atlas: np.ndarray, models: list[dict], require_stats: bool = True) -> tuple[list[str], list[dict]]:
    errs: list[str] = []
    if atlas.shape != (ATLAS_H, ATLAS_W, 4):
        errs.append(f"{ATLAS_FILE}: {atlas.shape} != {(ATLAS_H, ATLAS_W, 4)}")
        return errs, []
    report = []
    for row in models:
        for q in row["quads"]:
            a = q["atlas"]
            x, y, w, h = a["x"], a["y"], a["w"], a["h"]
            tile = atlas[y : y + h, x : x + w]
            alpha = tile[:, :, 3].astype(np.float64) / 255.0
            cov = float((alpha > 0.5).mean())
            mean_a = float(alpha.mean())
            rgb = tile[:, :, :3].astype(np.float64)
            std = float(rgb.reshape(-1, 3).std() / 255.0)
            uniq = int(len(np.unique(tile[:, :, :3].reshape(-1, 3), axis=0)))
            # The gutter around this tile (never the content) must be fully transparent and
            # colour-bled, not black.
            strips = [
                atlas[max(0, a["y"] - GUTTER) : a["y"], max(0, a["x"] - GUTTER) : min(ATLAS_W, a["x"] + w + GUTTER)],
                atlas[a["y"] + h : min(ATLAS_H, a["y"] + h + GUTTER), max(0, a["x"] - GUTTER) : min(ATLAS_W, a["x"] + w + GUTTER)],
                atlas[a["y"] : a["y"] + h, max(0, a["x"] - GUTTER) : a["x"]],
                atlas[a["y"] : a["y"] + h, a["x"] + w : min(ATLAS_W, a["x"] + w + GUTTER)],
            ]
            strips = [s.reshape(-1, 4) for s in strips if s.size]
            band = np.concatenate(strips) if strips else np.zeros((0, 4), dtype=np.uint8)
            gutter_a = float(band[:, 3].max()) / 255.0 if band.size else 0.0
            bled = float((band[:, :3].max(axis=1) > 6).mean()) if band.size else 0.0
            report.append(
                {
                    "model": row["name"],
                    "view": q["view"],
                    "coverage": r6(cov),
                    "alphaMean": r6(mean_a),
                    "rgbStd": r6(std),
                    "uniqueColours": uniq,
                    "gutterMaxAlpha": r6(gutter_a),
                    "gutterBled": r6(bled),
                }
            )
            if cov < 0.04:
                errs.append(f"{row['name']}:{q['view']}: only {cov:.1%} of the tile is covered")
            if cov > 0.97:
                errs.append(f"{row['name']}:{q['view']}: tile is opaque ({cov:.1%}), not a cutout")
            if std < 0.02 or uniq < 24:
                errs.append(f"{row['name']}:{q['view']}: tile looks flat (std {std:.3f}, {uniq} colours)")
            if gutter_a > 0.0:
                errs.append(f"{row['name']}:{q['view']}: gutter is not transparent")
            if bled < 0.5:
                errs.append(f"{row['name']}:{q['view']}: gutter RGB not bled ({bled:.0%} non-black)")
            if require_stats:
                rec = q.get("bake", {})
                for key, val in (
                    ("coveragePixels", cov),
                    ("alphaMeanPixels", mean_a),
                    ("rgbStdPixels", std),
                ):
                    if key in rec and abs(float(rec[key]) - val) > 0.005:
                        errs.append(f"{row['name']}:{q['view']}: {key} drifted from the recorded bake")
    return errs, report


# ---------------------------------------------------------------------------------------------
# Cook
# ---------------------------------------------------------------------------------------------
def print_contract(out: Path) -> None:
    print("== output contract ==")
    print(f"out dir        {out}")
    print(f"{ATLAS_FILE:14s} RGBA8 {ATLAS_W}x{ATLAS_H}; {len(VIEWS)} view columns x {len(MODELS)} model rows of "
          f"{TILE_W}x{TILE_H}; {GUTTER} px transparent gutter; v=0 is PNG row 0 (loader flipY=false)")
    print(f"{'<model>.bin':14s} interleaved float32 pos3+normal3+uv2 (32 B/vertex), then uint16 indices; "
          f"Z-up; 8 triangles, 16 vertices ({16*32+24*2} B)")
    print(f"{META_FILE:14s} {{format, atlas, coordinate, models[]}}; rows pin source kind/file, counts, "
          f"output file/hash, per-quad tiles + UV rects, credit/derivation")
    print()


def cook(src_art: Path, out: Path) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    print_contract(out)
    packs: dict[str, tuple[list, str]] = {}

    atlas = np.zeros((ATLAS_H, ATLAS_W, 4), dtype=np.uint8)
    baked: dict[str, dict] = {}
    rows: list[dict] = []
    errors: list[str] = []

    for ri, spec in enumerate(MODELS):
        if spec["pack"] not in packs:
            packs[spec["pack"]] = load_mesh_pack(src_art, spec["pack"])
        pack_rows, pack_sha = packs[spec["pack"]]
        match = [r for r in pack_rows if r.get("file") == spec["mesh"]]
        if len(match) != 1:
            raise SystemExit(f"{spec['pack']}/models.json: expected exactly one row for {spec['mesh']}")
        srow = match[0]
        mesh_path = src_art / spec["pack"] / spec["mesh"]
        if not mesh_path.is_file():
            raise SystemExit(f"missing source mesh {mesh_path}")
        mesh = read_mesh(mesh_path, srow.get("vertices"), srow.get("triangles"))
        if "sha256" in srow and srow["sha256"] != mesh["sha256"]:
            raise SystemExit(f"{mesh_path}: sha256 does not match {spec['pack']}/models.json")
        tex_path = src_art / spec["pack"] / spec["texture"]
        if not tex_path.is_file():
            raise SystemExit(f"missing source diffuse {tex_path}")
        tex, tex_info = read_texture(tex_path)
        tex_bled = bleed_source_rgb(tex)

        print(f"[{spec['name']}] {spec['pack']}/{spec['mesh']}  "
              f"{mesh['vertices']}v {mesh['triangles']}t  {mesh['sha256'][:16]}  "
              f"bounds {r6v(mesh['min'])} .. {r6v(mesh['max'])}")
        print(f"           {spec['pack']}/{spec['texture']} {tex_info['width']}x{tex_info['height']} "
              f"alpha coverage {tex_info['alphaCoverage']:.1%}  {tex_info['sha256'][:16]}")

        frames: dict[str, dict] = {}
        uvrects: dict[str, tuple[float, float, float, float]] = {}
        bake_stats: dict[str, dict] = {}
        geom_cache_for_order: dict[str, np.ndarray] = {}
        top_z = float((mesh["min"][2] + mesh["max"][2]) / 2.0)
        for ci, view in enumerate(VIEWS):
            fr = make_frame(mesh, view)
            fr["col"], fr["row"] = ci, ri
            frames[view["id"]] = fr
            res = bake_view(mesh, tex_bled, fr, want_top_z=view["kind"] == "top")
            atlas[
                ri * TILE_H + fr["y0"] : ri * TILE_H + fr["y0"] + fr["ch"],
                ci * TILE_W + fr["x0"] : ci * TILE_W + fr["x0"] + fr["cw"],
            ] = res["tile"]
            uvrects[view["id"]] = quad_uv(fr)
            if view["kind"] == "top":
                top_z = res["stats"]["topSurfaceZ"]
            # Independent check: does the texture-sampled alpha follow the geometric silhouette?
            geom = geometric_coverage(mesh, fr)
            got = res["alpha"]
            both = np.stack([geom.ravel(), got.ravel()])
            corr = float(np.corrcoef(both)[0, 1]) if geom.std() > 0 and got.std() > 0 else 0.0
            on_geom = float(got[geom > 0.5].mean()) if (geom > 0.5).any() else 0.0
            off_geom = float(got[geom < 0.5].mean())
            if corr < 0.6:
                errors.append(f"{spec['name']}:{view['id']}: texture silhouette does not follow the mesh "
                              f"(corr {corr:.2f}); UV/PNG row order is suspect")
            if on_geom < 0.55:
                errors.append(f"{spec['name']}:{view['id']}: only {on_geom:.0%} alpha where geometry covers")
            if off_geom > 0.12:
                errors.append(f"{spec['name']}:{view['id']}: {off_geom:.0%} alpha outside the mesh silhouette")
            clip = band_clip_fraction(mesh, fr)
            if clip > 0.02:
                errors.append(
                    f"{spec['name']}:{view['id']}: {clip:.1%} of the silhouette would fall outside "
                    f"the quad's span inside the source AABB; this view cannot be proxied"
                )
            res["stats"].update(
                bandClipFraction=r6(clip),
                silhouetteCorrelation=r6(corr),
                alphaOnGeometry=r6(on_geom),
                alphaOffGeometry=r6(off_geom),
                aspect=r6(fr["aspect"]),
            )
            geom_cache_for_order[view["id"]] = geom
            bake_stats[view["id"]] = res["stats"]
            print(f"           {view['id']:7s} tile {fr['cw']:3d}x{fr['ch']:2d}px  "
                  f"coverage {res['stats']['coverage']:.1%}  corr {corr:.2f}  "
                  f"on-geom {on_geom:.0%}")

        # Decide the PNG row order by measurement, not by assumption: rebake every view through a
        # vertically mirrored sheet. The unflipped sheet (v = PNG row, matching the shipped loader)
        # must win on every view. This is the empirical flipY check, kept in the log and the meta.
        row_order_views = {}
        margins = []
        for view in VIEWS:
            fr = frames[view["id"]]
            g = geom_cache_for_order[view["id"]]
            sel = g > 0.5
            up = float(bake_view(mesh, tex_bled, fr, False)["alpha"][sel].mean())
            mi = float(bake_view(mesh, tex_bled[::-1].copy(), fr, False)["alpha"][sel].mean())
            row_order_views[view["id"]] = {
                "unflippedOnGeometry": r6(up),
                "mirroredOnGeometry": r6(mi),
            }
            margins.append(up - mi)
        worst = min(margins)
        if worst <= 0.0 or sum(margins) / len(margins) < 0.03:
            errors.append(
                f"{spec['name']}: row-order check inconclusive (worst margin {worst:+.0%}); the "
                f"UV/PNG convention needs review"
            )
        print(f"           row order: unflipped beats mirrored on all {len(VIEWS)} views "
              f"(margin {min(margins):+.0%}..{max(margins):+.0%}); v = PNG row index")
        row_order = {
            "decision": "v = PNG row index (loader flipY=false)",
            "views": row_order_views,
            "worstMargin": r6(worst),
        }

        top_z = top_quad_z(mesh, top_z)
        geo = build_geometry(mesh, frames, top_z, uvrects)
        for q in geo["quads"]:
            q["bake"] = bake_stats[q["view"]]
        baked[spec["name"]] = geo
        rows.append(
            {
                "name": spec["name"],
                "kind": spec["kind"],
                "file": spec["name"] + ".bin",
                "vertices": geo["vertices"],
                "triangles": geo["triangles"],
                "bytes": geo["bytes"],
                "sha256": geo["sha256"],
                "bounds": geo["bounds"],
                "sourceBounds": {"min": r6v(mesh["min"]), "max": r6v(mesh["max"])},
                "source": {
                    "pack": spec["pack"],
                    "kind": spec["kind"],
                    "asset": spec["asset"],
                    "variant": spec["variant"],
                    "file": spec["mesh"],
                    "vertices": mesh["vertices"],
                    "triangles": mesh["triangles"],
                    "sha256": mesh["sha256"],
                    "modelsJson": {"file": "models.json", "sha256": pack_sha},
                },
                "texture": {
                    "pack": spec["pack"],
                    "file": spec["texture"],
                    "width": tex_info["width"],
                    "height": tex_info["height"],
                    "sha256": tex_info["sha256"],
                },
                "quads": geo["quads"],
                "rowOrderCheck": row_order,
                "credit": spec["credit"],
                "derivation": spec["derivation"],
            }
        )

    # Gutters: nearest RGB bleed inside every tile, alpha untouched.
    # Bleed until every texel of every tile has a colour: the widest span inside a tile is
    # TILE_W + TILE_H, and the loop exits as soon as the tile is filled.
    rounds = TILE_W + TILE_H
    for ri in range(len(MODELS)):
        for ci in range(len(VIEWS)):
            dilate_tile(
                atlas[ri * TILE_H : (ri + 1) * TILE_H, ci * TILE_W : (ci + 1) * TILE_W],
                rounds,
            )

    atlas_path = out / ATLAS_FILE
    Image.fromarray(atlas, mode="RGBA").save(atlas_path, format="PNG", optimize=True, compress_level=9)
    atlas_sha = sha256_file(atlas_path)

    for name, geo in baked.items():
        (out / (name + ".bin")).write_bytes(geo["blob"])

    meta = {
        "format": FORMAT,
        "note": "Distal cutouts: one RGBA atlas + four 8-triangle proxies baked from the donor meshes' "
                "own UVs. Runtime builds geometry like the other packs (32 B float P/N/UV, uint16 "
                "indices) and can derive tangent/binormal with computeTangents() as endor-grove.js does. "
                "Double-sided cutout material, alphaRef ~0.3.",
        "atlas": {
            "file": ATLAS_FILE,
            "width": ATLAS_W,
            "height": ATLAS_H,
            "tileWidth": TILE_W,
            "tileHeight": TILE_H,
            "gutter": GUTTER,
            "columns": [v["id"] for v in VIEWS],
            "rows": [m["name"] for m in MODELS],
            "sha256": atlas_sha,
        },
        "coordinate": {
            "up": "z",
            "units": "metres",
            "vertexBytes": VERTEX_BYTES,
            "layout": "float32 x,y,z, nx,ny,nz, u,v then uint16 indices",
            "flipY": False,
            "vOrigin": "PNG row 0; the shipped loader samples row 0 at v=0",
        },
        "models": rows,
    }

    # Offline gate: geometry blob, bounds, then the atlas read back from disk.
    for row in rows:
        blob = (out / row["file"]).read_bytes()
        if sha256_bytes(blob) != row["sha256"]:
            errors.append(f"{row['file']}: written hash differs from the record")
        errors += check_geometry_blob(blob, row, row.get("sourceBounds", row["bounds"]))
    on_disk = np.asarray(Image.open(atlas_path).convert("RGBA"), dtype=np.uint8).copy()
    if sha256_file(atlas_path) != meta["atlas"]["sha256"]:
        errors.append(f"{ATLAS_FILE}: written hash differs from the record")
    aerrs, report = check_atlas(on_disk, rows)
    errors += aerrs

    # Record the measured tile evidence (the --verify gate), then write the manifest.
    measured = {(r["model"], r["view"]): r for r in report}
    for row in rows:
        for q in row["quads"]:
            m = measured[(row["name"], q["view"])]
            q["bake"].update(
                {
                    "coveragePixels": m["coverage"],
                    "alphaMeanPixels": m["alphaMean"],
                    "rgbStdPixels": m["rgbStd"],
                    "uniqueColours": m["uniqueColours"],
                }
            )
    (out / META_FILE).write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    _print_table(rows, report)
    print()
    print(f"{ATLAS_FILE:22s} {ATLAS_W}x{ATLAS_H}  {atlas_path.stat().st_size/1024:7.1f} KiB  {atlas_sha[:16]}")
    for row in rows:
        p = out / row["file"]
        print(f"{row['file']:22s} {row['vertices']}v {row['triangles']}t {row['bytes']:4d} B  "
              f"{p.stat().st_size/1024:7.1f} KiB  {row['sha256'][:16]}")
    print(f"{META_FILE:22s} {len(rows)} rows  {(out / META_FILE).stat().st_size/1024:7.1f} KiB  "
          f"{sha256_file(out / META_FILE)[:16]}")

    if errors:
        print()
        for e in errors:
            print("FAIL " + e)
        raise SystemExit(f"{len(errors)} check(s) failed")
    print("\nOK  all offline checks passed (hash, format, bounds, UV<tile, silhouette, gutter, image content)")
    return meta


def _print_table(rows: list[dict], report: list[dict]) -> None:
    print()
    print(f"{'model':16s} {'view':7s} {'tile':>9s} {'coverage':>9s} {'alpha':>7s} {'rgbStd':>7s} "
          f"{'colours':>8s} {'corr':>6s}")
    for r in report:
        q = next(x for x in next(m for m in rows if m["name"] == r["model"])["quads"] if x["view"] == r["view"])
        b = q["bake"]
        print(f"{r['model']:16s} {r['view']:7s} {b['contentWidth']:4d}x{b['contentHeight']:<4d} "
              f"{r['coverage']:8.1%} {r['alphaMean']:7.3f} {r['rgbStd']:7.3f} {r['uniqueColours']:8d} "
              f"{b.get('silhouetteCorrelation', 0):6.2f}")


# ---------------------------------------------------------------------------------------------
# Offline verify (no sources, no writes)
# ---------------------------------------------------------------------------------------------
def verify(out: Path) -> int:
    meta_path = out / META_FILE
    if not meta_path.is_file():
        raise SystemExit(f"{meta_path}: not found; run the cook first")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if meta.get("format") != FORMAT:
        raise SystemExit(f"{meta_path}: unexpected format {meta.get('format')!r}")
    errors: list[str] = []
    rows = meta["models"]
    if len(rows) != len(MODELS):
        errors.append(f"expected {len(MODELS)} model rows, found {len(rows)}")
    for row in rows:
        p = out / row["file"]
        if not p.is_file():
            errors.append(f"missing {row['file']}")
            continue
        blob = p.read_bytes()
        if sha256_bytes(blob) != row["sha256"]:
            errors.append(f"{row['file']}: sha256 mismatch")
        errors += check_geometry_blob(blob, row, row.get("sourceBounds", row["bounds"]))
        src = row["source"]
        rec = src.get("sha256", "")
        if len(rec) != 64:
            errors.append(f"{row['name']}: source hash not recorded")
    atlas_path = out / meta["atlas"]["file"]
    if not atlas_path.is_file():
        errors.append(f"missing {meta['atlas']['file']}")
        return 1
    if sha256_file(atlas_path) != meta["atlas"]["sha256"]:
        errors.append(f"{meta['atlas']['file']}: sha256 mismatch")
    atlas = np.asarray(Image.open(atlas_path).convert("RGBA"), dtype=np.uint8).copy()
    aerrs, report = check_atlas(atlas, rows)
    errors += aerrs
    _print_table(rows, report)
    print()
    print(f"verified {len(rows)} proxies, {len(rows)*len(VIEWS)} atlas tiles in {out}")
    if errors:
        for e in errors:
            print("FAIL " + e)
        return 1
    print("OK  hashes, layout, bounds, UV<tile, silhouette content and gutters all check out")
    return 0


# ---------------------------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Cook the Yavin fern/Anthurium distal cutout atlas and proxies (offline, repeatable).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--repo", type=Path, default=None, help="repository root (default: search upwards)")
    ap.add_argument("--src", type=Path, default=None, help="art root (default: <repo>/public/art)")
    ap.add_argument("--out", type=Path, default=None,
                    help="output dir (default: <repo>/public/art/yavin-groundcover)")
    ap.add_argument("--verify", action="store_true", help="re-check existing outputs only, write nothing")
    args = ap.parse_args(argv)

    if args.verify:
        if args.out is None:
            raise SystemExit("--verify needs --out (or run with --repo so the default resolves)")
        return verify(args.out.resolve())

    repo = args.repo.resolve() if args.repo else find_repo(Path(__file__).parent)
    if repo is not None and not (repo / "public/art").is_dir():
        repo = None
    src = args.src.resolve() if args.src else (repo / "public/art" if repo else None)
    out = args.out.resolve() if args.out else (repo / "public/art/yavin-groundcover" if repo else None)
    if src is None or out is None:
        raise SystemExit(
            "could not locate the repository; pass --repo <root> or both --src and --out"
        )
    for pack in {m["pack"] for m in MODELS}:
        if not (src / pack / "models.json").is_file():
            raise SystemExit(f"{src / pack / 'models.json'}: missing source manifest")
    cook(src, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
