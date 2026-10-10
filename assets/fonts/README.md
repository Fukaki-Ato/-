# Runtime Fonts

The four atlas files in this directory are runtime inputs for the custom UI:

- `latin.png` and `latin.metrics.json`
- `cjk.png` and `cjk.metrics.json`

They are copied to both Web and WX build outputs. `charset.txt` records the characters covered by the current atlases.

## Rebuilding

Full rebuild scans repo text (`packages/game/src`, `apps/web/src`, `config/*.json`) into `charset.txt` and regenerates the CJK atlas:

    cd tools/fontgen && npm ci
    node charset.mjs && node gen.mjs --preset cjk

The CJK atlas requires a system CJK font (candidates in `tools/fontgen/fonts.mjs`: Microsoft YaHei / SimHei on Windows).

When the build environment has no such font but new text already landed, `tools/fontgen/supplement.mjs` appends only the missing glyphs from a supplied font (`--font <ttf|ttc> [--face N] [--label ...]`), marks them `fallbackFont` in the metrics, and leaves every existing glyph byte-identical. A later full rebuild supersedes the supplement.

The original generator and its system-font dependencies were intentionally not migrated. Do not claim these assets are licensed for release without replacing them with assets generated from an appropriate redistributable font.
