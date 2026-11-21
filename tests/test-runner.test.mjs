import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverTests } from '../tools/test.mjs';

test('test discovery is sorted, top-level only, and excludes helpers/directories', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tr-test-discovery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['z.test.mjs', 'a.test.mjs', 'helper.mjs', 'other.test.js']) {
    writeFileSync(join(dir, name), '');
  }
  mkdirSync(join(dir, 'directory.test.mjs'));
  assert.deepEqual(discoverTests(dir), [join(dir, 'a.test.mjs'), join(dir, 'z.test.mjs')]);
});
