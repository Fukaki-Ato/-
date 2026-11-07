# WX mission transport deployment

`createWxMissionApi(wx, storage, origin)` requires the deployment's exact HTTPS
origin (for example the placeholder `https://missions.example.test`). There is no
default server. Supply the real origin in the WX integration when enabling the
full game flow; the current `apps/wx/src/main.ts` remains an empty-scene verifier.
The origin must contain only a lower-case DNS hostname and optional port, without
credentials, path, query or fragment. Port 443 is normalized away.

Register this HTTPS host in the mini game's request-domain allowlist and configure
the mission server's `PUBLIC_ORIGIN` to the same origin. The adapter sends `Origin`
on requests so the backend's existing POST source check can stay enabled. It
continues sending session cookies explicitly because WX does not manage the web
cookie jar. Cookies are stored per deployment origin; old unscoped cookies are
not forwarded to a newly configured host. Storage and queue state belong to the
same game account. When wiring the full WX game flow, wrap adapter storage with
`createRewardWalletStore(storage)` before passing it to both game consumers and
the mission API. The API imports cumulative rewards through that wrapper; all
wallet consumers must also use the wrapper to see the atomic wallet record. Do not reuse account storage across unrelated deployments.

The protocol test uses the real HTTP mission server with a local network bridge;
it verifies Origin rejection compatibility and session cookie round-tripping.
It does not substitute for a real-device HTTPS/domain-allowlist smoke test.
