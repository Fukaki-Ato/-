/**
 * 全赛道跑步连续性回归：15 例 golden（5 赛道 seed × 3 角色）逐帧重放，
 * 把每帧 (RunnerState, FxState) 喂给 pickClip，统计「地面跑帧中 Run 的占比」。
 * 为什么锁这个：Turn/Land 两个一次性窗口曾把 Run 切碎（每 1s 换道时 Run 占比 44.9%），
 * 用户实机反馈「跑步动作不持续」。本测试是防回退的量化门禁——
 * 任何人把 TURN_S/LAND_S 调大、或在 ⑦/⑧ 之间插入新分支，都会直接看到这里掉百分比。
 * 依赖 core/render 的 dist 产物（先 npm run build）；golden 文件由 golden-gen.mjs 管。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { STEP_DT } from '../packages/game/dist/core/sim/simTypes.js';
import { createClipContext, pickClip } from '../packages/game/dist/render/animClips.js';
import { loadContent, eventToAction } from '../tools/replay/runner.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const content = loadContent(root);
const SEEDS = [101, 777, 4242, 65001, 20260922];
const CHARS = ['char_volt', 'char_ama', 'char_kaze'];
/** 判定「本帧在跑」的最小帧位移（米）/ 离地余量（米）：与 animClips.ts 内部口径一致 */
const MOVED_EPS = 0.02, AIRBORNE_EPS = 0.05;

/** 单例 golden 逐帧扫描：返回 clip 直方图与「地面跑帧中 Run 占比」 */
function scanCase(seed, charId) {
  const golden = JSON.parse(readFileSync(join(root, 'tests', 'golden', `g-${seed}-${charId}.json`), 'utf8'));
  const replay = golden.replay;
  const sim = new RunnerSim(content, replay.seed, replay.charId || undefined);
  const ctx = createClipContext();
  const groundHist = {};
  let frames = 0, groundFrames = 0, cursor = 0;
  while (frames < replay.maxFrames) {
    while (cursor < replay.inputs.length && replay.inputs[cursor].frame === frames) {
      const action = eventToAction(replay.inputs[cursor++]);
      if (action) sim.applyAction(action);
    }
    sim.step();
    frames++;
    const s = sim.state, fx = sim.fx;
    const moved = frames > 1 && s.distance - (ctx.prevDist ?? s.distance) > MOVED_EPS;
    const pick = pickClip(s, fx, ctx, STEP_DT, null);
    // 地面跑帧：活着 + 贴地（含车顶/坡道支撑面）+ 前进中 + 无技能/受击/滑铲状态
    if (s.alive && s.y <= s.supportY + AIRBORNE_EPS && !s.sliding
      && s.stunT <= 0 && fx.flyT <= 0 && !s.gliding && moved) {
      groundFrames++;
      groundHist[pick.clip] = (groundHist[pick.clip] ?? 0) + 1;
    }
    if (!s.alive) break;
  }
  return { frames, groundFrames, groundRun: groundHist.Run ?? 0, groundHist };
}

test('真实赛道：地面跑帧中 Run 占比 ≥ 60%（15 例 golden 汇总）', () => {
  let ground = 0, run = 0;
  for (const seed of SEEDS) {
    for (const charId of CHARS) {
      const c = scanCase(seed, charId);
      assert.ok(c.groundFrames > 100, `${seed}-${charId} 地面跑帧应 >100，实际 ${c.groundFrames}（golden 输入或 sim 变更？）`);
      ground += c.groundFrames;
      run += c.groundRun;
    }
  }
  const pct = (100 * run) / ground;
  // 实测（TURN_S=0.2/LAND_S=0.3）：69.5%；阈值留余量防平台浮点噪声，但 56.8% 的旧值必须挂
  assert.ok(pct >= 60, `地面跑帧 Run 占比 ${pct.toFixed(1)}% < 60%：Turn/Land 窗口又把 Run 切碎了？`);
});

test('真实赛道：单例地面跑帧 Run 占比 ≥ 45%（防个别 seed 劣化）', () => {
  for (const seed of SEEDS) {
    for (const charId of CHARS) {
      const c = scanCase(seed, charId);
      const pct = c.groundFrames ? (100 * c.groundRun) / c.groundFrames : 100;
      assert.ok(pct >= 45, `${seed}-${charId} 地面跑帧 Run 占比 ${pct.toFixed(1)}% < 45%（实测最低 55.3%）`);
    }
  }
});
