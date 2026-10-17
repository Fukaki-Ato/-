import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('CLI starts through a release-directory symlink (systemd current layout)', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tr-leaderboard-cli-'));
  const current = join(dir, 'current');
  await symlink(fileURLToPath(new URL('../', import.meta.url)), current, process.platform === 'win32' ? 'junction' : 'dir');
  const child = spawn(process.execPath, [join(current, 'server/index.mjs')], {
    env: { ...process.env, TR_LEADERBOARD_PORT: '0', TR_LEADERBOARD_DB: join(dir, 'state.sqlite'), TR_LEADERBOARD_ORIGINS: 'http://127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await exited;
    await rm(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CLI did not start within 10s')), 10000);
    let output = '';
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(Error('CLI exited before listening')); });
  });
  assert.ok(port > 0);
  const response = await fetch(`http://127.0.0.1:${port}/thunder-run/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
