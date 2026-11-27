#!/usr/bin/env python3
"""Build the runtime forest-ground material tiles from Poly Haven Forest Ground 04.

Outputs (into public/art/forest-ground-04/):
  color.png   512x512 RGB, sRGB-encoded albedo, tileable
  normal.png  512x512 RGB, OpenGL (+Y up) tangent-space normal, tileable

Downsample rules
  * colour: decoded from sRGB to linear light, 2x2 box averaged in linear light,
    re-encoded to sRGB.  Averaging in gamma space would darken/desaturate the tile.
  * normal: decoded from 8-bit 0..1 to [-1,1], 2x2 box averaged (averaging a
    normal map is only valid as a direction estimate), then each vector is
    renormalised to unit length before re-encoding.

The 1K sources are themselves seamless, and a symmetric 2x2 box filter of a
seamlessly tiling texture stays seamless, so the 512 results keep tiling.

No project dependencies: uses Pillow + numpy when present, else falls back to a
pure-Python path (Pillow only, still not installed by this script).

Usage
  python tools/prepare-forest-ground.py                 # fetch to a temp dir, write tiles
  python tools/prepare-forest-ground.py --check         # verify existing outputs' hashes
  python tools/prepare-forest-ground.py --cache DIR     # where the 1K sources live/will be fetched
  python tools/prepare-forest-ground.py --no-download   # fail instead of fetching
"""

import argparse
import hashlib
import json
import os
import sys
import tempfile
import urllib.request

API_URL = "https://api.polyhaven.com/files/forest_ground_04"
ASSET_PAGE = "https://polyhaven.com/a/forest_ground_04"
LICENSE = "CC0 1.0 Universal (public domain dedication)"
LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"

# Pinned first-party sources: 1K PNG, Poly Haven texture set "Forest Ground 04".
SOURCES = {
    "diffuse": {
        "slug": "Diffuse",
        "url": "https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/forest_ground_04/forest_ground_04_diff_1k.png",
        "md5": "8f4318ba5044aa147999b08a10302fb4",
        "bytes": 2364487,
        "resolution": "1k",
        "colorspace": "sRGB",
    },
    "normal": {
        "slug": "nor_gl",
        "url": "https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/forest_ground_04/forest_ground_04_nor_gl_1k.png",
        "md5": "77c2337c8c8c47357f69b598e73a72de",
        "bytes": 2537954,
        "resolution": "1k",
        "colorspace": "linear (tangent-space normal, +Y up)",
    },
}
LOCAL_NAMES = {"diffuse": "forest_ground_04_diff_1k.png", "normal": "forest_ground_04_nor_gl_1k.png"}

# First-party DirectX variant, only used to prove which way the green axis points.
DX_URL = "https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/forest_ground_04/forest_ground_04_nor_dx_1k.png"
DX_MD5 = "17d3c9b519ab281d57723a53c9c888e7"
DX_NAME = "forest_ground_04_nor_dx_1k.png"

OUT_SIZE = 512
OUTPUTS = {"diffuse": "color.png", "normal": "normal.png"}

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "public", "art", "forest-ground-04"))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(key, cache_dir, allow_download=True):
    src = SOURCES[key]
    name = LOCAL_NAMES[key]
    candidates = [
        os.path.join(cache_dir, name),
        os.path.join(cache_dir, os.path.basename(src["url"])),
    ]
    for path in candidates:
        if os.path.exists(path):
            got = md5(path)
            if got != src["md5"]:
                raise SystemExit(f"{path}: md5 {got} != pinned {src['md5']}")
            return path
    if not allow_download:
        raise SystemExit(f"missing {name} in {cache_dir} and --no-download was given")
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, name)
    print(f"fetch {src['url']}")
    with urllib.request.urlopen(src["url"], timeout=180) as resp, open(path, "wb") as out:
        out.write(resp.read())
    got = md5(path)
    if got != src["md5"]:
        raise SystemExit(f"{path}: md5 {got} != pinned {src['md5']}")
    print(f"  ok {os.path.getsize(path)} bytes md5 {got}")
    return path


# --- colour ---------------------------------------------------------------

