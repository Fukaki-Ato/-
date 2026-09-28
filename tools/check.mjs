/**
 * 一键质量检查：编译 + 单元测试 + 配置校验 + 架构禁令 + WX bundle 校验。
 * 用法：node tools/check.mjs（或 npm run check）
 * 全部通过输出 ALL PASS；任何一步失败立即以该步退出码退出。
 * 根 tsconfig.json 是 project-reference 入口；测试消费编译产物。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(join(root, 'node_modules/typescript/bin/tsc'))) {
  console.error('缺少 node_modules（npm workspaces 依赖）：请先在仓库根执行 npm install');
  process.exit(1);
}

const STEPS = [
  ['编译 TypeScript（tsc -b）', ['node_modules/typescript/bin/tsc', '-b']],
  ['运行单元测试', ['--test', 'tests/*.test.mjs']],
  ['配置校验', ['tools/validate-config.mjs']],
  ['架构禁令检查', ['tools/check-import-rules.mjs']],
  ['微信小游戏 bundle 校验（--dry 不发布）', ['tools/build-wx.mjs', '--dry']],
];

STEPS.forEach(([name, args], i) => {
  console.log(`[${i + 1}/${STEPS.length}] ${name}...`);
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\n############ 第 ${i + 1} 步「${name}」失败，请先修复 ############`);
    process.exit(r.status ?? 1);
  }
});
console.log('\n============ ALL PASS ============');
