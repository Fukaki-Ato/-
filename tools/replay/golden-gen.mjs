/**
 * tools/replay/golden-gen.mjs — golden-master 基线生成/校验（S19a）
 * 矩阵：5 条赛道 seed × 3 个角色 = 15 例 → tests/golden/g-<seed>-<charId>.json
 * 每例自包含：{ goldenVersion, replay(完整输入), expected(复跑摘要) }，diff 即报警。
 *
 * 用法：
 *   node tools/replay/golden-gen.mjs           # 只校验：内存重生成与磁盘逐字节比对，不写盘
 *   node tools/replay/golden-gen.mjs --update  # 显式重生成写盘（sim/编排/配置有意变更后）
 * 无 --update 绝不落盘——防止基线静默漂移（tests/golden.test.mjs 是 CI 门禁，本脚本是排查工具）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { makeReplay } from './recorder.mjs';
import { diffResults } from './report.mjs';
import { loadContent, runReplay } from './runner.mjs';

/** golden 复跑的帧数上限（1 分钟）：脚本化输入下绝大多数局在此前已死亡，控制基线文件体积 */
export const GOLDEN_MAX_FRAMES = 3600;
/** 固定赛道 seed 集（5 条，跨 uint32 取值域抽样） */
export const SEEDS = [101, 777, 4242, 65001, 20260922];
/** 固定角色集（3 个：R/SR/SR，技能与被动各不相同，见 config/characters.json） */
export const CHARS = ['char_volt', 'char_ama', 'char_kaze'];

export const GOLDEN_DIR = fileURLToPath(new URL('../../tests/golden/', import.meta.url));
export const caseName = (seed, charId) => `g-${seed}-${charId}.json`;

/** 在内存中重生成一例 golden（replay + expected 复跑摘要） */
export function buildCase(content, seed, charId) {
  const replay = makeReplay(seed, charId, { maxFrames: GOLDEN_MAX_FRAMES });
  return { goldenVersion: 1, replay, expected: runReplay(content, replay) };
}

/** 序列化：2 空格缩进 + 末尾换行；无时间戳、字段序=构造序，逐字节可复现 */
export function serialize(golden) {
  return `${JSON.stringify(golden, null, 2)}\n`;
}

function update(content) {
  mkdirSync(GOLDEN_DIR, { recursive: true });
  let n = 0;
  for (const seed of SEEDS) {
    for (const charId of CHARS) {
      const file = join(GOLDEN_DIR, caseName(seed, charId));
      writeFileSync(file, serialize(buildCase(content, seed, charId)), 'utf8');
      n++;
    }
  }
  console.log(`golden 基线已重生成：${n} 例 → tests/golden/（${SEEDS.length} seeds × ${CHARS.length} 角色）`);
}

/** 只校验模式：重生成不落盘，与磁盘内容逐字节比对；漂移时打印字段级 diff 并以非零码退出 */
function verify(content) {
  const drift = [];
  for (const seed of SEEDS) {
    for (const charId of CHARS) {
      const name = caseName(seed, charId);
      const file = join(GOLDEN_DIR, name);
      const fresh = buildCase(content, seed, charId);
      if (!existsSync(file)) {
        drift.push(`${name}: 基线文件缺失（运行 node tools/replay/golden-gen.mjs --update 生成）`);
        continue;
      }
      // 归一行尾后比对：core.autocrlf=true 的机器检出为 CRLF，serialize 产出 LF，
      // 二者仅行尾差异不算漂移（内容漂移仍会被 diffResults 报出）。
      const onDisk = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      if (onDisk === serialize(fresh)) {
        console.log(`  ok  ${name}`);
        continue;
      }
      let detail;
      try {
        detail = diffResults(JSON.parse(onDisk).expected, fresh.expected);
      } catch {
        detail = ['  (磁盘文件不是合法 golden JSON)'];
      }
      drift.push(`${name}: 与重生成结果漂移\n${detail.join('\n')}`);
    }
  }
  if (drift.length) {
    console.error(`golden 校验失败（${drift.length} 例漂移，未写盘）：`);
    drift.forEach((d) => console.error(`  ✗ ${d}`));
    console.error('确认变更是有意的之后，用 --update 显式重生成基线。');
    process.exit(1);
  }
  console.log(`golden 校验通过：${SEEDS.length * CHARS.length} 例与磁盘逐字节一致（未写盘）`);
}

function main() {
  const content = loadContent();
  if (process.argv.slice(2).includes('--update')) update(content);
  else verify(content);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
