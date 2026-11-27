# Endor terrain: sources and cook

The current grass donor is **[ambientCG Ground 037](GRASS.md)** and the trail donor is **[Poly Haven Forest Ground 04](TRAIL.md)**. The other six natural families use Poly Haven scans. The original seven-scan pilot, documented below for comparison, was cooked by `tools/cook-endor-terrain.mjs` into 2048² BC3/DXT5 DDS pairs with full mip chains (2048 → 1, 12 levels). No tint, no upscale, no third-party art: every pixel comes from the first-party 2k Poly Haven PNGs pinned below.

## Packing

- `<id>-color.dds`: RGB = albedo stored sRGB (mip filtering done in linear light); A = height from `disp`, normalised over that tile's own min/max (0 = deepest, 1 = highest).
- `<id>-surface.dds`: RGB = tangent normal from `nor_gl` with G flipped for top-down DDS rows (stored n*0.5+0.5, renormalised after each mip); A = roughness from `rough`, linear.
- Every file is 2048x2048 DXT5 with 12 mips; same sources + same script = same sha256.

## Reproduce

```
node tools/cook-endor-terrain.mjs
node tools/cook-endor-terrain.mjs --verify
```

Sources are streamed into the OS temp dir one family at a time and deleted as soon as they are decoded; the repo keeps only the DDS files, `materials.json` and this page.

## License

All Poly Haven assets are CC0 (public domain): https://polyhaven.com/license.

## Source files

### Superseded grass donor — Leafy Grass (not shipped in the current atlas)

