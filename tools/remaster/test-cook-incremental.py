"""Portable offline tests for the incremental cook. No network, no real texconv, no checkout writes.
Run: python test-cook-incremental.py       (needs python3 + Pillow + numpy)
"""
import hashlib, importlib.util, json, os, shutil, sys, tempfile
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
CANDIDATES = [HERE / 'cook-polyhaven.py', HERE.parent / 'script' / 'cook-polyhaven.py']
SCRIPT = Path(os.environ.get('COOK_SCRIPT') or next(p for p in CANDIDATES if p.exists()))
WORK = Path(tempfile.mkdtemp(prefix='cook-incremental-tests-'))
CACHE = WORK / 'cache'
CACHE.mkdir()
os.environ['COOK_CACHE'] = str(CACHE)          # private, before import
os.environ['COOK_TEST_LOG'] = str(WORK / 'texconv.log')

spec = importlib.util.spec_from_file_location('cook_polyhaven', SCRIPT)
cook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cook)

ART = WORK / 'art'
REC = WORK / 'receipts'
LOG = WORK / 'texconv.log'
SHIM = WORK / 'fake_texconv.py'
SHIM.write_text('''import hashlib, os, pathlib, sys
a = sys.argv[1:]
out = pathlib.Path(a[a.index('-o') + 1]); src = pathlib.Path(a[-1])
digest = hashlib.sha256(src.read_bytes()).digest()
blob = bytearray((digest * 174770)[:5592560]); blob[84:88] = b'DXT5'
(out / (src.stem + '.dds')).write_bytes(bytes(blob))
log = os.environ.get('COOK_TEST_LOG')
if log: open(log, 'a').write(src.name + ' ' + digest.hex()[:16] + '\\n')
''', encoding='utf8')

IDENTITY = {'texconv': {'name': 'fake-texconv', 'size': 1, 'sha256': '0' * 64, 'banner': 'fake v1', 'flags': list(cook.FLAGS)},
            'pillow': 'test', 'numpy': 'test', 'python': 'test', 'recipe': cook.RECIPE}
cook.texconv_cmd = lambda f, stage: [sys.executable, str(SHIM), '-o', str(stage), str(f)]
cook.tools = lambda: json.loads(json.dumps(IDENTITY))
calls = lambda: [l for l in LOG.read_text().splitlines() if l] if LOG.exists() else []

# ------------------------------------------------------------------ fixtures
import io
def enc(im):
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()

def img(seed, mode='RGB'):
    y, x = np.mgrid[0:2048, 0:2048]
    if mode == 'I':
        return Image.fromarray(((x * 3 + y * 5 + seed * 11) % 65536).astype('uint16'))
    if mode == 'L':
        return Image.fromarray(((x * 3 + y * 5 + seed * 11) % 256).astype('uint8'), 'L')
    return Image.fromarray(np.dstack([((x + seed * 7) % 256), ((y + seed * 13) % 256), ((x + y + seed * 29) % 256)]).astype('uint8'), 'RGB')

def put(asset, field, seed, mode='RGB', kind='png'):
    """Write bytes into the private pinned cache and return the lock() pin for them."""
    data = enc(img(seed, mode))
    path = CACHE / (hashlib.md5(data).hexdigest() + '.' + kind)
    path.write_bytes(data)
    return {'url': f'https://dl.polyhaven.org/file/ph-assets/Textures/{kind}/2k/{asset}/{field}_2k.{kind}',
            'size': len(data), 'md5': path.stem, 'sha256': hashlib.sha256(data).hexdigest()}

def asset_rows(asset, seeds, wide_height=False):
    return {'page': 'https://polyhaven.com/a/' + asset, 'license': 'https://polyhaven.com/license',
            'api': 'https://api.polyhaven.com/files/' + asset, 'authors': ['a'], 'dimensionsMm': [],
            'inputs': {'color': put(asset, 'diffuse', seeds[0], 'RGB', 'jpg'),
                       'normal': put(asset, 'nor_gl', seeds[1]),
                       'roughness': put(asset, 'rough', seeds[2], 'L'),
                       'height': put(asset, 'displacement', seeds[3], 'I' if wide_height else 'L')}}

ROWS = {'alpha_rock': asset_rows('alpha_rock', (1, 2, 3, 4), wide_height=True),
        'beta_sand': asset_rows('beta_sand', (5, 6, 7, 8)),
        'gamma_dust': asset_rows('gamma_dust', (9, 10, 11, 12))}
