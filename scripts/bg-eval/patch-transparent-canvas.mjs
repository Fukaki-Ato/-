#!/usr/bin/env node
/**
 * BG4 Web 视频垫底：把构建产物宏 ENGINE_TRANSPARENT_CANVAS 打开。
 *
 * 用法：
 *   npm run build:web                                  # 先构建（套用 build-templates/web-desktop 模板）
 *   node scripts/bg-eval/patch-transparent-canvas.mjs  # 再执行本脚本
 *
 * 说明：
 * - 目标文件为 build/web-desktop/src/settings.json；引擎在创建 WebGL 上下文之前由 macro.init
 *   读取 engine.macros.ENABLE_TRANSPARENT_CANVAS，置 true 后画布可透明（配合相机 clearColor
 *   的 alpha=0，DOM 视频才能透出）。
 * - 宏在启动时读取，修改后需刷新页面；脚本幂等，可重复执行。
 * - 未找到构建产物时非 0 退出，并提示“请先构建”。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MACRO = 'ENABLE_TRANSPARENT_CANVAS';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const settingsPath = join(root, 'build', 'web-desktop', 'src', 'settings.json');

if (!existsSync(settingsPath)) {
  console.error(`[bg4] 未找到构建产物：${settingsPath}`);
  console.error('[bg4] 请先构建（npm run build:web）后再执行本脚本。');
  process.exit(1);
}

let settings;
try {
  settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
} catch (err) {
  console.error(`[bg4] 解析失败：${settingsPath}`);
  console.error(`[bg4] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
  console.error('[bg4] settings.json 根节点结构异常，未写入。');
  process.exit(1);
}

const engine = settings.engine && typeof settings.engine === 'object' && !Array.isArray(settings.engine)
  ? settings.engine
  : {};
const macros = engine.macros && typeof engine.macros === 'object' && !Array.isArray(engine.macros)
  ? engine.macros
  : {};
const before = macros[MACRO];

console.log(`[bg4] 目标：${settingsPath}`);
console.log(`[bg4] engine.macros.${MACRO}: ${JSON.stringify(before)} -> true`);

if (before === true) {
  console.log('[bg4] 已是 true，无需修改（幂等）。');
  process.exit(0);
}

macros[MACRO] = true;
engine.macros = macros;
settings.engine = engine;
writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
console.log('[bg4] 已写入；刷新页面（重新打开 ?bg=video）后生效。');
