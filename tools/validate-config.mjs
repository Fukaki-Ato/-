/**
 * 配置校验命令行工具。
 * 用法：node tools/validate-config.mjs [配置目录]
 * 复用 core 的同一份校验器（编译产物 packages/game/dist/core/**），保证「CI 校验」与「运行时校验」逻辑一致。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFile, validateRefs } from '../packages/game/dist/core/config/configValidator.js';

const dir = process.argv[2] ?? fileURLToPath(new URL('../config', import.meta.url));
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
const content = {};
let errors = [];

for (const f of files) {
  const name = f.replace(/\.json$/, '');
  let data;
  try {
    data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  } catch (e) {
    errors.push(`${name}: JSON 解析失败 ${e.message}`);
    continue;
  }
  content[name] = data;
  errors.push(...validateFile(name, data));
}
// 8 个文件齐备才能做跨文件引用检查
const missing = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'].filter(n => !content[n]);
for (const m of missing) errors.push(`缺少配置文件: ${m}.json`);
if (missing.length === 0) errors.push(...validateRefs(content));

if (errors.length) {
  console.error('配置校验失败：');
  for (const e of errors) console.error('  ✗', e);
  process.exit(1);
}
console.log(`配置校验通过（${files.length} 个文件）`);
