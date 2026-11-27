#!/usr/bin/env python3
"""Bake the Endor thicket spray atlas from CC0 Poly Haven glTF models.

The atlas, ``public/art/endor-thicket/sprays.png``, is four panels of baked geometry
renders for dense Endor middle/distant forest. They are real 3D plants under neutral
daylight with the donor's own albedo, normal and alpha maps, cut to alpha. In game they
become fixed crossed/canted quads, never camera-facing sprites.

Cook (needs Blender 3.6; this file is the driver and the bake script):
    python tools/cook-endor-sprays.py                  # bake, write atlas + SOURCES.md
    python tools/cook-endor-sprays.py --debug DIR      # bake panels to DIR, write nothing
    python tools/cook-endor-sprays.py --only fir,fern  # subset of panels
    python tools/cook-endor-sprays.py --samples 128    # Cycles samples per pixel

Verify (plain Python 3, no Blender, no third party modules):
    python tools/cook-endor-sprays.py --verify         # measured atlas vs SOURCES.md
    python tools/cook-endor-sprays.py --recheck-render # re-bake, compare with shipped
                                                       # atlas pixel for pixel

Everything the cook needs is pinned: the donor glTF bundles, geometry buffers, albedo,
normal, arm and alpha maps are md5-checked against Poly Haven's file API before use, and
the finished atlas is sha256-pinned in SOURCES.md. Sources are cached outside the
checkout (``$ENDOR_SPRAYS_CACHE`` or ``<tmpdir>/endor-sprays-inputs``); the repo keeps
only the atlas, the doc and this script.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import math
import os
import struct
import subprocess
import sys
import tempfile
import urllib.request
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT_DIR = ROOT / "public" / "art" / "endor-thicket"
OUT_PNG = OUT_DIR / "sprays.png"
OUT_DOC = OUT_DIR / "SPRAYS.md"  # keep the older boughs atlas provenance intact
CACHE = Path(os.environ.get("ENDOR_SPRAYS_CACHE") or (Path(tempfile.gettempdir()) / "endor-sprays-inputs"))

ATLAS = 2048
GUTTER = 16  # transparent margin inside every panel, keeps mip bleed off neighbours
SUPERSAMPLE = 1.5  # render size over panel size, box filtered down in post
SAMPLES = 64
BLENDER_PIN = "3.6.5"
TRANSLUCENCY = 0.28  # light through needles and leaves; keeps shaded cards coloured

# Poly Haven, CC0 1.0. Every url/md5/size below was read from
# https://api.polyhaven.com/files/<asset> (models, 1k tier) and is checked before use.
_M = "https://dl.polyhaven.org/file/ph-assets/Models/"
ASSETS = {
    "fir_sapling": {
        "name": "Fir Sapling",
        "authors": {"Rob Tuytel": "photography", "Rico Cilliers": "modeling"},
        "gltf": (_M + "gltf/1k/fir_sapling/fir_sapling_1k.gltf", "7b1a5ceae7be69954510b5a5c719b4fb", 10979),
        "files": {
            "textures/fir_sapling_branches_diff_1k.jpg": (_M + "jpg/1k/fir_sapling/fir_sapling_branches_diff_1k.jpg", "84f1d40b80a015d65c0ded042a10765b", 776633),
            "textures/fir_sapling_branches_nor_gl_1k.jpg": (_M + "jpg/1k/fir_sapling/fir_sapling_branches_nor_gl_1k.jpg", "db70c4595cf207cc04a02b49c195b78d", 1137599),
            "textures/fir_sapling_branches_arm_1k.jpg": (_M + "jpg/1k/fir_sapling/fir_sapling_branches_arm_1k.jpg", "29a9ff22b8f7f224069b1254db171c05", 793567),
            "textures/fir_sapling_twigs_diff_1k.jpg": (_M + "jpg/1k/fir_sapling/fir_sapling_twigs_diff_1k.jpg", "cd218269e0b34bd1bdb48a8daf21be67", 252678),
            "textures/fir_sapling_twigs_nor_gl_1k.jpg": (_M + "jpg/1k/fir_sapling/fir_sapling_twigs_nor_gl_1k.jpg", "764771b717c54b86fa7d3eadc4a1ada5", 474717),
            "textures/fir_sapling_twigs_arm_1k.jpg": (_M + "jpg/1k/fir_sapling/fir_sapling_twigs_arm_1k.jpg", "cf97b5de863ebad9a48cb187ef3c3e74", 300249),
            "fir_sapling.bin": (_M + "gltf/8k/fir_sapling/fir_sapling.bin", "b329143a90d95201891afc52daeb9698", 21677180),
        },
        "alpha": (_M + "png/1k/fir_sapling/fir_sapling_twigs_alpha_1k.png", "177123c2b5eaeee068be559ff78e54d0", 107682),
    },
    "fern_02": {
        "name": "Fern 02",
        "authors": {"Rob Tuytel": "scanning", "Rico Cilliers": "modeling"},
        "gltf": (_M + "gltf/1k/fern_02/fern_02_1k.gltf", "cf276874d37bfb73c299504a6b355b77", 6899),
        "files": {
            "textures/fern_02_diff_1k.jpg": (_M + "jpg/1k/fern_02/fern_02_diff_1k.jpg", "82c18a6cfd5ae91c37c0e078f591181c", 315705),
            "textures/fern_02_nor_gl_1k.jpg": (_M + "jpg/1k/fern_02/fern_02_nor_gl_1k.jpg", "43aed63dff79554f6064627515afd9d7", 367222),
            "textures/fern_02_arm_1k.jpg": (_M + "jpg/1k/fern_02/fern_02_arm_1k.jpg", "1bbb2b22951f450720d28e17d93a2987", 280359),
            "fern_02.bin": (_M + "gltf/8k/fern_02/fern_02.bin", "c061e9255f7d36ae9ce0e92ef3e100b2", 176176),
        },
        "alpha": (_M + "png/1k/fern_02/fern_02_alpha_1k.png", "1421e5e36946c23a7ddcc907de89025c", 114589),
    },
    "shrub_02": {
        "name": "Shrub 02",
        "authors": {"Rico Cilliers": "all"},
        "gltf": (_M + "gltf/1k/shrub_02/shrub_02_1k.gltf", "8f7254d279c0c49c0b3edfe260aa5c86", 8083),
        "files": {
            "textures/shrub_02_diff_1k.jpg": (_M + "jpg/1k/shrub_02/shrub_02_diff_1k.jpg", "3f4ae281928de030c7d4e41ad5b88a8b", 395120),
            "textures/shrub_02_nor_gl_1k.jpg": (_M + "jpg/1k/shrub_02/shrub_02_nor_gl_1k.jpg", "51a7f2db7e06a207171fd725585241d5", 490815),
            "textures/shrub_02_arm_1k.jpg": (_M + "jpg/1k/shrub_02/shrub_02_arm_1k.jpg", "28c218aeb7cab930d99ee16578984241", 313715),
            "shrub_02.bin": (_M + "gltf/4k/shrub_02/shrub_02.bin", "683b5475238310899eac1458520903e6", 758692),
        },
        "alpha": (_M + "png/1k/shrub_02/shrub_02_alpha_1k.png", "64a1f609d80ea076b43412498a3d2db5", 91741),
    },
}

# Donor glTF marks these materials alphaMode MASK but points baseColor at a JPEG, which has
# no alpha channel, so the importer would see an opaque card. Each cutout material is bound
# to the donor's own sibling alpha PNG below; bark/seed geometry stays opaque.
ALPHA_OF = {
    "fir_sapling_twigs": "fir_sapling_alpha_1k.png",
    "fern_02": "fern_02_alpha_1k.png",
    "shrub_02": "shrub_02_alpha_1k.png",
}

# Panel layout: cells tile the 2048 atlas, listed in reading order left->right, top->bottom.
# Each cell is (x, y, w, h) with y measured down from the top of the atlas.
PANELS = [
    {
        "id": "fir",
        "title": "Whole upright fir",
        "cell": (0, 0, 1024, 2048),
        "asset": "fir_sapling",
        "keep": "fir_sapling_a",
        "view": (26.0, 5.0),  # camera azimuth from -Y, elevation above horizon (degrees)
        "sun": (-38.0, 52.0),  # azimuth offset from the camera, elevation
        "fill": 0.93,  # fraction of the render frame the silhouette fills
        "min_height": 0.70,  # measured alpha height, as a fraction of the whole atlas
    },
    {
        "id": "shrub",
        "title": "Full leafy shrub",
        "cell": (1024, 0, 1024, 1024),
        "asset": "shrub_02",
        # The donor ships four airy native shrubs; one alone reads as a spray of twigs, so
        # three of them are overlapped around a shared base into the one full bush.
        "keep": [
            {"name": "shrub_02_c", "at": (0.0, 0.0, 0.0), "rz": 0.0, "scale": 1.0},
            {"name": "shrub_02_b", "at": (0.10, 0.10, 0.0), "rz": 90.0, "scale": 0.95},
            {"name": "shrub_02_a", "at": (-0.08, -0.09, 0.0), "rz": 180.0, "scale": 0.90},
            {"name": "shrub_02_d", "at": (0.04, -0.06, 0.0), "rz": 270.0, "scale": 0.85},
        ],
        "view": (24.0, 14.0),
        "sun": (-42.0, 48.0),
        "fill": 0.93,
    },
    {
        "id": "fern",
        "title": "Spreading fern, seen from side and above",
        "cell": (1024, 1024, 1024, 512),
        "asset": "fern_02",
        "keep": "fern_02_b",
        "view": (18.0, 38.0),
        "sun": (-46.0, 44.0),
        "fill": 0.93,
    },
    {
        "id": "bough",
        "title": "Conifer bough, pointing up",
        "cell": (1024, 1536, 1024, 512),
        "asset": "fir_sapling",
        "keep": "fir_sapling_c",
        # the sapling's own crown, base cut away and rolled, so the boughs lead upward
        "bough": {"cut": 0.42, "roll": 40.0},
        "view": (28.0, 10.0),
        "sun": (-40.0, 50.0),
        "fill": 0.93,
    },
]


# ---------------------------------------------------------------------------------------
# sources
# ---------------------------------------------------------------------------------------


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch(asset: str, rel: str, spec: tuple[str, str, int]) -> Path:
    url, want, size = spec
    path = CACHE / asset / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size == size and md5_file(path) == want:
        return path
    print(f"  fetching {asset}/{rel}")
    with urllib.request.urlopen(url, timeout=180) as r:
        data = r.read()
    if len(data) != size or hashlib.md5(data).hexdigest() != want:
        raise SystemExit(f"source drift: {url} is not the pinned CC0 file (md5 {want}, {size} B)")
    path.write_bytes(data)
    return path


def ensure_sources() -> None:
    for asset, spec in ASSETS.items():
        fetch(asset, f"{asset}_1k.gltf", spec["gltf"])
        for rel, pinned in spec["files"].items():
            fetch(asset, rel, pinned)
        fetch(asset, f"{asset}_alpha_1k.png", spec["alpha"])


def gltf_path(asset: str) -> Path:
    return CACHE / asset / f"{asset}_1k.gltf"


def read_gltf(asset: str) -> tuple[dict, bytes]:
    g = json.loads(gltf_path(asset).read_text())
    buf = (gltf_path(asset).parent / g["buffers"][0]["uri"]).read_bytes()
    return g, buf


# ---------------------------------------------------------------------------------------
# blender side helpers
# ---------------------------------------------------------------------------------------


def blender_import(asset: str) -> None:
    import bpy

    bpy.ops.import_scene.gltf(filepath=str(gltf_path(asset)))


def materials_for(asset: str) -> dict:
    """Rebuild every donor material as a lit, alpha-clipped foliage shader.

    The donor albedo, tangent normal and arm (AO/rough/metal) maps stay in place, so the
    bake carries the same photographed colour and surface detail as the released model.
    A backfacing flip keeps thin double-sided cards lit from behind instead of black, and
    a little translucency stands in for light passing through needles so the sprays do not
    bake down to flat paint.
    """
    import bpy

    base = gltf_path(asset).parent
    out = {}
    for mat in list(bpy.data.materials):
        name = mat.name.split(".")[0]
        tex = base / "textures"
        diff = tex / f"{name}_diff_1k.jpg"
        nor = tex / f"{name}_nor_gl_1k.jpg"
        arm = tex / f"{name}_arm_1k.jpg"
        if not diff.exists():
            continue
        new = bpy.data.materials.new(f"bake_{name}")
        new.use_nodes = True
        nt = new.node_tree
        nt.nodes.clear()
        out_node = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.location = (-200, 0)
        nt.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Specular"].default_value = 0.18
        bsdf.inputs["IOR"].default_value = 1.45

        def image(path, colorspace="sRGB"):
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = bpy.data.images.load(str(path))
            node.image.colorspace_settings.name = colorspace
            node.interpolation = "Linear"
            return node

        col = image(diff)
        col.location = (-900, 240)
        nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])

        if nor.exists():
            nm = image(nor, "Non-Color")
            nm.location = (-900, -220)
            nmap = nt.nodes.new("ShaderNodeNormalMap")
            nmap.location = (-620, -220)
            nmap.inputs["Strength"].default_value = 1.0
            nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
            # Cycles orients the shading normal to the side the ray came from, so a thin
            # double-sided card is lit from both faces and needs no backface flip. Flipping
            # on Geometry.Backfacing double-flips the leaf backs and bakes them black.
            nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

            trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
            trans.location = (-200, -320)
            nt.links.new(col.outputs["Color"], trans.inputs["Color"])
            nt.links.new(nmap.outputs["Normal"], trans.inputs["Normal"])
            mix = nt.nodes.new("ShaderNodeMixShader")
            mix.location = (60, -120)
            mix.inputs["Fac"].default_value = TRANSLUCENCY
            nt.links.new(bsdf.outputs["BSDF"], mix.inputs[1])
            nt.links.new(trans.outputs["BSDF"], mix.inputs[2])
            nt.links.new(mix.outputs["Shader"], out_node.inputs["Surface"])

        if arm.exists():
            rough = image(arm, "Non-Color")
            rough.location = (-900, 40)
            sep = nt.nodes.new("ShaderNodeSeparateColor")
            sep.location = (-620, 40)
            nt.links.new(rough.outputs["Color"], sep.inputs["Color"])
            nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])

        alpha_name = ALPHA_OF.get(name)
        if alpha_name:
            alpha_path = CACHE / asset / alpha_name
            if not alpha_path.exists():
                raise SystemExit(f"missing pinned alpha {alpha_path}")
            a = image(alpha_path, "Non-Color")
            a.location = (-900, -560)
            nt.links.new(a.outputs["Color"], bsdf.inputs["Alpha"])
            new.blend_method = "CLIP"
            new.alpha_threshold = 0.5
            new.shadow_method = "CLIP"
            new.show_transparent_back = False
        new.use_backface_culling = False
        out[name] = new
        bpy.data.materials.remove(mat)
    return out


def assign_materials(asset: str, objs: list) -> None:
    stems = {}
    for obj in objs:
        stems[obj.name] = [s.material.name.split(".")[0] if s.material else None for s in obj.material_slots]
    mats = materials_for(asset)
    for obj in objs:
        for slot, stem in zip(obj.material_slots, stems[obj.name]):
            if stem in mats:
                slot.material = mats[stem]
            elif stem is None:
                raise SystemExit(f"{obj.name}: slot without a donor material")


def world_to_arrays(obj) -> tuple:
    import numpy as np

    me = obj.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    loops = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", loops)
    starts = np.empty(len(me.polygons), dtype=np.int32)
    totals = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("loop_start", starts)
    me.polygons.foreach_get("loop_total", totals)
    mat_idx = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("material_index", mat_idx)
    return co, loops, starts, totals, mat_idx


def islands(loops: np.ndarray, starts: np.ndarray, totals: np.ndarray) -> np.ndarray:
    """Connected component id per polygon, linked through shared vertices."""
    import numpy as np

    n_vert = int(loops.max()) + 1
    parent = np.arange(n_vert, dtype=np.int64)

    def find(a):
        while True:
            p = parent[a]
            gp = parent[p]
            if np.array_equal(p, gp):
                return p
            parent[a] = gp
            a = gp

    for s, t in zip(starts, totals):
        ring = loops[s : s + t]
        root = find(int(ring[0]))
        for v in ring[1:]:
            rv = find(int(v))
            if rv != root:
                parent[rv] = root
    roots = np.array([find(int(loops[s])) for s in starts])
    _, ids = np.unique(roots, return_inverse=True)
    return ids


def nearby_cards(centre: np.ndarray, inv: np.ndarray, radius: float) -> np.ndarray:
    """How many other needle cards sit within ``radius`` of each card's centre.

    Uses a grid of ``radius`` cells, so the fir sapling's thousands of cards stay cheap.
    """
    import numpy as np

    n_card = int(inv.max()) + 1
    sums = np.zeros((n_card, 3), dtype=np.float64)
    np.add.at(sums, inv, centre)
    card_centre = sums / np.bincount(inv, minlength=n_card)[:, None]
    key = np.floor(card_centre / radius).astype(np.int64)
    span = 1 << 20
    flat = (key[:, 0] + span) * (2 * span) ** 2 + (key[:, 1] + span) * (2 * span) + (key[:, 2] + span)
    uniq, counts = np.unique(flat, return_counts=True)
    total = np.zeros(n_card, dtype=np.int64)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                probe = flat + (dx * (2 * span) ** 2 + dy * (2 * span) + dz)
                pos = np.searchsorted(uniq, probe)
                pos = np.clip(pos, 0, len(uniq) - 1)
                hit = uniq[pos] == probe
                total += np.where(hit, counts[pos], 0)
    return total


def crown_roll(obj, cut: float, roll: float, view) -> None:
    """Cut the base off a sapling and roll the crown about the view axis, so the boughs
    lead upward across the panel. Whole needle cards are dropped, never sliced, and cards
    left floating clear of the crown go with them."""
    import bmesh
    import bpy
    import numpy as np
    from mathutils import Matrix, Vector

    co, loops, starts, totals, mat_idx = world_to_arrays(obj)
    comp = islands(loops, starts, totals)
    ids, inv = np.unique(comp, return_inverse=True)
    centre = np.array([co[loops[s : s + t]].mean(0) for s, t in zip(starts, totals)])
    card_sum = np.zeros((len(ids), 3), dtype=np.float64)
    np.add.at(card_sum, inv, centre)
    card_centre = card_sum / np.bincount(inv, minlength=len(ids))[:, None]
    z_lo, z_hi = float(co[:, 2].min()), float(co[:, 2].max())
    keep_card = card_centre[:, 2] > z_lo + cut * (z_hi - z_lo)
    keep_card &= nearby_cards(centre, inv, 0.25) >= 8
    if int(keep_card.sum()) < 8:
        raise SystemExit("crown cut removed every needle card")
    keep = keep_card[inv]

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep[f.index]], context="FACES")
    bm.to_mesh(obj.data)
    bm.free()

    co, loops, starts, totals, mat_idx = world_to_arrays(obj)
    az, el = (math.radians(v) for v in view)
    view_axis = Vector(
        (math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el))
    ).normalized()
    pivot = Vector(co.mean(0).tolist())
    spin = Matrix.Rotation(math.radians(roll), 4, view_axis)
    obj.matrix_world = Matrix.Translation(pivot) @ spin @ Matrix.Translation(-pivot) @ obj.matrix_world
    bpy.context.view_layer.update()


def resolve_subjects(panel) -> list:
    """Keep only the panel's subject objects and place them.

    ``keep`` is either one object name (used as the donor laid it out) or a list of
    placements, which recentres each part on its own base and offsets, rotates and scales
    it, so donor variants can be overlapped into one clump.
    """
    import bpy
    import numpy as np
    from mathutils import Matrix, Vector

    scene = bpy.context.scene
    keep = panel["keep"]
    wanted = [keep] if isinstance(keep, str) else [p["name"] for p in keep]
    objs = []
    for name in wanted:
        hits = [o for o in scene.objects if o.name == name]
        if not hits:
            have = ", ".join(o.name for o in scene.objects)
            raise SystemExit(f"panel {panel['id']}: no object {name} (have {have})")
        objs.append(hits[0])
    for obj in list(scene.objects):
        if obj not in objs:
            bpy.data.objects.remove(obj, do_unlink=True)
    assign_materials(panel["asset"], objs)

    if not isinstance(keep, str):
        for obj, spec in zip(objs, keep):
            n = len(obj.data.vertices)
            local = np.empty(n * 3)
            obj.data.vertices.foreach_get("co", local)
            local = local.reshape(n, 3)
            world = np.array([(obj.matrix_world @ Vector(v.tolist()))[:] for v in local])
            base = Vector(
                (
                    float(world[:, 0].min() + world[:, 0].max()) / 2.0,
                    float(world[:, 1].min() + world[:, 1].max()) / 2.0,
                    float(world[:, 2].min()),
                )
            )
            obj.matrix_world = (
                Matrix.Translation(Vector(spec.get("at", (0.0, 0.0, 0.0))))
                @ Matrix.Rotation(math.radians(spec.get("rz", 0.0)), 4, "Z")
                @ Matrix.Scale(spec.get("scale", 1.0), 4)
                @ Matrix.Translation(-base)
                @ obj.matrix_world
            )
    bpy.context.view_layer.objects.active = objs[0]
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.update()
    return objs


def stage(panel) -> list:
    """Import the donor model, isolate the panel subject and light it for the bake."""
    import bpy
    from mathutils import Vector

    bpy.ops.wm.read_factory_settings(use_empty=True)
    blender_import(panel["asset"])
    scene = bpy.context.scene

    objs = resolve_subjects(panel)
    subject = objs[0]
    if isinstance(panel.get("bough"), dict):
        crown_roll(subject, panel["bough"]["cut"], panel["bough"]["roll"], panel["view"])

    # world: neutral overcast-ish daylight, bright enough that nothing bakes to silhouette
    world = bpy.data.worlds.new("daylight")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.66, 0.70, 0.74, 1.0)
    bg.inputs[1].default_value = 1.55

    az, el = (math.radians(v) for v in panel["view"])
    sun_az, sun_el = panel["sun"]
    offset = math.radians(sun_az)
    total_az = az + offset
    sun = bpy.data.lights.new("key", "SUN")
    sun.energy = 2.7
    sun.angle = math.radians(3.0)
    sun.color = (1.0, 0.98, 0.94)
    sun_obj = bpy.data.objects.new("key", sun)
    scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (
        math.radians(90.0) - math.radians(sun_el),
        0.0,
        -total_az,
    )
    # soft sky-side fill opposite the key so shaded needles keep their colour
    fill = bpy.data.lights.new("fill", "SUN")
    fill.energy = 1.25
    fill.angle = math.radians(25.0)
    fill.color = (0.86, 0.90, 1.0)
    fill_obj = bpy.data.objects.new("fill", fill)
    scene.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (
        math.radians(90.0) - math.radians(18.0),
        0.0,
        -total_az + math.pi * 0.85,
    )

    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    cam_obj = bpy.data.objects.new("cam", cam)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    direction = Vector(
        (
            math.cos(el) * math.sin(az),
            -math.cos(el) * math.cos(az),
            math.sin(el),
        )
    ).normalized()
    verts = []
    for obj in objs:
        co = [None] * (len(obj.data.vertices) * 3)
        obj.data.vertices.foreach_get("co", co)
        verts.extend(obj.matrix_world @ Vector(co[i : i + 3]) for i in range(0, len(co), 3))

    centre = sum(verts, Vector()) / len(verts)
    cam_obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    cam_obj.location = centre + direction * 8.0
    bpy.context.view_layer.update()
    inv = cam_obj.matrix_world.inverted()
    proj = [inv @ v for v in verts]
    xs = [p.x for p in proj]
    ys = [p.y for p in proj]
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    cam.ortho_scale = max(w, h) / panel["fill"]
    right = cam_obj.matrix_world.to_3x3() @ Vector((1, 0, 0))
    up = cam_obj.matrix_world.to_3x3() @ Vector((0, 1, 0))
    cam_obj.location += right * ((max(xs) + min(xs)) / 2) + up * ((max(ys) + min(ys)) / 2)
    cam.clip_start = 0.01
    cam.clip_end = 40.0

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = panel.get("samples", SAMPLES)
    scene.cycles.seed = 7
    scene.cycles.use_animated_seed = False
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 1
    scene.cycles.transmission_bounces = 2
    scene.cycles.transparent_max_bounces = 48
    scene.render.film_transparent = True
    scene.render.filter_size = 1.6
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "32"
    return objs


def render_panel(panel, tmp: Path) -> Path:
    import bpy

    stage(panel)
    scene = bpy.context.scene
    x, y, w, h = panel["cell"]
    scene.render.resolution_x = int(round(w * SUPERSAMPLE))
    scene.render.resolution_y = int(round(h * SUPERSAMPLE))
    path = tmp / f"{panel['id']}.exr"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    for img in list(bpy.data.images):
        if img.users == 0:
            bpy.data.images.remove(img)
    return path


def read_exr(path: Path):
    """Render result as float RGBA, premultiplied, top row first."""
    import bpy
    import numpy as np

    img = bpy.data.images.load(str(path))
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return buf.reshape(h, w, 4)[::-1]


# ---------------------------------------------------------------------------------------
# compositing
# ---------------------------------------------------------------------------------------


def box_weights(n_in: int, n_out: int):
    import numpy as np

    scale = n_in / n_out
    m = np.zeros((n_out, n_in), dtype=np.float32)
    for j in range(n_out):
        lo, hi = j * scale, (j + 1) * scale
        i0 = int(math.floor(lo))
        i1 = min(int(math.ceil(hi)), n_in)
        for i in range(i0, i1):
            cover = min(hi, i + 1.0) - max(lo, float(i))
            if cover > 0.0:
                m[j, i] = cover / scale
    return m


def resample(src, dw: int, dh: int):
    import numpy as np

    sh, sw = src.shape[:2]
    wy = box_weights(sh, dh)
    wx = box_weights(sw, dw)
    tmp = np.einsum("ij,jkc->ikc", wy, src)
    return np.einsum("ij,kjc->kic", wx, tmp)


def srgb_encode(x):
    import numpy as np

    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1.0 / 2.4) - 0.055)


def bleed_colour(rgba, rounds: int = 6):
    """Push opaque colour outward into transparent texels so mip levels do not darken."""
    import numpy as np

    rgb = rgba[..., :3].copy()
    a = rgba[..., 3]
    solid = a > 0.02
    if not solid.any():
        return rgba
    filled = solid.copy()
    for _ in range(rounds):
        if filled.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(a.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            src_rgb = np.roll(np.roll(rgb, dy, 0), dx, 1)
            src_ok = np.roll(np.roll(filled, dy, 0), dx, 1)
            acc += np.where(src_ok[..., None], src_rgb, 0.0)
            cnt += src_ok
        grow = (~filled) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][..., None]
        filled |= grow
    out = rgba.copy()
    out[..., :3] = rgb
    return out


def panel_from_render(panel, rgba, out_rgba) -> None:
    import numpy as np

    a = rgba[..., 3]
    ys, xs = np.nonzero(a > 1e-4)
    if len(xs) == 0:
        raise SystemExit(f"panel {panel['id']}: empty alpha")
    pad = 2
    x0 = max(0, xs.min() - pad)
    x1 = min(a.shape[1], xs.max() + pad + 1)
    y0 = max(0, ys.min() - pad)
    y1 = min(a.shape[0], ys.max() + pad + 1)
    crop = rgba[y0:y1, x0:x1]

    cx, cy, cw, ch = panel["cell"]
    tw, th = cw - 2 * GUTTER, ch - 2 * GUTTER
    scale = min(tw / crop.shape[1], th / crop.shape[0])
    dw = max(1, int(round(crop.shape[1] * scale)))
    dh = max(1, int(round(crop.shape[0] * scale)))
    small = resample(crop, dw, dh)

    alpha = small[..., 3]
    straight = np.zeros_like(small)
    np.divide(small[..., :3], np.maximum(alpha, 1e-6)[..., None], out=straight[..., :3], where=alpha[..., None] > 1e-6)
    straight[..., 3] = alpha
    straight = bleed_colour(straight)
    encoded = straight.copy()
    encoded[..., :3] = srgb_encode(straight[..., :3])
    encoded[..., 3] = np.clip(alpha, 0.0, 1.0)

    px = cx + (cw - dw) // 2
    py = cy + (ch - dh) // 2
    block = np.zeros((dh, dw, 4), dtype=np.uint8)
    block[..., :3] = np.rint(encoded[..., :3] * 255.0).astype(np.uint8)
    block[..., 3] = np.rint(encoded[..., 3] * 255.0).astype(np.uint8)
    out_rgba[py : py + dh, px : px + dw] = block


# ---------------------------------------------------------------------------------------
# png
# ---------------------------------------------------------------------------------------


def png_encode(rgba) -> bytes:
    h, w = rgba.shape[:2]
    raw = bytearray()
    stride = w * 4
    flat = rgba.tobytes()
    for row in range(h):
        raw.append(0)
        raw += flat[row * stride : (row + 1) * stride]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def png_decode(data: bytes):
    import numpy as np

    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("not a PNG")
    pos = 8
    idat = bytearray()
    w = h = depth = ctype = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        tag = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
            if depth != 8 or ctype != 6 or interlace:
                raise SystemExit(f"unexpected PNG format depth={depth} type={ctype} interlace={interlace}")
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
    raw = zlib.decompress(bytes(idat))
    stride = w * 4
    out = np.zeros((h, stride), dtype=np.uint8)
    prev = np.zeros(stride, dtype=np.uint8)
    for row in range(h):
        base = row * (stride + 1)
        ftype = raw[base]
        line = np.frombuffer(raw[base + 1 : base + 1 + stride], dtype=np.uint8).astype(np.int16)
        if ftype == 0:
            cur = line
        elif ftype == 2:
            cur = (line + prev) & 0xFF
        elif ftype == 1:
            cur = line.copy()
            for i in range(4, stride):
                cur[i] = (cur[i] + cur[i - 4]) & 0xFF
        elif ftype in (3, 4):
            cur = line.copy()
            for i in range(stride):
                left = cur[i - 4] if i >= 4 else 0
                up = int(prev[i])
                upleft = int(prev[i - 4]) if i >= 4 else 0
                pred = (left + up) // 2 if ftype == 3 else _paeth(left, up, upleft)
                cur[i] = (cur[i] + pred) & 0xFF
        else:
            raise SystemExit(f"bad PNG filter {ftype}")
        prev = cur.astype(np.uint8)
        out[row] = prev
    return out.reshape(h, w, 4)


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


# ---------------------------------------------------------------------------------------
# metrics / doc
# ---------------------------------------------------------------------------------------


def measure(rgba) -> dict:
    import numpy as np

    a = rgba[..., 3].astype(np.float32) / 255.0
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    panels = {}
    for panel in PANELS:
        x, y, w, h = panel["cell"]
        cell_a = a[y : y + h, x : x + w]
        cell_rgb = rgb[y : y + h, x : x + w]
        cov = cell_a >= 0.5
        ys, xs = np.nonzero(cov)
        if len(xs) == 0:
            rect = [0, 0, 0, 0]
        else:
            rect = [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]
        lum = cell_rgb.mean(axis=2)
        panels[panel["id"]] = {
            "cell": [x, y, w, h],
            "rect": [rect[0] + x, rect[1] + y, rect[2], rect[3]],
            "uv": [
                round((rect[0] + x) / ATLAS, 6),
                round((rect[1] + y) / ATLAS, 6),
                round((rect[0] + x + rect[2]) / ATLAS, 6),
                round((rect[1] + y + rect[3]) / ATLAS, 6),
            ],
            "aspect": round(rect[2] / rect[3], 4) if rect[3] else 0.0,
            "local_rect": rect,
            "height_frac_atlas": round(rect[3] / ATLAS, 5),
            "height_frac_cell": round(rect[3] / h, 5),
            "width_frac_cell": round(rect[2] / w, 5),
            "coverage": round(float(cov.mean()), 5),
            "alpha_mean": round(float(cell_a.mean()), 5),
            "colour_mean": round(float(lum[cov].mean()) if cov.any() else 0.0, 5),
            "colour_std": round(float(lum[cov].std()) if cov.any() else 0.0, 5),
            "dark_frac": round(float((lum[cov] < 0.06).mean()) if cov.any() else 0.0, 5),
        }
    return panels


def doc_text(manifest: dict) -> str:
    panels = manifest["panels"]
    lines = []
    add = lines.append
    add("# Endor thicket spray atlas")
    add("")
    add(
        "`sprays.png` is a 2048x2048 RGBA cutout atlas for the dense Endor forest between the"
        " near understory and the horizon tree line. Each panel is a **baked render of real"
        " Poly Haven CC0 geometry** under neutral daylight, on a transparent background,"
        " cut to the donor's own alpha map. Nothing here is a camera-facing sprite and"
        " nothing is painted: the panels are meant to be mounted as fixed crossed or"
        " canted meshes, so they must be lit by the scene like any other leaf card."
    )
    add("")
    add("## Panels")
    add("")
    add("Reading order is left to right, top to bottom. Rects are pixels in the atlas with")
    add(f"y measured **down** from the top edge; every panel keeps a {GUTTER} px fully")
    add("transparent gutter so bilinear and mip sampling cannot pick up its neighbour.")
    add("")
    add("| panel | subject | cell x,y,w,h | alpha rect x,y,w,h | height % of atlas | height % of cell | alpha coverage |")
    add("| --- | --- | --- | --- | --- | --- | --- |")
    for panel in PANELS:
        m = panels[panel["id"]]
        add(
            f"| `{panel['id']}` | {panel['title']} | {m['cell'][0]},{m['cell'][1]},{m['cell'][2]},{m['cell'][3]}"
            f" | {m['rect'][0]},{m['rect'][1]},{m['rect'][2]},{m['rect'][3]}"
            f" | {100 * m['height_frac_atlas']:.1f}% | {100 * m['height_frac_cell']:.1f}%"
            f" | {100 * m['coverage']:.1f}% |"
        )
    add("")
    add("Each panel's `uv` in the machine block is the same rect normalised to 0-1, with v")
    add("measured **down** from the top edge, which is the form a mount wants; flip v if the")
    add("renderer puts v=0 at the bottom of the image.")
    add("")
    add("Measured against the shipped file: mean colour, colour spread and the share of")
    add("covered texels darker than 6% are recorded per panel in the machine block below,")
    add("so a re-cook that drifts towards a black silhouette or flat paint fails the check.")
    add("")
    add("## Mounting")
    add("")
    add("- RGBA8, straight (unassociated) alpha, sRGB colour. Sample with alpha test, not")
    add("  blending, so a distant spray needs no depth sort and casts the same dappled")
    add("  shadow a leaf card would.")
    add("- Map each panel's rect onto a fixed quad with that rect as its UV sub-rect. Inset")
    add("  the sub-rect by one texel inside the alpha rect to keep filtering off the gutter.")
    add("- Canted and crossed quads, not camera-facing: the shading was baked from geometry")
    add("  with its own normals, so the spray reads as a volume while the camera turns.")
    add("- Cover texels outside each alpha rect are colour bled, so mips thin the cutout edge")
    add("  without darkening it. Nothing else in the padding is authored.")
    add("")
    add("## Sources")
    add("")
    add("All donor **models** (topology, UVs and photographic material maps) are")
    add("[Poly Haven CC0 assets](https://polyhaven.com/license); no attribution is legally")
    add("required and none of it is stock game art. Art is packed into the atlas, so the")
    add("player never contacts an asset site.")
    add("")
    add("| asset | contributor(s) | understood from |")
    add("| --- | --- | --- |")
    for asset, spec in ASSETS.items():
        who = ", ".join(f"{k} ({v})" for k, v in spec["authors"].items())
        add(f"| [{spec['name']}](https://polyhaven.com/a/{asset}) | {who} | `https://api.polyhaven.com/files/{asset}` |")
    add("")
    add("### Pinned files")
    add("")
    add("The cook checks md5 and size of every input before it renders, and stops on drift.")
    add("")
    add("| file | bytes | md5 |")
    add("| --- | --- | --- |")
    for asset, spec in ASSETS.items():
        add(f"| `{asset}/{asset}_1k.gltf` | {spec['gltf'][2]} | `{spec['gltf'][1]}` |")
        for rel, (_, want, size) in spec["files"].items():
            add(f"| `{asset}/{rel}` | {size} | `{want}` |")
        _, want, size = spec["alpha"]
        add(f"| `{asset}/{asset}_alpha_1k.png` | {size} | `{want}` |")
    add("")
    add("### Materials and alpha")
    add("")
    add(
        "The renders keep the donor albedo, tangent-space normal and arm (AO / roughness /"
        " metal) maps. These glTF exports mark their foliage materials `alphaMode: MASK`"
        " while pointing base colour at a JPEG, which has no alpha channel, so the cutout"
        " would come out as an opaque card. The bake therefore binds each foliage material"
        " to the donor's own sibling alpha PNG (pinned above) and clips at 0.5, the cutoff"
        " the donor declares. Bark stays opaque. The cards are double sided and Cycles"
        " already orients the shading normal to the side the ray came from, so both faces"
        " light correctly as long as nothing flips the normal again; a 28% translucent mix"
        " on top stands in for light scattering through needles, so nothing bakes to a"
        " black silhouette."
    )
    add("")
    add("## Composition")
    add("")
    add(
        "Fir, fern and shrub use the donors as they ship. Two panels do more than place one"
        " node, and both are described here rather than hidden:"
    )
    add("")
    add(
        "- `shrub`: Shrub 02 ships four airy native shrubs, and any one of them alone reads"
        " as a spray of twigs rather than a bush. The panel overlaps all four around a"
        " shared base with different yaws and scales (see `PANELS`), which is how the donor"
        " expects them to be scattered, and bakes them as one full leafy shrub."
    )
    add(
        "- `bough`: one Fir Sapling node, its base trimmed away and the whole crown rolled"
        " 40 deg about the view axis so its boughs lead upward across the panel. Whole needle"
        " cards are dropped, never sliced, and cards left floating clear of the crown go too."
    )
    add("")
    add(
        "Everything is still donor geometry and donor material under the same neutral"
        " daylight; nothing is painted, cloned in image space or taken from a preview render."
    )
    add("")
    add(
        "Shrub 03 was fetched and evaluated for the shrub panel and is not shipped: it is a"
        " 0.30-0.40 m seedling, and at that size its cutout spends most of a panel on empty"
        " texels. Shrub 02, at 2.4 m, holds the silhouette at middle distance."
    )
    add("")
    add("## Bake")
    add("")
    add("- Blender " + BLENDER_PIN + ", Cycles CPU, " + str(SAMPLES) + " samples per pixel,"
        " fixed seed, no adaptive sampling, no denoiser, `Standard` view transform.")
    add("- Frames are rendered at " + str(SUPERSAMPLE) + "x the panel size and area-filtered down"
        " in premultiplied linear light, so alpha edges are clean and no dark fringe forms.")
    add("- Orthographic camera per panel, aligned to the panel's own view; the subject is")
    add("  fitted to the cell by its measured alpha bounds, never stretched.")
    add("- Neutral daylight: white key sun at 2.7 W/m2 with a 3 deg disc, a dim cool sky-side")
    add("  fill at 1.25 and a grey-blue world at 1.55, giving form without black shadows or")
    add("  flat ambient-only paint. No colour grade, no tone curve, alpha threshold 0.5.")
    add("- Output: straight (unassociated) alpha RGBA8, sRGB colour, colour bled into")
    add("  transparent texels so mips do not darken the cutout edge.")
    add("")
    add("## Reproduce")
    add("")
    add("```")
    add("python tools/cook-endor-sprays.py                  # bake atlas and this page")
    add("python tools/cook-endor-sprays.py --doc            # rewrite this page from the atlas")
    add("python tools/cook-endor-sprays.py --verify         # check shipped atlas, no Blender")
    add("python tools/cook-endor-sprays.py --recheck-render # re-bake and diff against shipped")
    add("```")
    add("")
    add("Blender is found on `PATH`, in the usual install locations, or via")
    add("`$ENDOR_SPRAY_BLENDER`. Sources are cached outside the checkout in")
    add("`$ENDOR_SPRAYS_CACHE` or `<tmpdir>/endor-sprays-inputs`; the repo keeps only this")
    add("page, the atlas and the script. Rendering is path traced, and the cutout sits on a")
    add("hard alpha threshold, so path tracer noise at the boundary repaints a handful of the")
    add("4.2 M texels one 8-bit step brighter or darker on a re-cook; `--recheck-render` prints")
    add("that count and fails above 0.05% of the atlas. The sha256 below pins the shipped bytes")
    add("exactly, so `--verify` proves the file on disk is the one this page describes.")
    add("")
    add("## Machine block")
    add("")
    add("Measured from `sprays.png` by `--verify`.")
    add("")
    add("```json")
    add(json.dumps(manifest, indent=2, sort_keys=True))
    add("```")
    add("")
    return "\n".join(lines)


def manifest_of(rgba, digest: str, nbytes: int) -> dict:
    return {
        "file": "public/art/endor-thicket/sprays.png",
        "bytes": nbytes,
        "size": [ATLAS, ATLAS],
        "sha256": digest,
        "blender": BLENDER_PIN,
        "cycles_samples": SAMPLES,
        "supersample": SUPERSAMPLE,
        "gutter": GUTTER,
        "alpha_cutoff": 0.5,
        "panels": measure(rgba),
    }


# ---------------------------------------------------------------------------------------
# cook / verify
# ---------------------------------------------------------------------------------------


def bake(args: list[str]) -> int:
    import numpy as np

    only = None
    samples = SAMPLES
    debug = None
    recheck = False
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--only":
            only = set(args[i + 1].split(","))
            i += 2
        elif a == "--samples":
            samples = int(args[i + 1])
            i += 2
        elif a == "--debug":
            debug = Path(args[i + 1])
            i += 2
        elif a == "--recheck-render":
            recheck = True
            i += 1
        else:
            i += 1
    for panel in PANELS:
        panel["samples"] = samples

    ensure_sources()
    tmp = Path(tempfile.mkdtemp(prefix="endor-sprays-"))
    out = np.zeros((ATLAS, ATLAS, 4), dtype=np.uint8)
    todo = [p for p in PANELS if not only or p["id"] in only]
    for panel in todo:
        print(f"[bake] {panel['id']} ({panel['asset']})")
        exr = render_panel(panel, tmp)
        rgba = read_exr(exr)
        panel_from_render(panel, rgba, out)
        exr.unlink()

    if debug:
        debug.mkdir(parents=True, exist_ok=True)
        (debug / "sprays_preview.png").write_bytes(png_encode(out))
        print(f"[bake] debug atlas -> {debug / 'sprays_preview.png'}")
        shutil.rmtree(tmp, ignore_errors=True)
        return 0

    data = png_encode(out)
    digest = hashlib.sha256(data).hexdigest()
    if recheck:
        if not OUT_PNG.exists():
            raise SystemExit("no shipped atlas to compare against")
        current = OUT_PNG.read_bytes()
        if current == data:
            print(f"PASS re-bake is byte identical to the shipped atlas ({digest[:16]}...)")
            return 0
        old = png_decode(current)
        new = png_decode(data)
        diff = np.abs(old.astype(np.int16) - new.astype(np.int16))
        moved = int((diff > 1).any(axis=2).sum())
        drifted = int((diff > 0).any(axis=2).sum())
        print(f"shipped {hashlib.sha256(current).hexdigest()} != re-bake {digest}")
        print(f"texels that moved: {drifted} of {ATLAS * ATLAS} ({100 * drifted / ATLAS**2:.5f}%), max step {int(diff.max())}/255")
        print(f"texels off by more than one 8-bit step: {moved}")
        return 1 if moved > ATLAS * ATLAS * 0.0005 else 0

    shutil.rmtree(tmp, ignore_errors=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PNG.write_bytes(data)
    manifest = manifest_of(png_decode(data), digest, len(data))
    OUT_DOC.write_text(doc_text(manifest))
    print(f"[bake] wrote {OUT_PNG} ({len(data)} B, sha256 {digest})")
    print(f"[bake] wrote {OUT_DOC}")
    return 0


def write_doc() -> int:
    """Re-derive this page from the shipped atlas without re-rendering."""
    if not OUT_PNG.exists():
        raise SystemExit(f"missing {OUT_PNG}")
    data = OUT_PNG.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    manifest = manifest_of(png_decode(data), digest, len(data))
    OUT_DOC.write_text(doc_text(manifest))
    print(f"rewrote {OUT_DOC} from {OUT_PNG} ({digest})")
    return 0


def find_blender() -> str | None:
    env = os.environ.get("ENDOR_SPRAY_BLENDER")
    if env and Path(env).exists():
        return env
    import glob
    import shutil as sh

    for name in ("blender", "blender.exe"):
        found = sh.which(name)
        if found:
            return found
    patterns = [
        "/c/Program Files/Blender Foundation/Blender */blender.exe",
        "/Applications/Blender.app/Contents/MacOS/Blender",
        "/usr/local/bin/blender",
        "/usr/bin/blender",
        "/snap/bin/blender",
        os.path.expandvars(r"%ProgramFiles%\Blender Foundation\Blender *\blender.exe"),
    ]
    for pattern in patterns:
        hits = sorted(glob.glob(pattern), reverse=True)
        if hits:
            return hits[0]
    return None


def verify() -> int:
    import numpy as np

    if not OUT_PNG.exists():
        raise SystemExit(f"missing {OUT_PNG}")
    if not OUT_DOC.exists():
        raise SystemExit(f"missing {OUT_DOC}")
    data = OUT_PNG.read_bytes()
    doc = OUT_DOC.read_text()
    marker = "```json"
    start = doc.index(marker) + len(marker)
    end = doc.index("```", start)
    recorded = json.loads(doc[start:end])
    fails = []

    def check(ok: bool, message: str) -> None:
        print(("PASS " if ok else "FAIL ") + message)
        if not ok:
            fails.append(message)

    if hashlib.sha256(data).hexdigest() != recorded["sha256"]:
        fails.append("sha256 does not match SOURCES.md")
        print(f"FAIL sha256 {hashlib.sha256(data).hexdigest()} != recorded {recorded['sha256']}")

    rgba = png_decode(data)
    check(rgba.shape == (ATLAS, ATLAS, 4), f"atlas is {ATLAS}x{ATLAS} RGBA8")
    corrected = manifest_of(rgba, recorded["sha256"], len(data))
    measured = corrected["panels"]

    total_cells = 0
    for panel in PANELS:
        pid = panel["id"]
        want = recorded["panels"][pid]
        got = measured[pid]
        x, y, w, h = panel["cell"]
        total_cells += w * h
        check(
            want["cell"] == got["cell"] == [x, y, w, h],
            f"{pid}: cell {got['cell']} matches layout",
        )
        check(
            got["rect"][2] > 0 and got["rect"][3] > 0,
            f"{pid}: alpha bounds {got['rect']} nonempty",
        )
        for key in ("rect", "coverage", "alpha_mean", "colour_mean", "colour_std", "dark_frac"):
            check(
                abs(want[key] - got[key]) < 1e-6 if isinstance(want[key], float) else want[key] == got[key],
                f"{pid}: {key} still {got[key]}",
            )
        check(0.04 < got["coverage"] < 0.92, f"{pid}: alpha coverage {100 * got['coverage']:.1f}% is a cutout, not a slab")
        check(got["colour_mean"] > 0.10, f"{pid}: mean lit colour {got['colour_mean']:.3f} is not a black silhouette")
        check(got["colour_std"] > 0.03, f"{pid}: colour spread {got['colour_std']:.3f} is not flat paint")
        check(got["dark_frac"] < 0.22, f"{pid}: only {100 * got['dark_frac']:.1f}% of texels are near black")
        check(
            measured[pid]["rect"][0] >= x + GUTTER and measured[pid]["rect"][1] >= y + GUTTER
            and measured[pid]["rect"][0] + measured[pid]["rect"][2] <= x + w - GUTTER + 1
            and measured[pid]["rect"][1] + measured[pid]["rect"][3] <= y + h - GUTTER + 1,
            f"{pid}: content stays inside the {GUTTER}px gutter",
        )

    check(total_cells == ATLAS * ATLAS, "the four cells tile the atlas without a gap")
    fir = measured["fir"]
    check(
        fir["height_frac_atlas"] >= PANELS[0]["min_height"],
        f"fir: alpha height is {100 * fir['height_frac_atlas']:.1f}% of the atlas (needs 70%+)",
    )
    check(
        fir["height_frac_cell"] >= PANELS[0]["min_height"],
        f"fir: alpha height is {100 * fir['height_frac_cell']:.1f}% of its cell",
    )

    # gutter rows and columns must be fully transparent so panels cannot bleed
    a = rgba[..., 3]
    edges = np.concatenate(
        [
            a[:, :GUTTER].ravel(),
            a[:, ATLAS - GUTTER :].ravel(),
            a[:GUTTER, :].ravel(),
            a[ATLAS - GUTTER :, :].ravel(),
        ]
    )
    check(int(edges.max()) == 0, "atlas border ring is fully transparent")

    if fails:
        print(f"\n{len(fails)} check(s) failed")
        return 1
    print(f"\nPASS sprays.png matches SOURCES.md: four CC0 baked spray panels, fir "
          f"{100 * fir['height_frac_atlas']:.1f}% of atlas height, alpha bounds and colour stats pinned")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if "--verify" in args:
        return verify()
    if "--doc" in args:
        return write_doc()
    if "--only" in args and "--debug" not in args:
        raise SystemExit("--only is a preview switch; give it a --debug DIR")

    if "bpy" not in sys.modules:
        try:
            import bpy  # noqa: F401  (only importable inside Blender)
        except ImportError:
            blender = find_blender()
            if not blender:
                print("Blender not found. Set ENDOR_SPRAY_BLENDER to blender(.exe).")
                return 2
            cmd = [blender, "-b", "--factory-startup", "--python", str(Path(__file__).resolve()), "--"] + args
            print("running", " ".join(cmd))
            return subprocess.call(cmd)
    return bake(args)


if __name__ == "__main__":
    sys.exit(main())
