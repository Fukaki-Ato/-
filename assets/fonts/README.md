# Runtime Fonts

The four atlas files at this directory's root are the retained legacy Web inputs:

- `latin.png` and `latin.metrics.json`
- `cjk.png` and `cjk.metrics.json`

WX now uses the separately rebuilt, licensed [noto/](noto/README.md) pair, with its OFL notice and provenance;
the legacy root pair is no longer copied into WX. `charset.txt` is the scanned target character set;
the actual coverage is `glyphs` / `missing` in each metrics file.

## Rebuilding

Full rebuild scans repo text (`packages/game/src`, `apps/web/src`, `apps/wx/src`, `config/*.json`) into `charset.txt` and regenerates the CJK atlas. From the repository root:

    npm ci --prefix tools/fontgen
    node tools/fontgen/charset.mjs
    node tools/fontgen/gen.mjs --preset cjk --font /path/to/licensed-font.ttf

After rebuilding or supplementing, keep both atlas dimensions at most 4096px for mobile GPU compatibility. Repack existing glyphs without a system font or any pixel changes (run from the repository root):

    node tools/fontgen/repack.mjs assets/fonts/cjk 2048

This preserves all glyph bitmap bytes and font metrics, updating only atlas dimensions, cell positions and normalized UVs. The repacker rejects output that exceeds 4096px.

Supply a parseable font with the required CJK glyphs. Windows may omit `--font` to probe
Microsoft YaHei / SimHei candidates in `tools/fontgen/fonts.mjs`; Linux/macOS must supply a
font explicitly. Review `missing` and font provenance before committing. Only identical
font, fallback and options guarantee identical output; a different font can change the whole atlas.

When the build environment has no such font but new text already landed, `tools/fontgen/supplement.mjs` appends only the missing glyphs from a supplied font (`--font <ttf|ttc> [--face N] [--label ...]`), marks them `fallbackFont` in the metrics, and leaves every existing glyph byte-identical. A later full rebuild supersedes the supplement.

The generator is in `tools/fontgen`; its dependencies install separately, and source system fonts
are not bundled. Do not claim these assets are licensed for release without confirming provenance
or replacing them with assets generated from an appropriate redistributable font.

## 2026-11-06 WX welfare supplement

Added 36 missing glyphs, including `俱旅匙`, from **Noto Sans CJK SC Regular**
(`NotoSansCJKsc-Regular.otf`, © 2014–2021 Adobe), under SIL OFL 1.1.
The matching copyright and license are retained in [NotoSansSC-OFL.txt](NotoSansSC-OFL.txt)
and copied with the WX runtime font assets.

Source: <https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf>.
Generation used `supplement.mjs --label "Noto Sans CJK SC (SIL OFL 1.1)"` after scanning the charset.
Existing atlas pixels, glyph cell positions and advances were checked unchanged.
The broad source scan also contains `ϟ⁻⚑✦`, which this font does not supply;
they remain listed in `supplement.skipped`. Actual welfare/handbook UI copy is
checked separately. This supplement does not settle the provenance of older glyphs.

The following commerce slice additionally supplied `募` from the same licensed
font; original pixels were checked unchanged again. Commerce literal copy has its
own glyph-coverage test.

## 2026-11-07 WX licensed replacement

`tools/fontgen/licensed.mjs` generates the two WX atlases from the pinned public Noto source plus six original
geometric marks. Its explicit input and no system-font fallback avoid inheriting the unconfirmed legacy
Microsoft/Segoe inputs. Root atlases and prior supplements remain unchanged for historical Web use.
See `noto/README.md`; only the new pair/OFL/provenance is shipped by the WX build.

## Web DOM supplement after collaborator integration

The retained variable `thunder-sans.woff2` subset lacks characters in the new scene names
(for example `昏渔港`), which can disappear on hosts without a system CJK font.
`apps/web/src/assets/mobile-ui/cjk-supplement.otf` supplies only missing supported codepoints
from the same pinned Noto CJK OFL source, under the new family name `Thunder CJK Supplement`.
The original variable font and its weight choices remain first in the CSS stack.

Rebuild to a fresh output file (requires the optional fontgen dependencies and `fc-query`):

    node tools/fontgen/supplement-web.mjs --font <documented-Noto.otf> --out <new-file.otf>

Source SHA and copyright/OFL match `noto/provenance.json`; the license is retained at
`assets/fonts/noto/NotoSansSC-OFL.txt` and remains in the Web asset tree.

## 2026-11-13 Web/WX integration

The root CJK atlas retains all 1,891 glyphs from the Web scene branch and all 25
additional glyphs from the WX welfare/commerce branch, without changing their bitmap
bytes, advances or bearings. Eight additional scanned characters were supplied from
the same pinned Noto OFL source. Repacking changes only atlas placement and UVs.
The merged atlas has 1,925 entries at 2048×2654; `missing` is empty.

`charset.txt` is the sorted union of both branch charsets and the merged source scan;
conflict-marker lines are excluded. The runtime atlas additionally retains historical
glyphs not present in that scan. Both root and WX atlases represent U+FE0F (variation
selector-16, present in source-comment `⚠️`) as an empty, zero-advance entry. It is a
formatting selector, not a visible font outline; `⚠` keeps its normal glyph.

WX was rebuilt independently from the pinned OFL source and the six original marks.
It preserves the combined character coverage (including theme, volume and version
copy), without using legacy glyph pixels or outlines. Its CJK atlas is 2048×2404;
the shared dimension limit is now 4096px, not the earlier 2048px corpus limit.
See [noto/README.md](noto/README.md) for the reproducible merged-corpus rebuild.
