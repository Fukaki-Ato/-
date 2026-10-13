import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const CONFIG_NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];

export function loadMissionContent(root = repoRoot) {
  return Object.fromEntries(CONFIG_NAMES.map(name => [
    name, JSON.parse(readFileSync(join(root, 'config', `${name}.json`), 'utf8')),
  ]));
}
