/**
 * S19a golden-master 回归（node:test）：逐例重跑 tests/golden/*.json 并与基线逐字段对比。
 * 基线由 tools/replay/golden-gen.mjs --update 显式重生成（无参数只校验不写盘）；
 * 本文件是 CI 门禁——sim 行为/输入编排/配置任何一处漂移都会在这里变红。
 * 失败输出可读 diff：seed/角色/字段路径/期望 vs 实际（diffResults 与 golden-gen 共用一份实现）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent, parseReplay, runReplay } from '../tools/replay/runner.mjs';
import { diffResults } from '../tools/replay/report.mjs';
import { CHARS, SEEDS, caseName } from '../tools/replay/golden-gen.mjs';

const goldenDir = fileURLToPath(new URL('./golden/', import.meta.url));
const files = readdirSync(goldenDir).filter((f) => f.endsWith('.json')).sort();
const content = loadContent();

function readGolden(file) {
  const golden = JSON.parse(readFileSync(join(goldenDir, file), 'utf8'));
  assert.equal(golden.goldenVersion, 1, `${file}: goldenVersion 应为 1`);
  return golden;
}

test('golden 覆盖矩阵：5 条赛道 seed × 3 个角色，15 例齐全', () => {
  assert.equal(SEEDS.length, 5);
  assert.equal(CHARS.length, 3);
  assert.equal(files.length, SEEDS.length * CHARS.length, `golden 文件数应为 ${SEEDS.length * CHARS.length}，实际 ${files.length}`);
  for (const seed of SEEDS) {
    for (const charId of CHARS) {
      assert.ok(files.includes(caseName(seed, charId)), `缺少基线 ${caseName(seed, charId)}（node tools/replay/golden-gen.mjs --update）`);
    }
  }
});

test('golden 基线文件本身是合法的重放格式 v1（parseReplay 严格校验）', () => {
  for (const file of files) {
    const { replay } = readGolden(file);
    assert.doesNotThrow(() => parseReplay(replay), `${file}: replay 段应通过 v1 校验`);
  }
});

for (const file of files) {
  test(`golden 复跑一致：${file}`, () => {
    const { replay, expected } = readGolden(file);
    const actual = runReplay(content, replay);
    const problems = diffResults(expected, actual);
    assert.deepEqual(
      problems,
      [],
      `${file}（seed=${replay.seed} char=${replay.charId || '(默认)'}）${problems.length} 处不一致：\n${problems.join('\n')}\n`
      + '若为有意变更：node tools/replay/golden-gen.mjs --update 重生成基线并审查 diff 后提交。',
    );
  });
}
