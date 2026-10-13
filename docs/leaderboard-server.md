# Pre-first-coin distance leaderboard server

This Node HTTP service backs the same-origin API at /thunder-run/api. It is deliberately separate from the web workspace: it uses only Node built-ins, including Node 22.23+'s node:sqlite, and loads canonical game data and replay simulation from this repository. Build the game distribution before starting it.

## Run locally

    npm run build
    TR_LEADERBOARD_DB=./data/leaderboard.sqlite \
    TR_LEADERBOARD_ORIGINS=http://localhost:8767,http://127.0.0.1:8767 \
    node server/index.mjs

The default port is 8788; the server binds to 127.0.0.1 only. GET /thunder-run/api/health returns only {"ok":true} when SQLite is available. Production should configure exact browser origin(s), for example TR_LEADERBOARD_ORIGINS=https://play.example.com, and have the existing nginx route proxy /thunder-run/api/ to 127.0.0.1:8788 without stripping the path. Nginx should overwrite X-Real-IP with the connecting client address. The service trusts that one header only when the TCP peer is loopback; it never uses X-Forwarded-For. If the proxy header is absent, rate limits safely fall back to the loopback peer (so all proxied visitors share a bucket).

Optional environment settings:

- TR_LEADERBOARD_PORT (default 8788)
- TR_LEADERBOARD_DB (default ./data/leaderboard.sqlite)
- TR_LEADERBOARD_ORIGINS (default local Vite origins above; comma-separated exact HTTP(S) origins, no paths)
- TR_LEADERBOARD_COOKIE_SECURE=true to add Secure when the public site is HTTPS. It defaults off because the current official route is HTTP.
- TR_LEADERBOARD_WORKERS (default 2, bounded to 1–4), TR_LEADERBOARD_QUEUE (default 8, bounded to 0–64), and TR_LEADERBOARD_REPLAY_TIMEOUT_MS (default 15000, bounded to 250–18000)

No CORS headers are emitted. Mutating POSTs require an exact configured Origin and Content-Type: application/json.

## API

All responses are JSON with Cache-Control: no-store. Errors have the form {"error":{"code":"..."}}; codes do not contain exception text, paths, SQLite errors, cookies, or tokens.

- GET /thunder-run/api/leaderboard returns the global top 50 plus this visitor's personal best and server-generated name:

      {"entries":[{"rank":1,"playerName":"疾风跑者-42","distance":123.45,"score":1200,"charId":"char_volt"}],"personal":null,"playerName":"星河旅人-18"}

  Entries are ordered by distance descending, then score descending, then the earliest successfully submitted best. Each identity has at most one stored best; an equal distance/score replay does not replace the earlier record. personal has the same entry shape and includes its rank even when below the top 50.

- POST /thunder-run/api/runs, body {"charId":"char_volt","rulesId":"first-coin-v1-..."}, validates the current shared rules ID and a live, unlocked playable character. It returns {"runId":"...","seed":123,"rulesId":"..."}. The opaque run ticket is bound to the anonymous cookie identity and expires after 30 minutes plus a 60-second upload grace period. Pending tickets are memory-only and are invalidated by a server restart.

- POST /thunder-run/api/runs/submit, body {"runId":"...","frames":123,"inputs":[{"frame":0,"action":"jump"}]}, submits the exact ordered action stream. It returns {"accepted":true|false} for a well-formed, bound, one-use ticket. accepted:false means the deterministic run did not meet ranked rules; malformed requests and unavailable tickets use generic error statuses/codes.

- POST /thunder-run/api/runs/cancel, body {"runId":"..."}, releases a ticket owned by the current cookie. The client uses this for abandoned or over-limit runs (no replay upload) and ignores cancellation network failures. Runs that collect coins now upload normally on death. Missing tickets are idempotent; another identity cannot cancel a live ticket. At most 60 cancellations/minute/IP. Equal distance/score records are ordered by their successful server submission time, then row ID.

The service accepts no client score or distance fields. It replays every submitted frame in a bounded worker thread using the challenge seed, character and canonical RunnerSim; acceptance requires exactly the supplied number of alive steps, death on the final step, and no earlier death. RunnerSim.replayFrames is checked against the submitted count. The run may collect any number of coins: the distance and score freeze immediately before the first actual pickup is credited, and later gameplay/rewards cannot inflate that checkpoint. Ordinary pickup, magnets and bulk skill collection all use the same credit hook; currency multipliers do not affect whether the checkpoint stops. If no coin was ever collected, use the unchanged final run summary.

The new rules ID rejects an old `coinless-v1-*` client even with identical config files. Deploy both front end and server from the new revision together. No database migration/reset is required: every stored old whole-run zero-coin result is also a valid pre-first-coin result; identities, bests and ordering remain intact. Previously rejected coin-collecting runs were not stored and cannot be reconstructed retrospectively.

Replay limits follow the shared protocol: at most 108,000 frames and 20,000 inputs; input actions are jump, slide, laneL, laneR, or skill, with nondecreasing in-range frame numbers. Upload cannot arrive more than two seconds faster than the claimed 60 Hz elapsed time. JSON bodies are capped at 2 MiB. The worker pool has fixed concurrency, a bounded waiting queue, end-to-end queue/worker timeout and memory limits; replay CPU work does not run on the HTTP event loop.

