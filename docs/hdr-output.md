# HDR in Universal

In the mounted [Universal window](http://127.0.0.1:8590/), open **System menu → Settings → Video → HDR** and choose **Auto · HDR**. Enable HDR for the display in your OS first. **Off · SDR** is the default. These settings live in the mounted profile’s graphics preferences, not in a campaign save. Changing display, mode or calibration does not require reloading a battle.

- **Paper white** sets the brightness of an ordinary white surface. Use the middle patch to choose a comfortable level; start at 203 nits.
- **Peak brightness** is the target for the brightest highlights (default 1,000 nits). Start with the display’s HDR rating. In the right-hand patches the two levels should remain distinct.
- **Shadow detail** adjusts the darkest tones without changing absolute black or paper white. Use the three dark patches on the left; start at 0. **Reset calibration** restores all three defaults without turning HDR off.

The reference strip is a real HDR canvas. It appears only on a compatible path, not as a simulated brightness filter. If the window doesn’t report HDR, you can save settings for later, but gameplay remains SDR. Browser and OS compositing, the OS SDR white-level setting and the panel ultimately determine physical brightness; the nits controls are reference targets, not measurements.

## Rendering path

Main-thread WebGPU gameplay uses RGBA16F colour buffers through scene, bloom and optional lens grading. Heat distortion is displacement data and stays 8-bit. The last pass maps the game’s display-referred colour into extended sRGB with a soft highlight shoulder. The canvas must report `format: 'rgba16float'` and `toneMapping.mode: 'extended'` after configuration. An ignored or rejected extended configuration uses the original SDR canvas. Ordinary SDR rendering needs no extra colour target or presentation pass. DOM menus, video and overlays are not regraded. General → Gamma is an SDR control. WebGL, the optional offscreen land render worker and menu thumbnails remain SDR.

Optional [Linear battle lighting](linear-battle-lighting.md) also uses half-float targets on SDR displays. It combines space-scene light and bloom in linear RGB, then feeds the selected output presenter. It does not enable display HDR or grade the HUD.

## Checking output and capturing a comparison

From the Universal checkout, with the host running, Chrome and `playwright-core` available:

```
node tools/check-universal-hdr.cjs
python tools/export-hdr-capture.py
```

The mounted-window test opens the real Settings page at desktop and phone widths, then launches a stock space Instant Battle at Abregado-rae. It freezes one camera and scene, reads both swap chains, checks for values above SDR white, checks that all three calibration controls affect real pixels, and verifies that switching back to SDR restores the original bytes. On a machine without HDR it emulates **only** the display capability signal; adapter, texture formats, shaders and readbacks are real. That verifies the renderer, not physical HDR scan-out. To check a monitor, use the real calibration strip on that display without emulation.

The exporter (Python, NumPy, Pillow) writes local gameplay stills under `tools/baselines/hdr/` by default: `sdr.png`, `hdr-preview.png` (tone-mapped for SDR), and `hdr-pq.png` (16-bit BT.2020/PQ PNG with cICP metadata for HDR-aware viewers). The SDR proof rolls off bright values to fit a normal screen; it cannot reproduce the brightness of a display with HDR headroom. Generated gameplay images stay out of the repository.
