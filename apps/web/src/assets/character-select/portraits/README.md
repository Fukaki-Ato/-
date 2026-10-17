# Selection-only portraits

These alpha WebP cutouts are used only by `selectCharacterArt.ts`. The approved lobby still uses the original `characterArt.ts` path and is unchanged. Rendering the portraits does not add a WebGL context, load GLBs, or run an animation loop on the player's phone.

- `volt`, `ama`, `kaze`, `rina`, `bolt`: cropped from the original 3×2 `runners-sheet-centered.png`, preserving the existing illustrations and transparent silhouettes.
- `frog`, `mambo`, `bball`, `whale`: static front portraits exported offline with Three.js/GLTFLoader from `assets/characters/{frog,pony,bball,whale}.glb`. Frog/pony/whale use an Idle sample and a -Z front camera. Basketball uses its Basketball clip and a +Z front camera (that model has a different facing convention). Source models and animations are unchanged.
- `penguin`: exported offline on 2026-10-13 with the same Three.js/GLTFLoader recipe as frog/pony/whale (Idle sample at t=0.6s, -Z front camera, transparent clear, ambient+directional lighting) from `assets/characters/penguin.glb`. Source model and animations are unchanged.
- `niu`: original selection-page illustration generated through Codex CLI `$imagegen` on 2026-10-11, with the existing five-runner sheet attached as a cartoon-style reference. The bull character uses the configured coral-red accent. This supplies a missing 2D portrait, **not** a replacement for the absent `niu.glb` or any gameplay change.

Exports are fitted within 360×440px and padded by 12px per side, encoded as alpha WebP at quality 93. Thumbnails load lazily; the selected hero loads eagerly. Unknown future characters retain the existing tint/initial fallback instead of breaking the page.
