/**
 * UI 测试共用助手（非 .test.mjs，node --test 不会当用例跑）。
 * headless 约定：FontSet 用真实 metrics.json 但 texture=null（只排版不渲染）；
 * three 的 Scene/Geometry/DataTexture 在 node 中可安全构造（仅 renderer.render 需要 GL）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFontAtlas, createFontSet } from '../packages/framework/dist/ui/index.js';

export const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');

export function loadTestFontSet() {
  const latin = JSON.parse(readFileSync(join(repoRoot, 'assets/fonts/latin.metrics.json'), 'utf8'));
  const cjk = JSON.parse(readFileSync(join(repoRoot, 'assets/fonts/cjk.metrics.json'), 'utf8'));
  return createFontSet([createFontAtlas(latin, null), createFontAtlas(cjk, null)]);
}

export function readJson(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'));
}
