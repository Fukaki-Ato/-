#!/usr/bin/env node
/**
 * 微信小游戏构建后处理：接入开放数据域（好友排行榜）。
 *
 * 背景：Cocos Creator 3.8 的 wechatgame 构建不会自动把 assets/openDataContext 放入产物
 * （编辑器提供的是独立「开放数据域工程」buildSub 流程），而微信原生规范要求：
 *   1) 产物根目录存在开放数据域代码目录（入口 index.js）；
 *   2) game.json 写入 "openDataContext": "<目录名>"。
 *
 * 本脚本在每次 `npm run build:wechat`（或手动构建）后执行：
 *   node scripts/wechat-open-data-context.mjs [buildDir]
 * 默认 buildDir = build/wechatgame。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'assets', 'openDataContext');
const buildDir = resolve(process.argv[2] ?? join(root, 'build', 'wechatgame'));
const targetDir = join(buildDir, 'openDataContext');
const gameJsonPath = join(buildDir, 'game.json');

if (!existsSync(source)) {
  console.error(`[open-data-context] 源目录不存在：${source}`);
  process.exit(1);
}
if (!existsSync(buildDir)) {
  console.error(`[open-data-context] 构建产物不存在：${buildDir}（请先执行 Cocos 构建 wechatgame）`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
cpSync(source, targetDir, {
  recursive: true,
  filter: (src) => !src.endsWith('.meta') && !src.endsWith('README.md'),
});
console.log(`[open-data-context] 已复制开放数据域代码 → ${targetDir}`);

let gameJson;
try {
  gameJson = JSON.parse(readFileSync(gameJsonPath, 'utf8'));
} catch (err) {
  console.error(`[open-data-context] game.json 读取/解析失败：${gameJsonPath}`, err);
  process.exit(1);
}
gameJson.openDataContext = 'openDataContext';
writeFileSync(gameJsonPath, `${JSON.stringify(gameJson, null, 4)}\n`);
console.log('[open-data-context] 已在 game.json 写入 "openDataContext": "openDataContext"');
console.log('[open-data-context] 完成。微信开发者工具导入 build/wechatgame 即可生效。');