FAMILIES = [{'asset': 'alpha_rock', 'id': 'alpha', 'role': 'rock', 'tileMeters': 2, 'levelTangent': True},
            {'asset': 'beta_sand', 'id': 'beta', 'role': 'sand', 'tileMeters': 1.5},
            {'asset': 'gamma_dust', 'id': 'reused', 'role': 'sand', 'tileMeters': 3, 'reuse': 'donor-pack'},
            {'asset': 'gamma_dust', 'id': 'reused-two', 'role': 'rock', 'tileMeters': 3, 'reuse': 'donor-pack-two'}]
PACK = 'test-pack'

def donor(name, asset, seed):
    d = ART / name
    d.mkdir(parents=True, exist_ok=True)
    rows = []
    for i, rid in enumerate(('reused', 'reused-two')):
        row = {'pack': name, 'id': rid, 'asset': asset, 'role': 'sand', 'tileMeters': 3}
        for k in ('color', 'surface'):
            f = d / f'{rid}-{k}.dds'
            f.write_bytes(bytes([seed, i, k == 'surface']) + bytes(60000))
            row[k + 'Hash'] = hashlib.sha256(f.read_bytes()).hexdigest()
        rows.append(row)
    (d / 'materials.json').write_text(json.dumps(rows), encoding='utf8')

def reset():
    for d in (ART / PACK, REC):
        shutil.rmtree(d, ignore_errors=True)
    donor('donor-pack', 'gamma_dust', 1)
    other = ART / 'donor-pack-two'
    shutil.rmtree(other, ignore_errors=True)
    donor('donor-pack-two', 'gamma_dust', 2)
    (ART / PACK).mkdir(parents=True, exist_ok=True)
    (ART / PACK / 'sources.json').write_text(json.dumps(ROWS), encoding='utf8')

def review(families=None, tile=None):
    fams = json.loads(json.dumps(families or FAMILIES))
    if tile: fams[0]['tileMeters'] = tile
    return {'pack': PACK, 'families': fams}

def run(rev=None, rows=None, force=False, label=''):
    LOG.write_text('', encoding='utf8')
    t = 0
    out = ART / PACK
    cook.cook(rev or review(), rows or ROWS, out, force, ART, REC)
    return calls()

def dds(name, k=None):
    return (ART / PACK / f'{name}-{k}.dds') if k else ART / PACK / f'{name}.dds'

hashof = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
STATE = lambda: {f.name: hashof(f) for f in sorted((ART / PACK).glob('*.dds'))}
OK, FAIL = [], []
def check(name, cond, detail=''):
    (OK if cond else FAIL).append(name)
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else '  <- ' + str(detail)))

# --------------------------------------------------------------------- tests
reset(); c = run(force=True, label='full')
check('full baseline cooks every owned DDS', len(c) == 4 and len(STATE()) == 4, (len(c), STATE()))
check('full baseline writes no manifest or receipt into the pack', sorted(p.name for p in (ART / PACK).iterdir()) == ['alpha-color.dds', 'alpha-surface.dds', 'beta-color.dds', 'beta-surface.dds', 'materials.json', 'sources.json'], sorted(p.name for p in (ART / PACK).iterdir()))
check('reuse families leave no receipt and no output', not (REC / PACK / 'reused-color.json').exists())
mats = json.loads((ART / PACK / 'materials.json').read_text())
check('manifest hashes match the bytes on disk', all(r[k + 'Hash'] == hashof(dds(r['id'], k)) for r in mats for k in ('color', 'surface')))
check('manifest order and fields preserved', [r['id'] for r in mats] == ['alpha', 'beta'] and mats[0]['tileMeters'] == 2)

base = STATE(); mtimes = {f.name: f.stat().st_mtime_ns for f in (ART / PACK).glob('*.dds')}
c = run()
check('unchanged recook runs texconv zero times', c == [], c)
check('unchanged recook keeps every byte and mtime', STATE() == base and {f.name: f.stat().st_mtime_ns for f in (ART / PACK).glob('*.dds')} == mtimes)

c = run(review(tile=2.75))
check('metadata-only change runs texconv zero times', c == [], c)
check('metadata-only change updates the manifest only', STATE() == base and json.loads((ART / PACK / 'materials.json').read_text())[0]['tileMeters'] == 2.75)
c = run()
check('metadata revert restores the manifest without cooking', c == [] and json.loads((ART / PACK / 'materials.json').read_text())[0]['tileMeters'] == 2)

c = run(force=True); check('--force recooks the full baseline', len(c) == 4, c)
c = run(); check('--force leaves a reusable receipt set', c == [], c)

