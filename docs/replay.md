# Replay Format

Replay fixtures make the deterministic simulation reviewable. A replay records a seed, character, fixed timestep, frame limit, and normalized input events.

```json
{
  "version": 1,
  "seed": 777,
  "charId": "char_volt",
  "dtMs": 16.666666666666668,
  "maxFrames": 1800,
  "inputs": [{ "frame": 24, "type": "swipe", "payload": { "dir": "left" } }]
}
```

`version: 1` requires `dtMs = 1000 / 60`. Inputs are ordered by nondecreasing frame and use platform-normalized event types: `swipe`, `doubleTap`, `tap`, and `key`.

```bash
node tools/replay/runner.mjs tools/replay/examples/example-v1.json
node tools/replay/golden-gen.mjs
node tools/replay/golden-gen.mjs --update
```

Only use `--update` after reviewing an intentional gameplay/configuration diff. Golden fixtures under `tests/golden/` are part of the gameplay contract and should change in the same pull request as the behavior that caused the change.
