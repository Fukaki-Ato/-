# Mobile UI — Sea Breeze

The Web game now uses responsive DOM renderers for the lobby, character selection, shop, settings, result, and HUD. `overlayViews` accepts optional renderer hooks; the existing host-neutral canvas implementations remain the fallback. Simulation, economy, input gestures, and persistence are unchanged. Cocos/WX integration and physical-device acceptance are still separate follow-up work, not proven by the Web implementation.

## Design rules

- Preserve the improved native typography and mobile sizing, but keep a cartoon game identity rather than generic flat application cards (explicit user feedback, 2026-10-11).
- Reuse the old illustrated home icons and the old shop's sculpted wood/gold borders, glossy buttons, warm paper and irregular plaque shapes. Dynamic labels and hitboxes stay native; do not return to a single scaled screenshot.
- Side shortcuts occupy left/right columns, leaving the central seaside scene open. The runner picker is a compact chip; remove redundant decorative English, slogans and repeated role details from the lobby. One dominant start action per screen.
- Touch navigation targets are at least 44px. Character selection is **phone-first and one-screen**: the complete visible roster cards and run/shop actions remain on screen together, including short browser viewports and safe-area padding. Roster scrolling is horizontal; full ability descriptions scroll only inside the details sheet.
- Scale decorative artwork to the remaining height, not essential text or hitboxes. Check narrow landscape by orientation/height rather than assuming a minimum desktop width. No global scaling of text and hitboxes.
- HUD is pointer-transparent: swipes and double taps still reach the original gesture handler. Buffs are merged by name using the longest remaining duration.
- Shop offers remain read-only. Locked characters can be previewed but cannot start a run. Currency counts, role data, theme selection and results come from the existing flow/config.

## Files and assets

`apps/web/src/mobileUi.*` owns tokens, accessible native text and page lifecycle; `cartoonSkins.css` applies reusable nine-slice artwork without scaling text. `mobileLobby.*`, `mobilePanels.*`, `mobileHud.*`, `characterSelectOverlay.*`, and `shopOverlay.*` own page composition. Raster components and the licensed subset font live under `apps/web/src/assets/mobile-ui/`. Mobile bootstrap skips the legacy menu video and badge atlas downloads; individual reused icons are bundled normally.

## Character selection — mobile-first correction

User correction: making the showcase responsive was insufficient for the requested phone experience. The earlier 320×568 page placed the roster below the first screen even though its bottom buttons passed the old tests. Do not equate “no horizontal overflow + visible footer” with mobile acceptance.

The current page reserves fixed-height tracks for compact skill buttons, the horizontal roster and bottom actions; the portrait/identity region uses the remaining viewport height. Full descriptions open in a focus-managed details sheet. Selected thumbnails move into view immediately rather than animating through stale selections. Short landscape has its own compact tracks, including narrow 568×320 devices.

Acceptance must cover every configured role, all roster-card bottoms above the footer, real touch hit-testing inside the roster's clipping rectangle, no page-level vertical scroll, and simulated safe areas. Browser chrome reducing usable height is part of the baseline, not an edge case.

`selectCharacterArt.ts` is selection-only: five existing illustrations are cropped from the original sheet, four portraits are exported offline from the existing models, and Moo has a Codex-generated 2D illustration. The approved lobby's `characterArt.ts` and the game models/configuration stay unchanged. Portraits do not introduce a live renderer or animation loop on mobile. Asset provenance is documented alongside the portraits.

The full-screen selection dialog owns its keyboard listener on the dialog root, not on `document`. This prevents the Escape returning from the shop from reaching a newly installed selection listener in the same bubbling event and navigating back twice. Locked selections announce the role name in the live status, remain previewable and cannot start a run; future roles without a portrait retain the existing generic fallback.

While ability details are open, the selection frame is inert/hidden from assistive technology, focus stays inside the details panel, arrow keys do not cycle characters, and the first Escape closes details without leaving selection. Closing restores focus; navigation disposes both layers.

## Verification

Run `npm run check` and `npm run build:web`. Browser checks should include 320×568, 390×844, 430×932 and 844×390; lobby → characters → shop → back → run → result → retry/lobby, locked-role preview, theme persistence, no horizontal page overflow, minimum touch targets, and pointer-transparent HUD.

2026-10-11 initial native-text pass: full check passed (539 tests), production Web build passed, and the production bundle passed the four viewport checks with no horizontal page overflow or enabled navigation targets smaller than 44px. Browser interaction covered touch roster scrolling, category/pagination controls, theme persistence, a real run with touch lane-change/jump, natural game-over, retry and return. An isolated config-response fixture verified locked-role preview, disabled start and preservation of the active role across shop navigation. No page errors or failed HTTP responses occurred in the initial Vite-preview check. Chromium used a fresh profile and blocked cross-origin requests; no-sandbox mode was explicitly authorized by the user after the cloud environment denied sandbox startup. Physical iOS/Android and Cocos/WeChat Developer Tools checks remain pending.

The cartoon refinement passed the quality gate (541 tests) and production build. The deployed independent test site passed the same four viewports and full real play loop, with all four illustrated shortcuts decoded, side controls clear of the lower dock, and the centre of the scene left free. All 137 release files matched the served bytes; the official site stayed unchanged and the prior test versions were backed up. The existing missing `volt.glb` still uses the documented procedural-avatar fallback; no new page errors or unexpected HTTP failures occurred. Public probing was intentionally omitted per the user's firewall policy. The fixed delivery URL is recorded in `docs/ui-delivery.md` and must be included in every deployment reply.

The character-showcase pass passed the quality gate (545 tests), production build and deployed-browser checks at all four viewports. All ten cutouts decoded; previous/next, arrow keys, touch roster scrolling, locked-role preview, single-Escape shop return and the actual run entry passed. Lobby and shop screenshots matched the approved version pixel-for-pixel. All 147 release files matched the served bytes; the official site stayed unchanged. The independent review's dialog semantics and named locked-role announcement findings were corrected and covered by focused assertions. Physical-device/Cocos acceptance remains separate; no public probe was performed.

The mobile-first correction passed 546 tests and the deployed browser's **18 viewport/safe-area cases**, exercising every one of the ten roles in each case: 320×568, 360×600, 375×640, 390×664, 390×844, 430×740, 568×320, 667×375 and 844×390, each with normal and simulated 24px-top/34px-bottom insets. The page required no vertical scroll, complete roster cards stayed above the action row, and visible cards received touches through the clipping rectangle. Details opening/closing, inert background, scoped focus/Escape, horizontal touch scrolling, locked preview, shop return and run entry passed. Approved lobby/shop pixels remained unchanged; all 147 published files matched the release and the official site was untouched. Public probing remains intentionally omitted.
