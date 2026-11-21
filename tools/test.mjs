/** Explicit file discovery: no shell/Node-version-dependent glob expansion. Build before use. */
import { spawnSync } from 'node:child_process';
import { readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function discoverTests(directory = join(root, 'tests')) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map(entry => join(directory, entry.name))
    .sort();
}

export function runTests(args = process.argv.slice(2)) {
  const files = args.length ? args : discoverTests();
  if (!files.length) throw new Error('No tests/*.test.mjs files found');
  const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = runTests();
}
