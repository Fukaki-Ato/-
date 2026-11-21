import test from 'node:test';
import assert from 'node:assert/strict';
import { skipCell, zoneAt } from '../packages/game/dist/core/sim/zones.js';
import { TrackGen } from '../packages/game/dist/core/sim/trackGen.js';
import { RunRng } from '../packages/game/dist/core/rng.js';
import { readFileSync } from 'node:fs';

const zones = [600, 1100].map(startM => ({ startM, endM: startM + 90, ceilH: 4.6 }));
const classes = ['', 'low', 'high', 'full', 'hazard', 'vehicle', 'moving', 'step'];

test('skipCell: both external 12m windows include their outer endpoints for every cell class', () => {
  for (const zn of zones) {
    for (const z of [zn.startM - 12, zn.startM - 0.01, zn.endM, zn.endM + 0.01, zn.endM + 12]) {
      assert.equal(zoneAt(zones, z), null);
      for (const cls of classes) assert.equal(skipCell(zones, z, cls), true, `${z}: ${cls}`);
    }
    for (const z of [zn.startM - 12.01, zn.endM + 12.01]) {
      for (const cls of classes) assert.equal(skipCell(zones, z, cls), false, `${z}: ${cls}`);
    }
  }
});

test('skipCell: zone body retains class filtering and unconfigured tracks retain all cells', () => {
  for (const zn of zones) {
    for (const z of [zn.startM, zn.startM + 45, zn.endM - 0.01]) {
      for (const cls of classes) {
        assert.equal(skipCell(zones, z, cls), ['vehicle', 'moving', 'step'].includes(cls));
        assert.equal(skipCell([], z, cls), false);
      }
    }
  }
  for (const cls of classes) assert.equal(skipCell(zones, 900, cls), false);
});

test('skipCell: neighboring clearance windows take precedence even inside an adjacent zone', () => {
  const nearby = [{ startM: 100, endM: 190, ceilH: 4.6 }, { startM: 195, endM: 285, ceilH: 4.6 }];
  for (const z of [183, 189, 190, 194, 195, 202]) assert.equal(skipCell(nearby, z, 'low'), true);
  for (const z of [182.99, 202.01]) assert.equal(skipCell(nearby, z, 'low'), false);
});

test('TrackGen.ensure: registered zones suppress obstacle cells in entrance and exit windows', () => {
  const names = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
  const content = Object.fromEntries(names.map(n => [n, JSON.parse(readFileSync(new URL(`../config/${n}.json`, import.meta.url), 'utf8'))]));
  const def = content.obstacles.defs.find(d => d.class === 'low');
  const positions = [587.99, 588, 599.99, 600, 689.99, 690, 702, 702.01];
  delete content.obstacles.zap;
  const gen = new TrackGen(content, new RunRng(55));
  gen.genZ = 580;
  gen.pickPattern = () => ({ id: 'clearance_test', lengthSegments: 6,
    cells: positions.map(z => ({ segment: 0, offsetM: z - 580, lane: 0, obsRef: def.id })) });
  const obstacles = [];
  gen.ensure(580, 1, obstacles, []);
  assert.deepEqual(obstacles.map(o => o.worldZ), [587.99, 600, 689.99, 702.01]);
});