rows = json.loads(json.dumps(ROWS))                    # one locked input changes (beta colour bytes + pins)
rows['beta_sand']['inputs']['color'] = put('beta_sand', 'diffuse', 99, 'RGB', 'jpg')
c = run(rows=rows)
check('one changed locked input recooks only that colour DDS', len(c) == 1 and c[0].startswith('beta-color.png') and STATE()['alpha-color.dds'] == base['alpha-color.dds'], c)
check('the changed colour DDS really changed', STATE()['beta-color.dds'] != base['beta-color.dds'])
c = run(rows=ROWS)
check('reverting the input restores the original bytes with one cook', len(c) == 1 and STATE() == base, c)

bad = dds('beta', 'surface'); b = bytearray(bad.read_bytes()); b[1000] ^= 0xff; bad.write_bytes(bytes(b))
c = run()
check('a corrupt output recooks only itself', len(c) == 1 and c[0].startswith('beta-surface.png'), c)
check('the corrupt output is repaired to the pristine bytes', STATE() == base)

(REC / PACK / 'alpha-color.json').unlink()
c = run()
check('a missing receipt recooks only that output', len(c) == 1 and c[0].startswith('alpha-color.png'), c)
(REC / PACK / 'alpha-surface.json').unlink()
c = run()
check('a pruned receipt set is rebuilt one output at a time', len(c) == 1 and c[0].startswith('alpha-surface.png'), c)
check('receipt rebuild keeps bytes identical', STATE() == base)

fam = json.loads(json.dumps(FAMILIES)); fam[0]['levelTangent'] = False
c = run(review(fam))
check('levelTangent flip recooks only the surface', len(c) == 1 and c[0].startswith('alpha-surface.png') and STATE()['alpha-color.dds'] == base['alpha-color.dds'], c)
flipped = STATE()
c = run(review())
check('levelTangent revert restores the pristine surface', len(c) == 1 and STATE() == base, c)

IDENTITY['texconv']['banner'] = 'fake v2'
c = run()
check('a texconv identity change recooks every owned DDS', len(c) == 4, c)
IDENTITY['texconv']['banner'] = 'fake v1'
c = run(); check('restoring the tool identity recooks against the new receipts', len(c) == 4, c)
check('the rebuilt identity receipt set is reusable', run() == [])
IDENTITY['recipe'] = 'test-recipe/2'
c = run(); check('a recipe bump recooks every owned DDS', len(c) == 4, c)
IDENTITY['recipe'] = cook.RECIPE
c = run(); check('the recipe key is honoured both ways', len(c) == 4 and run() == [], c)

before = STATE(); mtext = (ART / PACK / 'materials.json').read_text()
bad_rows = json.loads(json.dumps(ROWS)); bad_rows['alpha_rock']['inputs']['normal']['sha256'] = '0' * 64
fam = [FAMILIES[1], FAMILIES[0]]                    # a healthy family is staged first, then the broken one
raised = None
try: run(review(fam), rows=bad_rows, force=True)
except Exception as e: raised = e
check('a changed pinned input aborts the cook', raised is not None and 'Changed Poly Haven bytes' in str(raised), raised)
check('a failed cook publishes nothing', STATE() == before and (ART / PACK / 'materials.json').read_text() == mtext)
check('a failed cook leaves no partial files', not list((ART / PACK).glob('*.part')) and not list(ART.glob('**/*.part')))

don = ART / 'donor-pack-two' / 'reused-two-surface.dds'; keep = don.read_bytes()
don.write_bytes(keep[:-1] + bytes([keep[-1] ^ 0xff]))
before = STATE()
raised = None
try: run(review([FAMILIES[1], FAMILIES[0], FAMILIES[3]]), force=True)
except Exception as e: raised = e
check('a tampered donor is caught for its own reuse family', raised is not None and 'Changed reusable reused-two' in str(raised), raised)
check('a donor failure publishes nothing', STATE() == before)
don.write_bytes(keep)
raised = None
try: run(review([FAMILIES[1], FAMILIES[2], FAMILIES[3]]))
except Exception as e: raised = e
check('intact donors reuse cleanly with zero texconv calls', raised is None, raised)

out = ART / PACK / 'alpha-surface.dds'
c = run(review([FAMILIES[0], FAMILIES[1]]))
check('cross-donor families do not share a receipt', sorted(p.name for p in (REC / PACK).glob('*.json')) == ['alpha-color.json', 'alpha-surface.json', 'beta-color.json', 'beta-surface.json'], sorted(p.name for p in (REC / PACK).glob('*.json')))

shutil.rmtree(WORK, ignore_errors=True)
print(f'\n{len(OK)} passed, {len(FAIL)} failed{(": " + ", ".join(FAIL)) if FAIL else ""}')
sys.exit(1 if FAIL else 0)
