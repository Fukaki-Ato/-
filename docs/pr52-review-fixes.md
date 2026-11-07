# PR #52 follow-up fixes

This follow-up addresses the review of `c214a406` before merging the feature branch.

## Behavior changes

- Successful automatic revival retracts the terminal `death` event. The real scene keeps running, and only the final death starts result settlement. The 15 golden changes are limited to death-event counts and event hashes; frames, inputs, scores and state are unchanged.
- Mission retention keeps users with wallet funds, progress, claims or character history. Expired tickets no longer occupy the open-run quota, and open-ticket cleanup follows the configured ticket TTL.
- Claimed mission rewards enter the spendable local wallet once per stable reward ledger. Balance and import cursors share one storage record. Refreshes, repeated claims and older responses do not restore spent funds. The task panel labels server totals as cumulative rewards, and the lobby no longer adds them twice.
- Character selection offers a separate shard-synthesis action. Sufficient shards enable it independently of coin prices; repeat synthesis and configuration locks cannot consume shards.
- Experience cards remain unavailable until account experience has an implementation. Purchases are rejected before charging, and previously held cards are not consumed by starting a run.
- Shop limits retain their existing device-local calendar-day semantics. Test dates now represent local days, with explicit UTC, Asia/Shanghai and America/Los_Angeles regressions. The independently specified Beijing-time mission periods are unchanged.
- WX mission transport requires an explicit HTTPS deployment origin, matches the backend Origin check, and isolates its session cookies by origin. The WX main entry remains the existing empty-scene verifier.

## Verification

- `TZ=UTC npm run check`: 737/737 tests, configuration validation, 214-source architecture check and disposable WX bundle pass.
- `TZ=Asia/Shanghai npm test`: 737/737 pass; the shop regression also spawns an America/Los_Angeles process.
- `npm run build:web` and `npm run build:wx -- --minify`: pass.
- Real scene-loop integration covers revival, final settlement once, and accepted server replay. Only the GPU renderer is stubbed in that test.
- New UI wording uses glyphs already present in the CJK atlas.
- Full browser E2E was attempted but could not launch in the execution environment: the Playwright browser archive download was invalid, and installed Chromium was blocked from creating its process socket. The smoke runner now accepts an optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for environments with a supported installed browser. No browser-E2E or WX real-device pass is claimed here.

## Deployment notes

Update the mission backend and client together: new clients require `rewardLedgerId` before importing rewards. See [mission backend](missions-backend.md) and [WX transport](wx-mission-transport.md). The economy remains a local MVP, not a cross-device authoritative spending system. These changes do not deploy either service.
