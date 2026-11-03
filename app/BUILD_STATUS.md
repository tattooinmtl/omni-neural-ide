# OMNI-CODE rebuild — honest status (no mockup covers)

## Ban check
`scripts/check-no-mockup-assets.sh` → **OK** (no mockup jpg/png/crops referenced in UI source or dist).

## Visual metrics (real HTML/CSS/SVG/Monaco render vs mockups @ 1168×784)
Measured mean absolute RGB (mockup JPG decoded → RGB vs PNG screenshot):

| Layout | mean | title | activity | side | editor | chat | status |
|--------|------|-------|----------|------|--------|------|--------|
| Plain  | ~16.5 | ~6.2 | ~10.7 | ~27.6 | ~12.2 | ~20.9 | ~11.5 |
| Ultra  | ~16.4 | ~13.6 | ~10.3 | ~16.7 | ~15.1 | ~21.5 | ~6.8 |

Target &lt; 6 **not met**. Residual driven by font rasterization, Monaco vs design-tool text, SVG icon shapes vs mock glyphs, and JPEG mockup compression. No mockup pixels are used as UI assets.

Shots: `shots/omni-plain.png`, `shots/omni-ultra.png`  
Heatmaps: `shots/heat-plain.png`, `shots/heat-ultra.png`  
Compare: `shots/compare-plain.png`, `shots/compare-ultra.png`

## Demo mode (honest)
Real folders `fixtures/OMNI-CODE` and `fixtures/OMNI-APP` opened via `/api/fs/open`.  
Chat from `fixtures/chat/{plain,ultra}.json` loaded through `ChatPanel.loadFixture()`.

## Windows native window
`omni-core.exe` built with **wry 0.47 + tao 0.30** (`native-window` default feature) for `x86_64-pc-windows-gnullvm`. Compiles successfully; opens its own WebView2 window (not Edge `--app=`). Launcher no longer opens a browser.

## Artifacts
- `dist/omni-code-windows-x86_64.zip`
- `dist/launcher.exe`, `dist/omni-core.exe`
- Local git: `/workspace/omni-neural-ide-rebuild` branch `rebuild`
