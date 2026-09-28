/**
 * Enforces the only architectural boundary the repository needs:
 * framework and game are host-neutral, while each app owns its platform code.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_FILE_LINES = 300;
const DOM_GLOBALS = [
  [/\bwindow\./g, '禁止直接使用 window'],
  [/\bdocument\./g, '禁止直接使用 document'],
  [/\blocalStorage\b/g, '禁止直接使用 localStorage'],
  [/\bfetch\(/g, '禁止直接调用 fetch'],
  [/\bwx\./g, '禁止直接使用 wx API'],
];
const APP_IMPORTS = [
  [/from ['"][^'"]*apps\/(web|wx)\//g, 'packages 不得 import app 实现'],
];
const WX_BAN = [/\bwx\./g, 'wx 全局只允许 apps/wx/src/platform 触碰'];
const WEB_GLOBALS = [
  [/\bwindow\./g, 'WX 平台实现禁止 web 全局 window'],
  [/\bdocument\./g, 'WX 平台实现禁止 web 全局 document'],
  [/\blocalStorage\b/g, 'WX 平台实现禁止 localStorage'],
];

function* walkTs(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'build') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walkTs(path);
    else if (path.endsWith('.ts')) yield path;
  }
}

function sourcesUnder(base) {
  if (!existsSync(base)) return [];
  const files = [];
  for (const name of readdirSync(base)) {
    const dir = join(base, name);
    if (!statSync(dir).isDirectory()) continue;
    const source = join(dir, 'src');
    if (existsSync(source) && statSync(source).isDirectory()) files.push(...walkTs(source));
  }
  return files;
}

const violations = [];
const files = [...sourcesUnder('packages'), ...sourcesUnder('apps')]
  .map(path => path.split('\\').join('/'));

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length > MAX_FILE_LINES) {
    violations.push(`${file}:1 文件 ${lines.length} 行，超过 ${MAX_FILE_LINES} 行上限`);
  }
  const inCore = file.startsWith('packages/game/src/core/');
  const inFramework = file.startsWith('packages/framework/');
  const inGame = file.startsWith('packages/game/');
  const inWxPlatform = file.startsWith('apps/wx/src/platform/');
  const inWxApp = file.startsWith('apps/wx/');

  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const hit = (pattern, message) => {
      pattern.lastIndex = 0;
      if (pattern.test(line)) violations.push(`${file}:${index + 1} ${message}\n      > ${line.trim()}`);
    };
    if (inCore) {
      hit(/from ['"]three['"]/g, 'core 禁止依赖 three');
      hit(/\bMath\.random\b/g, 'core 禁止 Math.random（用 RunRng）');
    }
    if (inFramework || inGame) {
      for (const [pattern, message] of DOM_GLOBALS) hit(pattern, message);
      for (const [pattern, message] of APP_IMPORTS) hit(pattern, message);
    }
    if (!inFramework && !inGame && !inWxPlatform && !inWxApp) hit(WX_BAN[0], WX_BAN[1]);
    if (inWxPlatform) for (const [pattern, message] of WEB_GLOBALS) hit(pattern, message);
  });
}

if (violations.length) {
  console.error('架构禁令检查失败：');
  violations.forEach(violation => console.error('  ✗', violation));
  process.exit(1);
}
console.log(`架构禁令检查通过（${files.length} 个源文件：框架/游戏无宿主越界，WX 全局仅在平台目录，全部 ≤${MAX_FILE_LINES} 行）`);