- Asset: `leafy_grass` (https://polyhaven.com/a/leafy_grass), author Charlotte Baglioni, CC0
- Scanned size, used as `tileMeters`: 2 m (Poly Haven asset info)
- Source displacement range: 0.04239–0.93848, normalised to 0–1 in the colour alpha
- Mean tangent normal after G flip: -0.00108, -0.00038, 0.82211

| map | 2k PNG | bytes | md5 | sha256 |
| --- | --- | --- | --- | --- |
| diffuse | `leafy_grass_diff_2k.png` | 23606854 | `91c82271318a5bbe69182404c6dff730` | `9ae7994a36a7aedf5fe65dac49d5e096e9a8ff1d8a8e8ccb28df0c9c3a7a2d34` |
| nor_gl | `leafy_grass_nor_gl_2k.png` | 24430051 | `99b68312712462595976eb2baef58c6b` | `476a34f2f60186f51644c3b9560d7659531a033f993b01f274f939e447f3de25` |
| rough | `leafy_grass_rough_2k.png` | 9963345 | `fbdf75ebded5133626f67a30277a3efd` | `71d2c187fd8cb7182c8877710431af23257904fb167c38218ed0abf21c2e73b6` |
| disp | `leafy_grass_disp_2k.png` | 7311977 | `540555d31b8bf2d674b818a7e2e61125` | `506ed7d425d9a73f6881e17f03e2a0d2fa57893bb0555a4b86ad905d2cabe510` |

Historical outputs (not shipped; see [GRASS.md](GRASS.md) for the current Ground 037 pair): `grass-color.dds` 5592560 B sha256 `4327676307ecc8f195f3b600054899aebfa7704ad8c9dd266427dacbdeddae41`; `grass-surface.dds` 5592560 B sha256 `9587cc456c02934f96c44352d0f2a5ddd02357fba27405f07252126982761e94`.

### moss — Forest Leaves 02 (mossy forest floor)

- Asset: `forest_leaves_02` (https://polyhaven.com/a/forest_leaves_02), author Rob Tuytel, CC0
- Scanned size, used as `tileMeters`: 3 m (Poly Haven asset info)
- Source displacement range: 0.00143–0.99829, normalised to 0–1 in the colour alpha
- Mean tangent normal after G flip: 0.01127, -0.01275, 0.77764

| map | 2k PNG | bytes | md5 | sha256 |
| --- | --- | --- | --- | --- |
| diffuse | `forest_leaves_02_diffuse_2k.png` | 9748582 | `142798abe47028a0c7c8ed35ae53140d` | `5f572a23d6e4a7c7ea132272945f7dabb301101641083f9f490e89b1f65be4e7` |
| nor_gl | `forest_leaves_02_nor_gl_2k.png` | 10708761 | `cce2a8fd9454483a17f65b3cfc832725` | `b352e89611239796aa307afd3d34a83aca77b8e2a98244e3458ec3fa5b635af2` |
| rough | `forest_leaves_02_rough_2k.png` | 2523903 | `b54fead1218286015ac1f770c09efd22` | `88d0ae62b0ee124a183fcefece544f021125da709ead233717326bcb0d4baebd` |
| disp | `forest_leaves_02_disp_2k.png` | 6503840 | `f208c441c521b69c87d661c19dcfb578` | `97a110abde191c2cf1dd30cf93c169c9e4395792568a4a7dd3757571f5a704bd` |

Outputs: `moss-color.dds` 5592560 B sha256 `2753733edd99b2962fb81830cd27350676126422e46128b9cdcd2e9053c52546`; `moss-surface.dds` 5592560 B sha256 `9e0c763160121f2f956ac07fc581f636ae32e330334b9438c94ca2eb479bd614`.

### litter — Forest Leaves 04

- Asset: `forest_leaves_04` (https://polyhaven.com/a/forest_leaves_04), author Rob Tuytel, CC0
- Scanned size, used as `tileMeters`: 1.5 m (Poly Haven asset info)
- Source displacement range: 0.00397–0.99649, normalised to 0–1 in the colour alpha
- Mean tangent normal after G flip: -0.01111, 0.03059, 0.77915

| map | 2k PNG | bytes | md5 | sha256 |
| --- | --- | --- | --- | --- |
| diffuse | `forest_leaves_04_diff_2k.png` | 23631474 | `8e8bb44c218cf80224c90fd19eb21e12` | `9ecd60bb97fa26139de6729b4baa817672acdee34f1853618c8930dde7833da7` |
| nor_gl | `forest_leaves_04_nor_gl_2k.png` | 24187753 | `b218e95118db6c855144da3702653032` | `4bdcfe8df17aba2bca329cb2d785a7ee36f0aa7bebbbd29f29ebfdc36a47c093` |
| rough | `forest_leaves_04_rough_2k.png` | 7773515 | `86ce81fd592f04291f61ee29d8de73c6` | `9c38cdaa2f8cb926773ac4c2e306e14351373a8e4b551caf116c996ca5d4397e` |
| disp | `forest_leaves_04_disp_2k.png` | 6671341 | `4d36f558b5fcdc64e488b558ffc38309` | `c12974df23b6437bad50640e094f0b490e7528de9b77a8fefc0f50f24e46ecf6` |

Outputs: `litter-color.dds` 5592560 B sha256 `1d990abf46cec2d93e7d23d0c6105041946b1033dbddbfe24b2d1678f37e1ba4`; `litter-surface.dds` 5592560 B sha256 `aaa3ec8726891f570889ce096cd72814fcdf3093f1593de58b47adf32f0f48f4`.

### Superseded soil donor — Dirt Floor (not shipped in the current atlas)

- Asset: `dirt_floor` (https://polyhaven.com/a/dirt_floor), author eye-candy.xyz, CC0
- Scanned size, used as `tileMeters`: 2.1 m (Poly Haven asset info)
- Source displacement range: 0.0137–0.93869, normalised to 0–1 in the colour alpha
- Mean tangent normal after G flip: 0.0005, -0.00542, 0.94898

| map | 2k PNG | bytes | md5 | sha256 |
| --- | --- | --- | --- | --- |
| diffuse | `dirt_floor_diff_2k.png` | 23380529 | `5e18a380887dbd15bd5ab2d7217fa44b` | `850e0d11ba5d5a75382b63dc9dbbacc098be51a89f704c260df8cdf7539e4697` |
| nor_gl | `dirt_floor_nor_gl_2k.png` | 23607961 | `dee71ffbf1075a9194043ef57b463e3d` | `6bfd01a27abbab03c65afe55ca5ceaac78e94d052d8806549a35a17cb4541d72` |
| rough | `dirt_floor_rough_2k.png` | 9596025 | `a0c4ff6765fbf38ad53e640ffa63683c` | `164e8d7ad5219f613e2d93445c374dd2505836960b27d4b6ae1de873bb18b4c6` |
| disp | `dirt_floor_disp_2k.png` | 9345075 | `33bafd3095b4f8c7b1234d492d9a32d0` | `5896ea2600f95469a83dc4d9efd6a46c41b14ff06a1ab06fdcfb8fc570445ed5` |

Historical outputs (not shipped; see [TRAIL.md](TRAIL.md) for the current Forest Ground 04 pair): `soil-color.dds` 5592560 B sha256 `4af547d8cfd1c87f6060574d5c1c7cc876e2ea6668e0c04cb705fdb63cc26bc4`; `soil-surface.dds` 5592560 B sha256 `c2d5f309f26c7c77e9464a450bb60423c3352a9731f86182449eaafd4e9efda2`.

### mud — Brown Mud 02

- Asset: `brown_mud_02` (https://polyhaven.com/a/brown_mud_02), author Rob Tuytel, CC0
- Scanned size, used as `tileMeters`: 1.3 m (Poly Haven asset info)
- Source displacement range: 0.02353–1, normalised to 0–1 in the colour alpha
- Mean tangent normal after G flip: -0.00658, 0.00401, 0.85917

| map | 2k PNG | bytes | md5 | sha256 |
| --- | --- | --- | --- | --- |
| diffuse | `brown_mud_02_diff_2k.png` | 7351489 | `ef770d3bdde5f6356d2bb71f7f52fef7` | `a00bad20b2c339bd3d2837b8ae80903c4646876bb4ec0cc960846a97b2d3d737` |
| nor_gl | `brown_mud_02_nor_gl_2k.png` | 8869082 | `04c379fb559dc3920f0ecfa6ce1f3a2c` | `78e01270b222a96cc1433c8d4ba2b6fbbe24b296934b45d1ff6aa30cad647888` |
| rough | `brown_mud_02_rough_2k.png` | 2307264 | `e53629b9f9c912af86524fe20fc0c35a` | `c2c7835ff92171d9141dd7a1884dbf3a00b5d989fe8ae05737ac6d5397c12572` |
| disp | `brown_mud_02_disp_2k.png` | 1647509 | `424a01299369299091f1b8193191e58a` | `c4eae3aba4cb23e967eb3b2c3cbf4cd6dd82830906233dc76c4048884c5fd2d7` |

Outputs: `mud-color.dds` 5592560 B sha256 `510e7615a34f0a55de3fd8cdea47d3a3dc000050b5a9de648b8b15e85822c708`; `mud-surface.dds` 5592560 B sha256 `4de362e52fa3f995e06dcc196e2706150ad6adbd237868ca59585f7bad5bb397`.

### rock — Mossy Rock

- Asset: `mossy_rock` (https://polyhaven.com/a/mossy_rock), author Rob Tuytel, CC0
- Scanned size, used as `tileMeters`: 3 m (Poly Haven asset info)
- Source displacement range: 0.00574–0.99934, normalised to 0–1 in the colour alpha
- Mean tangent normal after G flip: 0.04234, -0.0391, 0.96054

| map | 2k PNG | bytes | md5 | sha256 |
| --- | --- | --- | --- | --- |
| diffuse | `mossy_rock_diff_2k.png` | 9204163 | `8df6ca9f9ca64ab7279c52618a5ebc04` | `7a5cf7886fb46f71ff76d822939b0eb4169f7d29ef504918fe7526f948511302` |
| nor_gl | `mossy_rock_nor_gl_2k.png` | 8716359 | `b5385cc9f6239f4720a43e0acbed6015` | `b72a20fb7101bd962150c1061cd1d798c2b2d77815092543593eb23d3f0f1735` |
| rough | `mossy_rock_rough_2k.png` | 3022971 | `97add42f4d4314103082668313420a1f` | `4a47fba6710e48e7ef2cfac2dd32e2e900e5d4bdf0c2b372b3d5d599831681c6` |
| disp | `mossy_rock_disp_2k.png` | 6906485 | `2ec6243afcf5345fd329ee7b3535fd1d` | `3ee19ec26fa8ecf27b1fc961902e0656321d37f3d66a5c4fd809303db858ff7c` |

Outputs: `rock-color.dds` 5592560 B sha256 `9491f14db13ab35408abca913b7c9e4e86cadcd7420f7268b9bd8ca1d67cd0c1`; `rock-surface.dds` 5592560 B sha256 `a46a44cee9198847222d1fd83adae6b7675d391d9c0eaf2596cfce6ba9be226a`.

### sand — Sand 01

- Asset: `sand_01` (https://polyhaven.com/a/sand_01), author Rob Tuytel, CC0
- Scanned size, used as `tileMeters`: 1.5 m (Poly Haven asset info)
- Source displacement range: 0.00014–1, normalised to 0–1 in the colour alpha
- Mean tangent normal after G flip: -0.11812, 0.11903, 0.9268

| map | 2k PNG | bytes | md5 | sha256 |
| --- | --- | --- | --- | --- |
| diffuse | `sand_01_diff_2k.png` | 25044514 | `80513d13769f0e50120c3deb07dd5ee4` | `03c77ce8780bb2265b27d266d8c613a8b91767bf27cbabc43412a7a9f516d5a3` |
| nor_gl | `sand_01_nor_gl_2k.png` | 21778772 | `b58a19090377dacf161a1c6b6dfc07d5` | `fc1d2f1af4c6166cbc0dc696999f7a92a207b8fbd22208fa384a6c03299b942f` |
| rough | `sand_01_rough_2k.png` | 6458668 | `f1fbebee2f060ff63ad170a227c10442` | `63f33004d2f0f411297d1b79af04dec537624726c53a4264ae2cd0db13f10225` |
| disp | `sand_01_disp_2k.png` | 7088526 | `b3405a4242951301a76de11359ea4f79` | `3a2cfb70b8e688f4b9d09b08684e94e4dfb5ad934d042c8d71879b8b612f3b7a` |

Outputs: `sand-color.dds` 5592560 B sha256 `78656a9eba925a31c4ddff68a0414c4ec48203308a0dcfec8c9becfa0d2bbc70`; `sand-surface.dds` 5592560 B sha256 `8c1bf1d1e6854152eccb95c23ba054a24a887b18177bcba12c92c4f139e04dd9`.
