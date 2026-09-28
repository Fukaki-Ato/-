# Runtime Fonts

The four atlas files in this directory are runtime inputs for the custom UI:

- `latin.png` and `latin.metrics.json`
- `cjk.png` and `cjk.metrics.json`

They are copied to both Web and WX build outputs. `charset.txt` records the characters covered by the current atlases.

The original generator and its system-font dependencies were intentionally not migrated. Do not claim these assets are licensed for release without replacing them with assets generated from an appropriate redistributable font.
