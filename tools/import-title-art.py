"""Prepare the title's reviewed local screenshots. Usage: python tools/import-title-art.py FOLDER (requires Pillow)."""
from pathlib import Path
import hashlib
import os
import sys
from PIL import Image

# Lobby art is decorative; no claim that a particular tactical map has loaded.
SHOTS = {
    'rendezvous': ('20260322155057_1.jpg', '67295672d1a5b9a0f354f0aca3656f83ae9752ec40ade6840ac62621cc76eca3'),
    'solo-command': ('20230814195907_1.jpg', '8a06c453b60f5013e009a45d4bc84879e150ef894d3918fdde50adb6f50ad9a1'),
    'fleet-command': ('20230920210906_1.jpg', '292825c5c53f912224c587184dbb978a0023fc94ac960110cb374f89b1b1f403'),
    'conquest': ('20261116213644_1.jpg', '0e44584d936fb3009fda1284dbeabaad2a3094bdde2ea9bf7ca50a591387ee7f'),
    'story': ('20230305155117_1.jpg', '9ac7d4dc6b803a4c2d95e6aa4bd105896b084ffc721a4482c101f3dd6b3a55e0'),
    'skirmish': ('20230815181715_1.jpg', '3e692d771d592b6576e1624ae0a1938f189694292477257793efce7be6d5741d'),
    'instant': ('20221229140552_1.jpg', '57afd607446d46428cec1ec8312e8e5d027aa746951022a1ed12d1daf65b0c0e'),
    'tutorial': ('20221118164336_1.jpg', '03205d7c6cf97011d8848fff56a45539822baee084bc9ac4e766f229c69d3c8b'),
    'resume': ('20240930003001_1.jpg', '726247a6c7818089fa505bdb46fef92a11257b5a5ff06e0b5285245e28e4490f'),
    'archive': ('20231212183837_1.jpg', '950b9d1f39a49fd63b3ef6a5e5e4f22de7c6c1ae30eb1cadc144f0f8db315d16'),
    'internet': ('20241029233937_1.jpg', '0eefa60663f3cc19882758773e23287459e7577c61465e06f1e4289de385a9f1'),
    'lan': ('20221211213511_1.jpg', 'ab205fe9e734c7cd69cb9936bde071562253bdb1b95cfbef53997c964cee0bb1'),
    'network': ('20230312213504_1.jpg', '27c47fb6b221458275ece5b86e60b9fd60fbf43ea81ed555649691c04278470e'),
}
if __name__ == '__main__':
    src = Path(sys.argv[1]); dst = Path(os.environ.get('SWR_TITLE_ART') or Path(os.environ['LOCALAPPDATA']) / 'EaWBrowserWorkshop' / 'title-art')
    dst.mkdir(parents=True, exist_ok=True)
    for key, (name, digest) in SHOTS.items():
        p = src / name
        if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != digest:
            print(f'Skipped {key}: reviewed image unavailable'); continue
        with Image.open(p) as im:
            im.thumbnail((1920, 1440) if key == 'rendezvous' else (1040, 650), Image.Resampling.LANCZOS)
            im.convert('RGB').save(dst / (key + '.jpg'), quality=86, optimize=True)
            print(key, im.size)
