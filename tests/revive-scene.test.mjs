import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { loadContent } from '../tools/replay/runner.mjs';
import { ReplayPool } from '../server/replay-pool.mjs';

// Exercise the real scene, animation loop and event consumer. Only the GPU backend
// is replaced: all Three.js scene objects and game rendering modules remain real.
async function headlessScene() {
  const three = import.meta.resolve('three');
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../packages/game/src/render/runnerScene.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'headless-webgl', setup(b) {
      b.onResolve({ filter: /^three$/ }, () => ({ path: 'three', namespace: 'headless' }));
      b.onLoad({ filter: /.*/, namespace: 'headless' }, () => ({ loader: 'js', contents: `
        export * from ${JSON.stringify(three)};
        export class WebGLRenderer {
          setPixelRatio() {} setSize() {} render() {} dispose() {}
        }
      ` }));
      b.onResolve({ filter: /^file:/ }, args => ({ path: args.path, external: true }));
    } }],
  });
  return (await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))).createRunnerScene;
}

test('default revive keeps the real scene running; only final death ends once and replay is accepted', async t => {
  const content = loadContent();
  const seed = 42, charId = 'char_volt';
  const sim = new RunnerSim(content, seed, charId, true);
  const createScene = await headlessScene();
  let now = 0, frame, deaths = 0;
  const ends = [], events = [];
  const drain = sim.drainEvents.bind(sim);
  sim.drainEvents = () => { const batch = drain(); events.push(...batch); return batch; };
  const adapter = {
    now: () => now, requestFrame: cb => { frame = cb; return 1; }, cancelFrame() {},
    onInput: () => () => {}, onVisibility: () => () => {},
    canvas: { onResize: () => () => {} },
  };
  const scene = createScene({ canvas: {}, size: { width: 390, height: 844, dpr: 1 } }, adapter, sim, content, {
    onHud() {}, onDeath: () => deaths++, onEnd: summary => ends.push(summary),
  });
  t.after(() => scene.dispose());
  const advance = () => { now += 1000 / 60; frame(now); };
  for (let i = 0; i < 20000 && sim.state.revivesUsed === 0; i++) advance();
  assert.equal(sim.state.revivesUsed, 1, 'default content must exercise the free revival');
  assert.equal(sim.state.alive, true);
  assert.equal(deaths, 0, 'revival must not play terminal death audio');
  assert.equal(events.filter(e => e.type === 'death').length, 0, 'revival is not a terminal death event');
  assert.equal(events.filter(e => e.type === 'revive').length, 1);
  for (let i = 0; i < 90; i++) advance(); // past the scene's 1.2s end delay, within revive immunity
  assert.equal(sim.state.alive, true);
  assert.equal(ends.length, 0, 'revival must not start the result-page timer');
  for (let i = 0; i < 20000 && sim.state.alive; i++) advance();
  assert.equal(sim.state.alive, false);
  assert.equal(deaths, 1);
  assert.equal(ends.length, 0, 'final death retains the presentation delay');
  for (let i = 0; i < 180; i++) advance();
  assert.equal(ends.length, 1, 'final death settles exactly once');
  assert.equal(ends[0].alive, false);
  assert.equal(events.filter(e => e.type === 'death').length, 1);
  const pool = new ReplayPool({ size: 1, content });
  t.after(() => pool.close());
  const result = await pool.run({ seed, charId, frames: sim.replayFrames, inputs: sim.replayInputs });
  assert.equal(result.accepted, true, 'the actual scene submits a complete replay through final death');
});
