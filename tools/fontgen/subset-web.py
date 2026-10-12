"""Optional native Web font subset. Requires FontTools with WOFF2/Brotli support."""
import argparse
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--font", required=True, help="Redistributable Noto Sans SC variable TTF")
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
characters = set((root / "assets/fonts/charset.txt").read_text(encoding="utf-8"))
for directory in ("apps/web/src", "packages/game/src", "config"):
    for path in (root / directory).rglob("*"):
        if path.suffix in (".ts", ".css", ".json"):
            characters.update(path.read_text(encoding="utf-8"))
characters.update("‹›→⚙♥♡◇✦≋⚑ϟ✓")
font = TTFont(args.font)
if "fvar" not in font or not any(axis.axisTag == "wght" for axis in font["fvar"].axes):
    raise ValueError("Provide a variable font with a weight axis (100–900)")
options = subset.Options()
options.flavor = "woff2"
options.layout_features = ["*"]
options.name_IDs = ["*"]
options.name_languages = ["*"]
subsetter = subset.Subsetter(options=options)
subsetter.populate(text="".join(sorted(characters)))
subsetter.subset(font)
font.flavor = "woff2"
output = root / "apps/web/src/assets/mobile-ui/thunder-sans.woff2"
font.save(output)
print(f"Wrote {output.relative_to(root)}: {output.stat().st_size} bytes, {len(characters)} requested characters")
