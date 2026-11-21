import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { initialContent } = createRequire(import.meta.url)('../cloudfunctions/thunder-api/profile.cjs');
const sourceFiles = ['index.js', 'profile.cjs', 'cloudbase-store.cjs', 'run-api.cjs', 'run-policy.cjs',
  'run-store.cjs', 'welfare-policy.cjs', 'welfare-store.cjs', 'market-api.cjs', 'market-catalog.cjs',
  'market-policy.cjs', 'market-store.cjs', 'package.json', 'package-lock.json'];
const owner = 'tools/build-wx-cloud.mjs:thunder-api:v1\n';
const marker = '.thunder-cloud-build';

// Only this fixed sibling of the WX client dist is task-owned. Never clean the
// parent cloud-dist, apps/wx/dist, or accept arbitrary output paths for deletion.
export async function buildWxCloud() {
  const source = join(root, 'cloudfunctions/thunder-api');
  const parent = join(root, 'apps/wx/cloud-dist');
  const output = join(parent, 'thunder-api');
  const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
  const content = initialContent(readJson(join(root, 'config/characters.json')),
    readJson(join(root, 'config/themes.json')));
  createRequire(import.meta.url)('../cloudfunctions/thunder-api/welfare-policy.cjs')
    .validateConfig(readJson(join(root, 'config/economy.json')));
  createRequire(import.meta.url)('../cloudfunctions/thunder-api/market-catalog.cjs').createCatalog({
    content: { characters: readJson(join(root, 'config/characters.json')), items: readJson(join(root, 'config/items.json')) },
    economy: readJson(join(root, 'config/economy.json')),
  });
  for (const file of sourceFiles) {
    if (!existsSync(join(source, file))) throw new Error(`Missing cloud function source: ${file}`);
  }
  const runtimeFile = join(root, 'apps/server/dist/replay-runtime.mjs');
  for (const file of ['packages/game/dist/core/sim/runnerSim.js', 'packages/game/dist/flow/leaderboard.js',
    'packages/game/dist/core/simulationBuild.js', 'apps/server/dist/replay-runtime.mjs']) {
    if (!existsSync(join(root, file))) throw new Error('Missing compiled ranked simulation: run npm run build first');
  }
  const { SIMULATION_BUILD_ID } = await import('../packages/game/dist/core/simulationBuild.js');
  if (SIMULATION_BUILD_ID !== createHash('sha256').update(readFileSync(runtimeFile)).digest('hex')) {
    throw new Error('Simulation build identity is stale: run npm run build first');
  }
  const simulation = await build({ entryPoints: [join(source, 'simulation-entry.mjs')],
    bundle: true, platform: 'node', format: 'cjs', target: 'node20.19', write: false,
    legalComments: 'none', metafile: true });
  if (Object.keys(simulation.metafile.inputs).some(file => /(?:^|\/)render\//.test(file))) {
    throw new Error('Unexpected renderer in server simulation');
  }
  if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) {
    throw new Error('Refusing symlink cloud-dist directory');
  }
  if (existsSync(output)) {
    if (!lstatSync(output).isDirectory() || lstatSync(output).isSymbolicLink()) {
      throw new Error('Refusing to replace unowned cloud function output');
    }
    if (readdirSync(output).length) {
      if (!existsSync(join(output, marker)) || readFileSync(join(output, marker), 'utf8') !== owner) {
        throw new Error('Refusing to replace unowned cloud function output');
      }
      rmSync(output, { recursive: true });
    }
  }
  mkdirSync(parent, { recursive: true });
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, marker), owner, { flag: 'wx' });
  for (const file of sourceFiles) copyFileSync(join(source, file), join(output, file));
  writeFileSync(join(output, 'initial-content.json'), `${JSON.stringify(content, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(join(output, 'simulation.cjs'), simulation.outputFiles[0].contents, { flag: 'wx' });
  console.log('Cloud function source ready: apps/wx/cloud-dist/thunder-api (no deployment)');
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildWxCloud();
