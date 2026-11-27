# Endor trail: Forest Ground 04

The full landscape uses [Forest Ground 04](https://polyhaven.com/a/forest_ground_04), by Rob Tuytel and Rico Cilliers, [CC0](https://polyhaven.com/license). The earlier Dirt Floor donor was gravelly but its grooves formed conspicuous parallel rows down Endor's trails. This scan has a less directional mix of packed brown earth, small stones and dry woodland debris. Its tile is 3.15 m across, not the previous scan's 2.1 m. No hue grade or reference-image pixels are used.

See the [4K pair's source pins and channel conventions](../forest-ground-04/README.md). `node tools/cook-endor-trail.mjs` checks both 4K hashes, then copies the native 2K-through-1 BC3 levels byte-for-byte into the full-landscape library; normal, roughness, displacement and albedo retain registration. It does not change the 4K bare-earth mode. Output is 5,592,560 bytes per DDS:

- `soil-color.dds` `4ef432a1b64dcc0b044337a21f9945e6c59f746ae5dd43b082e2fc893f83cc7d`
- `soil-surface.dds` `07a84d9d1de135b53325691f5bf9b53e0d18c7218831ea7ff24a8e5df347c3c9`
