/** Build-only: freeze the pure simulation and the server replay loop into a deployable ABI-1 ESM. */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadMissionContent } from '../apps/server/src/content.mjs';
import { createRuleset, replaySourceHash } from '../apps/server/src/rules.mjs';
import { DEFAULT_LIMITS } from '../apps/server/src/limits.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'apps/server/dist/replay-runtime.mjs');
const result = await build({ absWorkingDir: root, entryPoints: ['apps/server/src/replay.mjs'], outfile: output,
  bundle: true, platform: 'node', format: 'esm', target: 'node22.23', minify: true, write: false, metafile: true });
for (const entry of Object.values(result.metafile.outputs)) {
  if (entry.imports.some(item => !item.path.startsWith('node:'))) throw new Error('Replay bundle may only retain Node built-in imports');
}
const source = result.outputFiles[0].text;
const runtime = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
if (typeof runtime.replayRun !== 'function' || !Number.isFinite(runtime.STEP_DT) || runtime.STEP_DT <= 0) throw new Error('Replay ABI build failed');
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, source);
console.log(`Replay ABI-1 bundle: ${Buffer.byteLength(source)} bytes`);
console.log(`Replay runtime SHA-256: ${replaySourceHash(source)}`);

const baseline = process.argv.find(arg => arg.startsWith('--freeze-baseline='))?.split('=')[1];
if (baseline) {
  if (baseline !== '38d5116') throw new Error('Only the verified production baseline may be frozen here');
  const inputs = Object.keys(result.metafile.inputs).map(path => path.replace(/\\/g, '/'));
  const files = new Set(inputs.map(path => path.replace(/^(packages\/[^/]+)\/dist\/(.*)\.js$/, '$1/src/$2.ts')));
  for (const name of ['game','characters','skills','items','obstacles','themes','events','economy']) files.add(`config/${name}.json`);
  files.add('apps/server/src/limits.mjs');
  for (const path of files) {
    const previous = execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');
    if (readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n') !== previous) throw new Error(`Baseline input changed: ${path}`);
  }
  const content = loadMissionContent(root);
  const ruleset = createRuleset({ content, minRunSeconds: content.economy.params.missions.minRunSeconds ?? 10,
    limits: DEFAULT_LIMITS, runtimeSource: source });
  const file = join(root, `apps/server/rules-baselines/${baseline}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...ruleset, baseline }, null, 2) + '\n', { flag: 'wx' });
  console.log(`Frozen verified baseline ${baseline}: ${ruleset.id}`);
}
