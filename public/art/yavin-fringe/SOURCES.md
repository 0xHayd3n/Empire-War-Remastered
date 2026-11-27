# Yavin exterior canopy

`jacaranda-horizon.png` is an offline derivative of the same [Poly Haven Jacaranda](https://polyhaven.com/a/jacaranda_tree) crown as the playable canopy. See [the jungle source ledger](../yavin-jungle/SOURCES.md) and its `sources.json` for the actual asset, author, CC0 licence, upstream mesh and texture pins. No reference stills or installed game art are included here.

`python tools/cook-yavin-fringe.py` composites the four authenticated depth slices per projection back to front, downsamples with an alpha gutter and bleeds transparent RGB. Two upright projections and one overhead projection of this tree share a 768×256 atlas. Used only on procedural, unsimulated exterior stands. The draw uses the original forest's lighting and scale, not a photo backdrop. Input SHA-256 `7805b6a8d78db836e44b91f951fcae9f4de680ef125cacd6b158565bfd97a641`; cooked SHA-256 `4601ae8458c31c7316e0ccb442fcdb763518d394e47760c57119bdee470adc18`.
