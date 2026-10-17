import { parentPort, workerData } from 'node:worker_threads';
import { loadContent } from '../tools/replay/runner.mjs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';

const content = workerData.content ?? loadContent();
parentPort.postMessage({ type: 'ready' });

function replay({ seed, charId, frames, inputs }) {
  const sim = new RunnerSim(content, seed, charId);
  let inputIndex = 0;
  for (let frame = 0; frame < frames; frame++) {
    while (inputIndex < inputs.length && inputs[inputIndex].frame === frame) {
      sim.applyAction(inputs[inputIndex].action);
      inputIndex++;
    }
    sim.step();

    // Acceptance is tied to the actual simulation, including its final death step.
    if (frame < frames - 1 && !sim.state.alive) return { accepted: false };
    if (frame === frames - 1 && sim.state.alive) return { accepted: false };
  }

  const summary = sim.summary();
  if (sim.state.alive || sim.replayFrames !== frames || summary.alive !== false) {
    return { accepted: false };
  }
  const record = sim.firstCoinRecord.snapshot(summary);
  if (!Number.isFinite(record.distance) || record.distance < 0
    || !Number.isSafeInteger(record.score) || record.score < 0) {
    return { accepted: false };
  }
  return { accepted: true, distance: record.distance, score: record.score };
}

parentPort.on('message', message => {
  if (!message || typeof message.id !== 'number') return;
  try {
    parentPort.postMessage({ id: message.id, result: replay(message.payload) });
  } catch {
    // Simulation/config failures are intentionally not sent to the HTTP process.
    parentPort.postMessage({ id: message.id, result: { accepted: false } });
  }
});
