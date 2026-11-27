"""Encode the check-universal-hdr.cjs readbacks. Requires numpy and Pillow. No game art is bundled."""
import json
from pathlib import Path
import struct
import sys
import zlib

import numpy as np
from PIL import Image

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'tools/baselines/hdr')
meta = json.loads((root / 'capture.json').read_text())
w, h = meta['width'], meta['height']
Image.frombytes('RGBA', (w, h), (root / 'sdr.rgba').read_bytes()).convert('RGB').save(root / 'sdr.png')
signal = np.fromfile(root / 'hdr.f32', dtype='<f4').reshape(h, w, 4)[:, :, :3]
linear = np.where(signal <= 0.04045, signal / 12.92, ((signal + 0.055) / 1.055) ** 2.4)

# SDR proof: identity up to 60% linear reference white, then a smooth shoulder. No exposure, saturation or sharpening changes.
peak = np.max(linear, axis=2, keepdims=True)
d = np.maximum(peak - .6, 0)
proof = linear * np.where(peak <= .6, 1, (.6 + .4 * d / (.4 + d)) / np.maximum(peak, 1e-8))
encoded = np.where(proof <= .0031308, proof * 12.92, 1.055 * proof ** (1 / 2.4) - .055)
Image.fromarray(np.uint8(np.round(255 * np.clip(encoded, 0, 1)))).save(root / 'hdr-preview.png')

# Native HDR still: convert linear Rec.709 primaries to BT.2020, then apply ST 2084 (203 nit reference white).
matrix = np.array([[.627404, .329283, .043313], [.069097, .919540, .011363], [.016391, .088013, .895596]])
y = np.clip((linear @ matrix.T) * (203 / 10000), 0, 1) ** (2610 / 16384)
pq = ((3424 / 4096 + (2413 / 128) * y) / (1 + (2392 / 128) * y)) ** (2523 / 32)
rows = np.uint16(np.round(65535 * pq)).astype('>u2').tobytes()

def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))

# PNG 3 cICP: BT.2020 primaries, PQ transfer, identity RGB matrix, full range. No conflicting sRGB or gAMA chunks.
(root / 'hdr-pq.png').write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 16, 2, 0, 0, 0))
    + chunk(b'cICP', bytes([9, 16, 0, 1]))
    + chunk(b'IDAT', zlib.compress(b''.join(b'\0' + rows[i*w*6:(i+1)*w*6] for i in range(h)))) + chunk(b'IEND', b''))
print(f"{w}x{h}: wrote sdr.png, hdr-preview.png, hdr-pq.png in {root.resolve()}")
