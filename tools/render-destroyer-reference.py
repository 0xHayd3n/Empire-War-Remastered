"""Offline Blender 3.6 Cycles reference renderer for "Destroyer" clay/material shots.

Standalone: takes a private local JSON scene dump and renders a reference PNG.
No network access, no asset importing, no game files are read or written.

Usage
-----
    blender -b -P tools/render-destroyer-reference.py -- input.json output.png

Input JSON
----------
    {
      "width":  <int>,                     # pixels (required)
      "height": <int>,                     # pixels (required)
      "camera": {
        "matrix": [16 floats],             # THREE column-major world matrix
        "fov":    <float>                  # VERTICAL field of view, degrees
      },
      "sun":     { "dir":   [x, y, z],     # unit vector pointing TOWARD the sun
                   "color": [r, g, b] },   # linear RGB
      "ambient": [r, g, b],                # linear RGB, uniform sky radiance
      "meshes": [
        {
          "name":  <str>,
          "position": [x0, y0, z0, x1, ...],   # BufferGeometry position attribute
          "index":    [i0, i1, i2, ...] | null, # triangle list, null = soup
          "matrix":   [16 floats],             # THREE column-major world matrix
          "color":    [r, g, b],               # linear RGB base colour
          "roughness": <float>,
          "metalness": <float>,
          "emission":  <float>                 # emission strength, 0 = none
        }
      ]
    }

Geometry semantics follow THREE.BufferGeometry exactly:
  * ``position`` is the flat vertex attribute (3 floats per vertex).
  * ``index`` is a flat triangle index list; when it is ``null`` the vertices
    are consumed as a non-indexed triangle soup (3 vertices per triangle).
  * ``matrix`` is the world transform already carrying translation, so it is
    assigned verbatim to ``object.matrix_world``.

Conventions
-----------
* Scene space is Z-up, matching Blender. Blender cameras also look down their
  local -Z with +Y up, so the THREE camera world matrix is used unchanged
  (no axis swap, no negation) and only transposed into Blender's row-major
  ``Matrix`` form.
* ``fov`` is vertical; the camera is rendered with ``sensor_fit = 'VERTICAL'``
  and ``angle_y`` pinned to it, so aspect never changes the vertical framing.
* Materials are Principled BSDF with linear base colour, roughness, metallic
  and an optional emission term, lit by one sun plus a uniform ambient world.
* Colour management is fixed: ``Standard`` view transform, ``None`` look,
  exposure 0, gamma 1, sRGB display. Film is transparent (alpha background)
  unless the JSON supplies an optional ``"background": [r, g, b]``, which is
  shown to camera rays only and therefore never contaminates ambient lighting.
* Lighting energy is normalised so a white sun/ambient reproduces albedo: a
  matte surface facing the sun renders back its own base colour (measured
  within 2/255 of the linear->sRGB value; the small excess is the Principled
  specular lobe).

Optional keys (defaults chosen for a clean reference)
-----------------------------------------------------
  "sun":        { "strength": <float>,        # default PI (albedo-matching)
                  "angle_degrees": <float> }   # default 0 = sharp shadows
  "samples":    <int>    (default 128)
  "denoise":    <bool>   (default true, OpenImageDenoise)
  "seed":       <int>    (default 0)
  "background": [r, g, b]                # opaque background instead of alpha

Environment
-----------
  DESTROYER_REF_DEVICE=cpu|gpu|auto   auto (default) prefers OptiX.

Notes
-----
* The Cycles light tree is deliberately disabled: with a single sun it buys
  nothing, and on the OptiX GPU path a zero-angle sun sampled through the light
  tree loses most of its energy (measured on an RTX 3070: CPU median display
  luminance 0.560, OptiX with light tree 0.172, OptiX without it 0.560).
* Renders are reproducible: fixed seed, no dithering, no adaptive threshold
  drift between engines. Emission/colour output matches the analytic
  linear->sRGB value exactly; OptiX and CPU differ by at most 4/255 on a
  handful of denoised pixels. Only the PNG tEXt metadata (date, render time)
  differs between runs of the same input.
* Nothing is read from the game and nothing but the output PNG is written; the
  scene is built entirely from the JSON.

Exit codes: 0 rendered, 2 bad input/usage, 3 render failed.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import traceback

import bpy
from mathutils import Matrix, Vector

# A white sun of strength PI on a Lambertian surface yields radiance == albedo
# (irradiance PI * albedo / PI). Same for a uniform PI-white ambient sky.
SUN_STRENGTH_DEFAULT = math.pi
AMBIENT_STRENGTH = 1.0
EPSILON = 1e-5
IDENTITY = [
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0,
]


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #
def log(message: str) -> None:
    print(f"[destroyer-ref] {message}", flush=True)


def fail(message: str):  # never returns
    log(f"ERROR: {message}")
    sys.exit(2)


def as_float_list(value, length: int, label: str) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != length:
        got = len(value) if isinstance(value, (list, tuple)) else type(value).__name__
        fail(f"{label} must be a list of {length} numbers (got {got})")
    try:
        return [float(v) for v in value]
    except (TypeError, ValueError):
        fail(f"{label} must contain only numbers")


def as_vector(value, length: int, label: str) -> Vector:
    return Vector(as_float_list(value, length, label))


def as_float(value, label: str, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        fail(f"{label} must be a number (got {value!r})")
    if not math.isfinite(number):
        fail(f"{label} must be finite (got {number!r})")
    return number


def col_major_to_matrix(flat: list[float], label: str) -> Matrix:
    """THREE column-major 16 floats -> Blender row-major Matrix."""
    columns = [flat[0:4], flat[4:8], flat[8:12], flat[12:16]]
    rows = [[columns[c][r] for c in range(4)] for r in range(4)]
    matrix = Matrix(rows)
    if not all(math.isfinite(v) for row in matrix for v in row):
        fail(f"{label} contains non-finite values")
    # A THREE projection (or view-projection) matrix has a non-affine bottom
    # row; assigning one as a world transform would scramble the scene silently.
    bottom = (flat[3], flat[7], flat[11], flat[15])
    if (any(abs(bottom[i]) > 1e-4 for i in (0, 1, 2))
            or abs(bottom[3] - 1.0) > 1e-4):
        fail(f"{label} is not an affine transform (bottom row {bottom}); pass "
             f"the object's world matrix, not a projection matrix")
    return matrix


# --------------------------------------------------------------------------- #
# scene setup
# --------------------------------------------------------------------------- #
def wipe_scene() -> None:
    for datablocks in (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.lights,
        bpy.data.cameras,
        bpy.data.images,
        bpy.data.node_groups,
    ):
        for item in list(datablocks):
            datablocks.remove(item, do_unlink=True)


def configure_color_management(scene) -> None:
    scene.display_settings.display_device = "sRGB"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    try:
        scene.view_settings.look = "None"
    except TypeError:
        log(f"warning: 'None' look unavailable, keeping "
            f"{scene.view_settings.look!r}")


def configure_render(scene, width: int, height: int, samples: int,
                     denoise: bool, seed: int, transparent: bool) -> None:
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = 1.0
    scene.render.film_transparent = transparent
    scene.render.use_file_extension = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15
    scene.render.use_compositing = False
    scene.render.use_sequencer = False
    scene.render.dither_intensity = 0.0  # deterministic reference pixels

    scene.cycles.samples = samples
    scene.cycles.preview_samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.01
    scene.cycles.adaptive_min_samples = min(samples, max(1, samples // 8))
    scene.cycles.use_denoising = denoise
    if denoise:
        try:
            scene.cycles.denoiser = "OPENIMAGEDENOISE"
        except TypeError:  # older/newer builds
            log("warning: OpenImageDenoise unavailable, using default denoiser")
        scene.cycles.denoising_input_passes = "RGB_ALBEDO_NORMAL"
        scene.cycles.denoising_prefilter = "ACCURATE"
    scene.cycles.seed = seed
    scene.cycles.use_animated_seed = False
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 4
    scene.cycles.transmission_bounces = 4
    scene.cycles.transparent_max_bounces = 4
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.cycles.blur_glossy = 1.0
    scene.cycles.sample_clamp_direct = 0.0
    scene.cycles.sample_clamp_indirect = 10.0
    scene.cycles.film_exposure = 1.0
    scene.cycles.filter_width = 1.5
    # The light tree is off on purpose. With a single sun it buys nothing, and
    # on the OptiX GPU path a zero-angle sun sampled through the light tree
    # loses ~70% of its energy (verified: identical scene, CPU = 0.560 median
    # luminance, OptiX + light tree = 0.172, OptiX without it = 0.560).
    try:
        scene.cycles.use_light_tree = False
    except AttributeError:
        pass

    configure_color_management(scene)


def choose_device(scene) -> str:
    """Select OptiX when a real OptiX device exists, otherwise CPU.

    ``DESTROYER_REF_DEVICE=cpu`` (or ``gpu``) forces a choice; it exists so the
    fallback path can be exercised on a machine that does have OptiX.
    """
    forced = os.environ.get("DESTROYER_REF_DEVICE", "auto").strip().lower()
    label = "CPU"
    try:
        preferences = bpy.context.preferences.addons["cycles"].preferences
    except KeyError:
        log("warning: cycles addon preferences unavailable, using CPU")
        scene.cycles.device = "CPU"
        return label

    if forced == "cpu":
        for device in getattr(preferences, "devices", []):
            device.use = device.type == "CPU"
        scene.cycles.device = "CPU"
        return "CPU (forced by DESTROYER_REF_DEVICE)"

    picked: list[str] = []
    for candidate in ("OPTIX", "CUDA"):
        try:
            preferences.compute_device_type = candidate
            preferences.get_devices()
            devices = [d for d in preferences.devices if d.type == candidate]
        except Exception as exc:
            log(f"{candidate} probe failed: {exc}")
            continue
        if not devices:
            continue
        for device in preferences.devices:
            device.use = device.type == candidate
        names = ", ".join(getattr(d, "name", "?") for d in devices)
        picked.append(f"{candidate} ({len(devices)}: {names})")
        if candidate == "OPTIX":
            break  # OptiX is preferred; do not fall through to CUDA

    if picked:
        scene.cycles.device = "GPU"
        label = picked[0]
    else:
        try:
            preferences.compute_device_type = "NONE"
        except Exception:
            pass
        for device in getattr(preferences, "devices", []):
            device.use = device.type == "CPU"
        scene.cycles.device = "CPU"
        if forced == "gpu":
            log("warning: DESTROYER_REF_DEVICE=gpu requested but no OptiX/CUDA "
                "device was found; using CPU")
    return label


def build_world(scene, ambient: Vector, background) -> None:
    world = bpy.data.worlds.new("destroyer-ref-world")
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputWorld")
    output.location = (600, 0)
    ambient_bg = nodes.new("ShaderNodeBackground")
    ambient_bg.location = (200, 100)
    ambient_bg.inputs["Color"].default_value = (ambient.x, ambient.y, ambient.z, 1.0)
    ambient_bg.inputs["Strength"].default_value = AMBIENT_STRENGTH

    if background is None:
        links.new(ambient_bg.outputs["Background"], output.inputs["Surface"])
        return

    # Opaque backdrop: camera rays see the requested colour, every other ray
    # keeps seeing the ambient sky, so ambient energy is unchanged.
    camera_bg = nodes.new("ShaderNodeBackground")
    camera_bg.location = (200, -160)
    camera_bg.inputs["Color"].default_value = (
        background.x, background.y, background.z, 1.0)
    camera_bg.inputs["Strength"].default_value = 1.0

    light_path = nodes.new("ShaderNodeLightPath")
    light_path.location = (-200, 350)
    mix = nodes.new("ShaderNodeMixShader")
    mix.location = (400, 0)
    links.new(light_path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    links.new(ambient_bg.outputs["Background"], mix.inputs[1])
    links.new(camera_bg.outputs["Background"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])


def build_sun(scene, direction: Vector, color: Vector, strength: float,
              angle_degrees: float = 0.0) -> None:
    light = bpy.data.lights.new("destroyer-ref-sun", type="SUN")
    light.energy = strength
    light.color = (color.x, color.y, color.z)
    light.angle = math.radians(max(angle_degrees, 0.0))
    light.use_shadow = True
    obj = bpy.data.objects.new("destroyer-ref-sun", light)
    # A sun emits along its local -Z, so align local +Z with the direction
    # pointing toward the sun: rays then travel toward the scene.
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.normalized().to_track_quat("Z", "Y")
    scene.collection.objects.link(obj)


def build_camera(scene, matrix: Matrix, fov_degrees: float) -> None:
    camera = bpy.data.cameras.new("destroyer-ref-camera")
    camera.type = "PERSP"
    camera.sensor_fit = "VERTICAL"
    camera.angle_y = math.radians(fov_degrees)
    camera.clip_start = 0.01
    camera.clip_end = 10000.0
    obj = bpy.data.objects.new("destroyer-ref-camera", camera)
    obj.matrix_world = matrix
    scene.collection.objects.link(obj)
    scene.camera = obj


def build_material(entry: dict, cache: dict) -> "bpy.types.Material":
    color = as_vector(entry.get("color") or [0.8, 0.8, 0.8], 3,
                      "meshes[].color")
    roughness = as_float(entry.get("roughness"), "meshes[].roughness", 0.5)
    metalness = as_float(entry.get("metalness"), "meshes[].metalness", 0.0)
    emission = as_float(entry.get("emission"), "meshes[].emission", 0.0)
    roughness = min(max(roughness, 0.0), 1.0)
    metalness = min(max(metalness, 0.0), 1.0)
    emission = max(emission, 0.0)

    key = (round(color.x, 6), round(color.y, 6), round(color.z, 6),
           round(roughness, 6), round(metalness, 6), round(emission, 6))
    if key in cache:
        return cache[key]

    material = bpy.data.materials.new("destroyer-ref-mat")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    for node in list(nodes):
        nodes.remove(node)

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (400, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    rgba = (color.x, color.y, color.z, 1.0)
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metalness
    if emission > EPSILON:
        bsdf.inputs["Emission"].default_value = rgba
        bsdf.inputs["Emission Strength"].default_value = emission
    else:
        bsdf.inputs["Emission Strength"].default_value = 0.0
    # Reference clay: no clearcoat, no sheen, no transmission, opaque surfaces.
    for socket_name, value in (
        ("Coat Weight", 0.0),
        ("Sheen Weight", 0.0),
        ("Transmission Weight", 0.0),
        ("Transmission", 0.0),
        ("Specular IOR Level", 0.5),
        ("Alpha", 1.0),
    ):
        socket = bsdf.inputs.get(socket_name)
        if socket is not None:
            try:
                socket.default_value = value
            except (TypeError, ValueError):
                pass
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    material.diffuse_color = rgba
    cache[key] = material
    return material


def build_mesh(scene, entry: dict, index: int, material) -> tuple[int, int, Vector, Vector]:
    name = str(entry.get("name") or f"mesh_{index}")
    flat_positions = entry.get("position")
    if not isinstance(flat_positions, (list, tuple)):
        fail(f"{name}: position must be a flat list of floats")
    if len(flat_positions) % 3 != 0:
        fail(f"{name}: position length {len(flat_positions)} is not a multiple of 3")
    try:
        positions = [float(v) for v in flat_positions]
    except (TypeError, ValueError):
        fail(f"{name}: position must contain only numbers")
    if not all(math.isfinite(v) for v in positions):
        fail(f"{name}: position contains non-finite values")
    vertices = [tuple(positions[i:i + 3]) for i in range(0, len(positions), 3)]

    raw_index = entry.get("index", None)
    if raw_index is None:
        if len(vertices) == 0:
            log(f"warning: {name} has no vertices, skipped")
            return (0, 0, Vector(), Vector())
        if len(vertices) % 3 != 0:
            fail(f"{name}: non-indexed position count {len(vertices)} is not a "
                 f"multiple of 3 (needs a triangle soup or an index list)")
        faces = [(i, i + 1, i + 2) for i in range(0, len(vertices), 3)]
    else:
        if not isinstance(raw_index, (list, tuple)):
            fail(f"{name}: index must be a flat list or null")
        if len(raw_index) % 3 != 0:
            fail(f"{name}: index length {len(raw_index)} is not a multiple of 3")
        try:
            indices = [int(v) for v in raw_index]
        except (TypeError, ValueError):
            fail(f"{name}: index must contain only integers")
        if any(i < 0 or i >= len(vertices) for i in indices):
            fail(f"{name}: index out of range for {len(vertices)} vertices")
        faces = [tuple(indices[i:i + 3]) for i in range(0, len(indices), 3)]

    if not faces:
        log(f"warning: {name} has no triangles, skipped")
        return (0, 0, Vector(), Vector())

    matrix = col_major_to_matrix(
        as_float_list(entry.get("matrix") or IDENTITY, 16, f"{name}.matrix"),
        f"{name}.matrix")

    if matrix.determinant() < 0.0:
        # A mirroring transform flips winding; reverse faces so the shaded
        # normals still point outward.
        faces = [tuple(reversed(face)) for face in faces]

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(verbose=False)
    mesh.update()
    for polygon in mesh.polygons:
        polygon.use_smooth = False
    mesh.materials.append(material)

    obj = bpy.data.objects.new(name, mesh)
    obj.matrix_world = matrix
    scene.collection.objects.link(obj)

    # World-space bounds for camera clipping only.
    world_min = Vector((float("inf"),) * 3)
    world_max = Vector((float("-inf"),) * 3)
    for vertex in vertices:
        world = matrix @ Vector(vertex)
        for axis in range(3):
            world_min[axis] = min(world_min[axis], world[axis])
            world_max[axis] = max(world_max[axis], world[axis])
    return (len(vertices), len(faces), world_min, world_max)


def fit_clip_planes(scene, size: Vector, bounds_center: Vector, eye: Vector) -> None:
    radius = max(size.length, 1.0)
    distance = max((eye - bounds_center).length, radius)
    scene.camera.data.clip_start = max(radius * 1e-4, 1e-3)
    scene.camera.data.clip_end = max(
        distance + radius * 8.0, radius * 10.0, 100.0)


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def inspect_png(path: str) -> tuple[int, float, float]:
    """Read back the written PNG: pixel count, opaque fraction, mean luminance.

    Cheap sanity net for a silently degenerate setup (wrong camera transform,
    camera inside geometry, lighting that failed to sample). Values are in the
    stored (display, sRGB-encoded) domain.
    """
    try:
        image = bpy.data.images.load(os.path.abspath(path), check_existing=False)
    except Exception as exc:
        log(f"warning: could not read back {path}: {exc}")
        return (0, 1.0, 1.0)
    try:
        width, height = int(image.size[0]), int(image.size[1])
        total = width * height
        if total <= 0:
            return (0, 1.0, 1.0)
        try:
            import numpy as np
        except ImportError:
            log("warning: numpy unavailable, skipping the render sanity check")
            return (total, 1.0, 1.0)
        buffer = np.empty(total * 4, dtype=np.float32)
        image.pixels.foreach_get(buffer)
        buffer = buffer.reshape(-1, 4)
        opaque_mask = buffer[:, 3] >= 0.02
        opaque = int(np.count_nonzero(opaque_mask))
        if opaque == 0:
            return (total, 0.0, 0.0)
        rgb = buffer[opaque_mask][:, :3]
        luminance = float(np.mean(rgb @ np.array([0.2126, 0.7152, 0.0722],
                                                dtype=np.float32)))
        return (total, opaque / total, luminance)
    finally:
        bpy.data.images.remove(image)


def main() -> int:
    argv = sys.argv
    if "--" not in argv:
        fail("usage: blender -b -P render-destroyer-reference.py -- "
             "input.json output.png")
    args = argv[argv.index("--") + 1:]
    if len(args) < 2:
        fail("usage: blender -b -P render-destroyer-reference.py -- "
             "input.json output.png")
    input_path, output_path = args[0], args[1]
    if not os.path.isfile(input_path):
        fail(f"input JSON not found: {input_path}")

    started = time.time()
    with open(input_path, "r", encoding="utf-8") as handle:
        try:
            spec = json.load(handle)
        except json.JSONDecodeError as exc:
            fail(f"invalid JSON in {input_path}: {exc}")
    if not isinstance(spec, dict):
        fail("top-level JSON value must be an object")

    width = int(as_float(spec.get("width"), "width", 0))
    height = int(as_float(spec.get("height"), "height", 0))
    if width <= 0 or height <= 0:
        fail("width and height must be positive integers")

    camera_spec = spec.get("camera") or {}
    camera_matrix = col_major_to_matrix(
        as_float_list(camera_spec.get("matrix") or IDENTITY, 16,
                      "camera.matrix"),
        "camera.matrix")
    fov = as_float(camera_spec.get("fov"), "camera.fov", 45.0)
    if not (0.0 < fov < 180.0):
        fail(f"camera.fov must be in (0, 180) degrees, got {fov}")

    sun_spec = spec.get("sun") or {}
    sun_dir = as_vector(sun_spec.get("dir") or [0.0, 0.0, 1.0], 3, "sun.dir")
    if sun_dir.length < EPSILON:
        fail("sun.dir must be a non-zero vector")
    sun_color = as_vector(sun_spec.get("color") or [1.0, 1.0, 1.0], 3, "sun.color")
    sun_strength = as_float(sun_spec.get("strength"), "sun.strength",
                            SUN_STRENGTH_DEFAULT)
    if sun_strength < 0.0:
        fail("sun.strength must be non-negative")
    sun_angle = as_float(sun_spec.get("angle_degrees"), "sun.angle_degrees", 0.0)
    sun_angle = min(max(sun_angle, 0.0), 90.0)

    ambient = as_vector(spec.get("ambient") or [0.0, 0.0, 0.0], 3, "ambient")

    background_spec = spec.get("background")
    background = (None if background_spec is None
                  else as_vector(background_spec, 3, "background"))

    samples = int(as_float(spec.get("samples"), "samples", 128.0))
    samples = max(1, min(samples, 8192))
    denoise_spec = spec.get("denoise")
    denoise = True if denoise_spec is None else bool(denoise_spec)
    seed = int(as_float(spec.get("seed"), "seed", 0.0))

    meshes = spec.get("meshes") or []
    if not isinstance(meshes, list):
        fail("meshes must be a list")
    if not meshes:
        fail("meshes must contain at least one entry")

    scene = bpy.context.scene
    wipe_scene()
    scene = bpy.context.scene
    configure_render(scene, width, height, samples, denoise, seed,
                     transparent=background is None)
    build_world(scene, ambient, background)
    build_sun(scene, sun_dir, sun_color, sun_strength, sun_angle)
    build_camera(scene, camera_matrix, fov)

    material_cache: dict = {}
    total_vertices = total_triangles = 0
    bounds_min = Vector((float("inf"),) * 3)
    bounds_max = Vector((float("-inf"),) * 3)
    for index, entry in enumerate(meshes):
        if not isinstance(entry, dict):
            fail(f"meshes[{index}] must be an object")
        material = build_material(entry, material_cache)
        vertices, triangles, mesh_min, mesh_max = build_mesh(
            scene, entry, index, material)
        total_vertices += vertices
        total_triangles += triangles
        if triangles:
            for axis in range(3):
                bounds_min[axis] = min(bounds_min[axis], mesh_min[axis])
                bounds_max[axis] = max(bounds_max[axis], mesh_max[axis])

    if total_triangles == 0:
        fail("no renderable triangles in input")

    size = bounds_max - bounds_min
    if not all(math.isfinite(v) for v in size):
        size = Vector((1.0, 1.0, 1.0))
    fit_clip_planes(scene, size, (bounds_min + bounds_max) * 0.5,
                    camera_matrix.translation)

    device = choose_device(scene)
    log(f"device: {device}")
    log(f"scene: {len(meshes)} mesh(es), {total_vertices} verts, "
        f"{total_triangles} tris, {width}x{height}, {samples} spp, "
        f"denoise={'on' if denoise else 'off'}")
    log(f"colour management: Standard / look None / exposure 0 / gamma 1")
    log(f"film: {'transparent (alpha)' if background is None else 'opaque background'}")
    log(f"sun: dir=({sun_dir.x:.3f}, {sun_dir.y:.3f}, {sun_dir.z:.3f}) "
        f"color=({sun_color.x:.3f}, {sun_color.y:.3f}, {sun_color.z:.3f}) "
        f"strength={sun_strength:.3f} angle={sun_angle:.3f}deg")
    log(f"ambient=({ambient.x:.3f}, {ambient.y:.3f}, {ambient.z:.3f})")
    log(f"bounds: min=({bounds_min.x:.2f}, {bounds_min.y:.2f}, {bounds_min.z:.2f}) "
        f"max=({bounds_max.x:.2f}, {bounds_max.y:.2f}, {bounds_max.z:.2f})")

    output_dir = os.path.dirname(os.path.abspath(output_path))
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    scene.render.filepath = os.path.abspath(output_path)

    render_started = time.time()
    try:
        bpy.ops.render.render(write_still=True)
    except Exception as exc:
        if scene.cycles.device == "GPU":
            log(f"GPU render failed ({exc}); falling back to CPU")
            scene.cycles.device = "CPU"
            device = "CPU (fallback after GPU error)"
            log(f"device: {device}")
            try:
                bpy.ops.render.render(write_still=True)
            except Exception as exc2:
                log("CPU render also failed:")
                traceback.print_exc()
                return 3
        else:
            log("render failed:")
            traceback.print_exc()
            return 3
    render_seconds = time.time() - render_started

    if not os.path.isfile(output_path):
        fail(f"render finished but no file was written to {output_path}")

    pixels, opaque_fraction, mean_luminance = inspect_png(output_path)
    log(f"pixels: {pixels} px, opaque={opaque_fraction * 100:.1f}%, "
        f"mean luminance(display)={mean_luminance:.3f}")
    if opaque_fraction <= 0.0:
        log("warning: every pixel is transparent - check the camera matrix and "
            "fov; nothing is in frame")
    elif opaque_fraction < 0.01:
        log("warning: under 1% of the frame is covered by geometry")
    if mean_luminance < 0.002:
        log("warning: render is essentially black - check lighting and that "
            "the camera is not inside the geometry")

    log(f"device used: {device}")
    log(f"render: {render_seconds:.2f}s  total: {time.time() - started:.2f}s")
    log(f"output: {os.path.abspath(output_path)} "
        f"({os.path.getsize(output_path)} bytes, {pixels} px)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