## Identity, storage, and abuse controls

On first leaderboard/run access the server creates a cryptographically random 256-bit bearer token, returns it only as an HttpOnly; SameSite=Lax cookie scoped to /thunder-run/api, and stores only its SHA-256 hash in SQLite. The cookie persists for one year. Names are generated short pseudonyms; no identity key/token is returned in JSON. Enable the Secure cookie flag only when the browser-facing route is HTTPS.

SQLite stores player names and one best result per token hash; a conditional SQL upsert atomically preserves the highest distance, then score, and SQLite uses WAL with FULL synchronous commits. The database file is durable; active challenges and bounded in-memory rate-limit buckets are not. IP request buckets use the trusted loopback X-Real-IP header described above, with at most 4,096 limiter keys. Per-IP limits are 60 leaderboard reads/minute, 15 ticket requests/minute, and 30 submissions/minute; new cookie identities are limited to 10/minute. A player can hold at most five outstanding tickets.

## Checks

node --test tests/leaderboard-server.test.mjs exercises two independent HTTP cookie clients, shared/personal leaderboard data, persistence across server restart, token hashing, sorting/upsert behavior, exact-Origin and JSON enforcement, bounded bodies and input ordering, single-use/bound tickets, real-content death validation, coin-collecting runs ranked by their frozen prefix rather than final distance/score, and rejection of forged client metric fields. `tests/first-coin-record.test.mjs` covers ordinary/magnet/bulk pickups, zero-value currency, exact score timing, immutable checkpoints, no-coin fallback and deterministic replay.

## Production layout and upgrade

- Node 22.23+ (CI uses Node 24); compile with `npm ci && npm run build` first. The API runtime needs only `server/`, `config/`, `tools/replay/`, `packages/game/dist/` and `packages/game/package.json` in their repository-relative layout; it has no installed runtime dependencies.
- Keep immutable releases in `/opt/thunder-run-leaderboard/releases/<git-sha>/`, with a `current` symlink. Keep SQLite outside releases, e.g. `/var/lib/thunder-run-leaderboard/leaderboard.sqlite`. Never copy a development/test database into production.
- Use a supervised unprivileged service. With systemd, `DynamicUser=yes`, `StateDirectory=thunder-run-leaderboard`, `ProtectHome=yes`, `ProtectSystem=strict`, `NoNewPrivileges=yes`, and `Restart=on-failure` keep the writable surface confined to durable state. Start `/usr/local/bin/node /opt/thunder-run-leaderboard/current/server/index.mjs`.
- Configure `TR_LEADERBOARD_ORIGINS` to the exact official origin, `TR_LEADERBOARD_DB` to durable state, and `TR_LEADERBOARD_PORT=8788`. The current official site is HTTP, so the Secure cookie flag is off until HTTPS is enabled.

In the **existing official vhost only**, add the narrow route (preserve all other locations):

```nginx
location ^~ /thunder-run/api/ {
    client_max_body_size 2m;
    proxy_pass http://127.0.0.1:8788;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 25s;
    add_header Cache-Control "no-store" always;
}
```

Back up the old Nginx config, pass `nginx -t`, then reload. Check health through both loopback API and the official loopback proxy; verify the original static HTML/assets are byte-identical. Do not create public scores during deployment smoke checks. API deployment does **not** authorize updating the official front end: keep the prior UI until the PR is merged and the user requests synchronization. Do not change firewall/TLS/DNS settings.

For upgrades, build the merged gameplay revision, copy a new release, switch `current`, and restart the service. Restart invalidates active tickets; existing bests and identities survive. Rollback switches the symlink back and restarts. SQLite schema changes must include an explicit compatible migration/backup plan; for backup of a running WAL database, use SQLite's backup API or stop the service and copy the database together with its `-wal`/`-shm` files, not the main database alone.

Deployment lesson (2026-10-12): ESM resolves `import.meta.url` to the real release path, while `process.argv[1]` can retain `current`. A lexical main-module comparison then skips CLI startup and exits **successfully without listening**. Normalize the argv path with `realpathSync`; `tests/leaderboard-cli.test.mjs` verifies actual listening/health through a release-directory symlink. Confirm a listener and proxy health after systemd start, not only a zero exit status. If Nginx reload reports a stale PID, inspect real processes/listeners before retrying; when the existing service is stopped, start its already-validated existing configuration rather than inventing a replacement route or editing the PID file.

Cross-platform fixture lesson (2026-10-12): a persistence test that reopens a SQLite service must give the fixture ownership of **all** reopened HTTP/worker/database handles. Close those services before deleting the temporary database directory in one cleanup hook; do not rely on a later `t.after` hook to close the reopened service. Linux's open-file unlink behavior masked that ordering dependency. The first Windows run failed that persistence test and kept the process alive; the ownership/order correction passed all checks on Windows (58s), Linux (26s), and the WX build in CI run `38258039761`. Use the same ownership rule for future database-restart tests.