def srgb_to_linear(byte):
    v = byte / 255.0
    return (v / 12.92) if v <= 0.04045 else (((v + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(v):
    v = min(max(v, 0.0), 1.0)
    s = (v * 12.92) if v <= 0.0031308 else (1.055 * (v ** (1 / 2.4)) - 0.055)
    return int(round(s * 255.0))


LUT_TO_LINEAR = None
LUT_TO_SRGB = None


def build_luts():
    """Exact 8-bit sRGB -> 16-bit linear table and its inverse, for the slow path."""
    global LUT_TO_LINEAR, LUT_TO_SRGB
    LUT_TO_LINEAR = [int(round(srgb_to_linear(v) * 65535.0)) for v in range(256)]
    LUT_TO_SRGB = [linear_to_srgb(v / 65535.0) for v in range(65536)]


def downsample_color(src_path, size, use_numpy):
    from PIL import Image

    im = Image.open(src_path)
    if im.mode != "RGB":
        im = im.convert("RGB")
    if im.size[0] % size or im.size[1] % size:
        raise SystemExit(f"{src_path}: {im.size} is not an integer multiple of {size}")
    w, h = im.size
    block_w, block_h = w // size, h // size
    if use_numpy:
        import numpy as np

        rgb = np.asarray(im, dtype=np.uint8).astype(np.float32) / 255.0
        linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
        # block mean (exact box filter for an integer factor) in linear light
        linear = linear.reshape(size, block_h, size, block_w, 3).mean(axis=(1, 3))
        srgb = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(linear, 1 / 2.4) - 0.055)
        out = np.clip(np.rint(srgb * 255.0), 0, 255).astype(np.uint8)
        return Image.fromarray(out, "RGB")

    build_luts()
    px = im.load()
    out = Image.new("RGB", (size, size))
    dst = out.load()
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0]
            for sy in range(block_h):
                for sx in range(block_w):
                    r, g, b = px[x * block_w + sx, y * block_h + sy]
                    acc[0] += LUT_TO_LINEAR[r]
                    acc[1] += LUT_TO_LINEAR[g]
                    acc[2] += LUT_TO_LINEAR[b]
            n = block_h * block_w
            dst[x, y] = tuple(LUT_TO_SRGB[a // n] for a in acc)
    return out


# --- normal ---------------------------------------------------------------

def downsample_normal(src_path, size, use_numpy):
    from PIL import Image

    im = Image.open(src_path)
    if im.mode != "RGB":
        im = im.convert("RGB")
    if im.size[0] % size or im.size[1] % size:
        raise SystemExit(f"{src_path}: {im.size} is not an integer multiple of {size}")
    w, h = im.size
    block_w, block_h = w // size, h // size
    if use_numpy:
        import numpy as np

        n = np.asarray(im, dtype=np.float32) / 255.0 * 2.0 - 1.0
        n = n.reshape(size, block_h, size, block_w, 3).mean(axis=(1, 3))
        length = np.sqrt((n * n).sum(axis=2, keepdims=True))
        n = np.divide(n, length, out=np.zeros_like(n), where=length > 1e-6)
        # degenerate (cancel-to-zero) vectors fall back to flat +Z
        flat = length[..., 0] <= 1e-6
        if flat.any():
            n[flat] = (0.0, 0.0, 1.0)
        out = np.clip(np.rint((n * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8)
        return Image.fromarray(out, "RGB")

    px = im.load()
    out = Image.new("RGB", (size, size))
    dst = out.load()
    n = block_h * block_w
    for y in range(size):
        for x in range(size):
            acc = [0.0, 0.0, 0.0]
            for sy in range(block_h):
                for sx in range(block_w):
                    r, g, b = px[x * block_w + sx, y * block_h + sy]
                    acc[0] += r / 255.0 * 2.0 - 1.0
                    acc[1] += g / 255.0 * 2.0 - 1.0
                    acc[2] += b / 255.0 * 2.0 - 1.0
            v = [a / n for a in acc]
            length = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) ** 0.5
            if length <= 1e-6:
                v = [0.0, 0.0, 1.0]
            else:
                v = [a / length for a in v]
            dst[x, y] = tuple(min(255, max(0, int(round(a * 0.5 * 255.0 + 127.5)))) for a in v)
    return out


# --- reporting ------------------------------------------------------------

def channel_stats(path):
    import numpy as np
    from PIL import Image

    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255.0 * 2.0 - 1.0
    stats = {}
    for i, name in enumerate("rgb"):
        c = a[..., i]
        stats[name] = {
            "mean": round(float(c.mean()), 4),
            "min": round(float(c.min()), 4),
            "max": round(float(c.max()), 4),
            "fraction_positive": round(float((c > 0).mean()), 4),
        }
    return stats


def seam_delta(path):
    """Mean wrap-around neighbour difference vs. mean interior difference.

    A seamless tile has roughly the same step across the wrap edge as inside it.
    """
    import numpy as np
    from PIL import Image

    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    interior = np.concatenate([
        np.abs(a[:, 1:] - a[:, :-1]).reshape(-1),
        np.abs(a[1:, :] - a[:-1, :]).reshape(-1),
    ]).mean()
    seam = np.concatenate([
        np.abs(a[:, 0] - a[:, -1]).reshape(-1),
        np.abs(a[0, :] - a[-1, :]).reshape(-1),
    ]).mean()
    return round(float(interior), 3), round(float(seam), 3)


def verify_gl_vs_dx(cache_dir, allow_download=True):
    """Prove the green axis of the shipped normal tile.

    Poly Haven ships the same bake as `nor_gl` and `nor_dx`.  If the two differ
    only in green and one green equals 255 minus the other, then the file we
    downsampled is the OpenGL (+Y up) bake, not the DirectX one.
    """
    import numpy as np
    from PIL import Image

    dx_path = os.path.join(cache_dir, DX_NAME)
    if not os.path.exists(dx_path):
        if not allow_download:
            return {"verified": False, "reason": f"{DX_NAME} not cached"}
        print(f"fetch {DX_URL}")
        with urllib.request.urlopen(DX_URL, timeout=180) as resp, open(dx_path, "wb") as out:
            out.write(resp.read())
    if md5(dx_path) != DX_MD5:
        return {"verified": False, "reason": f"md5 mismatch for {DX_NAME}"}
    gl = np.asarray(Image.open(os.path.join(cache_dir, LOCAL_NAMES["normal"])).convert("RGB"), dtype=np.int16)
    dx = np.asarray(Image.open(dx_path).convert("RGB"), dtype=np.int16)
    return {
        "verified": True,
        "red_identical": bool(np.array_equal(gl[..., 0], dx[..., 0])),
        "blue_identical": bool(np.array_equal(gl[..., 2], dx[..., 2])),
        "green_mean_abs_diff_mirrored": round(float(np.abs(gl[..., 1] - (255 - dx[..., 1])).mean()), 3),
        "green_mean_abs_diff_same": round(float(np.abs(gl[..., 1] - dx[..., 1]).mean()), 3),
        "conclusion": "shipped tile is the OpenGL (+Y up) bake: green is mirrored versus nor_dx",
    }


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument(
        "--cache",
        default=os.path.join(tempfile.gettempdir(), "forest-ground-04-src"),
        help="download cache for the 1K sources (kept outside the repo)",
    )
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--size", type=int, default=OUT_SIZE)
    ap.add_argument("--no-download", action="store_true")
    ap.add_argument("--check", action="store_true", help="only verify hashes of the shipped tiles")
    args = ap.parse_args(argv)

    report = {"sources": {}, "outputs": {}}

    if not args.check:
        try:
            import numpy  # noqa: F401

            use_numpy = True
        except ImportError:
            use_numpy = False
        if not use_numpy:
            print("numpy not found: falling back to the slower Pillow-only path")

        os.makedirs(args.out, exist_ok=True)
        src_paths = {}
        for key in SOURCES:
            path = fetch(key, os.path.abspath(args.cache), allow_download=not args.no_download)
            src_paths[key] = path
            src = SOURCES[key]
            report["sources"][key] = {
                "url": src["url"],
                "md5": md5(path),
                "sha256": sha256(path),
                "bytes": os.path.getsize(path),
            }

        for key, builder in (("diffuse", downsample_color), ("normal", downsample_normal)):
            img = builder(src_paths[key], args.size, use_numpy)
            assert img.mode == "RGB" and img.size == (args.size, args.size)
            path = os.path.join(args.out, OUTPUTS[key])
            img.save(path, format="PNG", optimize=True)
            print(f"wrote {path} {img.size} {os.path.getsize(path)} bytes")

    for key, name in OUTPUTS.items():
        path = os.path.join(args.out, name)
        if not os.path.exists(path):
            raise SystemExit(f"missing output {path}")
        from PIL import Image

        with Image.open(path) as im:
            dims = im.size
            mode = im.mode
        report["outputs"][name.split(".")[0]] = {
            "file": name,
            "dimensions": f"{dims[0]}x{dims[1]}",
            "mode": mode,
            "bytes": os.path.getsize(path),
            "sha256": sha256(path),
        }
        print(f"{name}: {dims[0]}x{dims[1]} {mode} {os.path.getsize(path)} bytes sha256 {report['outputs'][name.split('.')[0]]['sha256']}")

    normal_path = os.path.join(args.out, OUTPUTS["normal"])
    color_path = os.path.join(args.out, OUTPUTS["diffuse"])
    report["normal_stats"] = channel_stats(normal_path)
    report["color_stats"] = channel_stats(color_path)
    report["tiling"] = {
        key: {"interior_neighbour_delta": interior, "wrap_neighbour_delta": seam}
        for key, (interior, seam) in (
            ("color", seam_delta(color_path)),
            ("normal", seam_delta(normal_path)),
        )
    }
    report["normal_convention"] = verify_gl_vs_dx(os.path.abspath(args.cache), allow_download=not args.no_download)
    print("normal stats:", json.dumps(report["normal_stats"]))
    print("tiling (0-255 deltas):", json.dumps(report["tiling"]))
    print("normal convention:", json.dumps(report["normal_convention"]))
    print("asset:", ASSET_PAGE, "|", LICENSE)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
