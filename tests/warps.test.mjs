/**
 * Stormspire 三事件 sim 测试（时空隧道 / 金币雨 / 低重力带，warps.ts + stepFx/trackGen/movement 联动）。
 * 断言面：parse 硬门（缺块/坏值 ⇒ null ⇒ 表空）、spawnWarps 与反重力区互斥、warpAt/inWarpClear/
 * lowGravAt/inRainWin 查询、stepFx 派生（warp/warpRemain/lowGravRemain/coinRain 一次性预告）、
 * 金币河/雨铺设（数量与正弦可复现、同 seed 逐字节一致）、低重力跳跃最高点更高（movement 联动）、
 * 未配置/坏值降级 ⇒ state 三字段恒 0 且与基线轨迹逐字节一致（rng 序列不动的硬门）。
 * 从 packages/game/dist 导入：需先构建（node_modules/typescript/bin/tsc -b）才能跑。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { initialRunnerState } from '../packages/game/dist/core/sim/simTypes.js';
import { stepFx } from '../packages/game/dist/core/sim/stepFx.js';
import {
  RAIN_WARN_M, inRainWin, inWarpClear, layRainCoins, layWarpCoins, lowGravAt, parseLowGravCfg, parseRainCfg,
  parseWarpCfg, spawnLowGravs, spawnRains, spawnWarps, warpAt,
} from '../packages/game/dist/core/sim/warps.js';
import { parseZoneCfg, spawnZones } from '../packages/game/dist/core/sim/zones.js';
import { RunRng } from '../packages/game/dist/core/rng.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const raw = Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));
delete raw.game.params.revive; // 机制断言在无复活下验证（对齐 runnerSim.test.mjs 口径）

/** 净空世界内容：单一空模板 + 空投掉落表；可选保留 antigrav（隔离对照组用），三事件块跟随 raw 配置 */
function blankFix(withBlocks = true, withAntigrav = false) {
  const c = structuredClone(raw);
  c.obstacles.patterns = [{ id: 'pat_test_blank', minDifficulty: 0, weight: 1, lengthSegments: 4, cells: [] }];
  c.obstacles.difficultyCurve = [{ by: 0, poolWeights: { pat_test_blank: 1 } }];
  c.obstacles.dropTable = { weights: {} };
  delete c.obstacles.zap;
  if (!withAntigrav) delete c.obstacles.antigrav;
  if (!withBlocks) { delete c.obstacles.warp; delete c.obstacles.coinRain; delete c.obstacles.lowGrav; }
  return c;
}

/** stepFx 单测上下文（FxCtx 全字段；表默认空=恒零变化基线） */
function mkCtx(extra = {}) {
  return { tideAware: false, surgeFired: false, crossings: [], lastHits: 0, laneWidth: 2.2, zones: [],
    warps: [], rains: [], lows: [], lastRain: -1, lastWarp: 0, lowGravMulNow: 1, ...extra };
}

test('parse 硬门：缺块/缺字段/非有限正数/超域 ⇒ null（表恒空=全主题零变化）', () => {
  assert.ok(parseWarpCfg(raw.obstacles));
  assert.equal(parseWarpCfg({}), null);
  assert.equal(parseWarpCfg({ warp: { lengthM: 120, everyM: 700 } }), null); // 缺 fromM
  assert.equal(parseWarpCfg({ warp: { lengthM: -5, everyM: 700, fromM: 400 } }), null); // 非正数
  assert.equal(parseWarpCfg({ warp: { lengthM: NaN, everyM: 700, fromM: 400 } }), null); // 非有限
  assert.ok(parseRainCfg(raw.obstacles));
  assert.equal(parseRainCfg({ coinRain: { spanM: 40, everyM: 350, fromM: 250, count: 24 } }), null); // 缺 ampY
  assert.equal(parseRainCfg({ coinRain: { spanM: 40, everyM: 350, fromM: 250, count: 0, ampY: 1.6 } }), null); // count 非正
  assert.ok(parseLowGravCfg(raw.obstacles));
  assert.equal(parseLowGravCfg({ lowGrav: { lengthM: 70, everyM: 620, fromM: 500, gMul: 0 } }), null); // ∉(0,1)
  assert.equal(parseLowGravCfg({ lowGrav: { lengthM: 70, everyM: 620, fromM: 500, gMul: 1 } }), null);
  assert.equal(parseLowGravCfg({ lowGrav: { lengthM: 70, everyM: 620, fromM: 500, gMul: 1.5 } }), null);
  assert.equal(parseLowGravCfg({ lowGrav: { lengthM: 70, everyM: 620, fromM: 500 } }), null); // 缺 gMul
});

test('spawnWarps 互斥硬规则：zones [600,690]+[1100,1190] ⇒ [400,520) 收、[1100,1220) 撞余量窗跳过', () => {
  const zones = [];
  spawnZones(zones, 0, 1104, parseZoneCfg(raw.obstacles)); // everyM=500 fromM=600 ⇒ [600,690) 与 [1100,1190)
  assert.deepEqual(zones.map(z => [z.startM, z.endM]), [[600, 690], [1100, 1190]]);
  const warps = [];
  const cur = spawnWarps(warps, 0, 1220, parseWarpCfg(raw.obstacles), zones);
  assert.deepEqual(warps.map(w => [w.startM, w.endM]), [[400, 520]]); // 候选 1100 落 zone [1064,1226] 余量窗 ⇒ 跳过
  assert.equal(cur, 1800); // 游标照常推进（跳过也 += everyM）
  assert.equal(spawnWarps([], 0, 5000, null, []), 0); // 未配置=游标不动
  // spawnLowGravs 双向互斥：候选 500 撞 warp [400,520) 余量窗 [364,556] ⇒ 跳过（低重力带不与隧道叠加）
  const lows = [];
  spawnLowGravs(lows, 0, 700, parseLowGravCfg(raw.obstacles), zones, [{ startM: 400, endM: 520 }]);
  assert.deepEqual(lows, []);
  // 无冲突 ⇒ 正常登记（zones/warps 均空）
  const lows2 = [];
  spawnLowGravs(lows2, 0, 600, parseLowGravCfg(raw.obstacles), [], []);
  assert.deepEqual(lows2.map(l => [l.startM, l.endM, l.gMul]), [[500, 570, 0.45]]);
});

test('warpAt / lowGravAt 二分：命中/未命中边界（[start,end) 半开）；inWarpClear 段内+前后 12m', () => {
  const segs = [{ startM: 400, endM: 520 }];
  assert.equal(warpAt(segs, 399.9), null);
  assert.equal(warpAt(segs, 400), segs[0]);
  assert.equal(warpAt(segs, 519.9), segs[0]);
  assert.equal(warpAt(segs, 520), null);
  assert.equal(warpAt([], 460), null); // 空表恒 null
  const lows = [{ startM: 500, endM: 570, gMul: 0.45 }];
  assert.equal(lowGravAt(lows, 499.9), null);
  assert.equal(lowGravAt(lows, 500)?.gMul, 0.45);
  assert.equal(lowGravAt(lows, 569.9)?.gMul, 0.45);
  assert.equal(lowGravAt(lows, 570), null);
  assert.equal(inWarpClear(segs, 387.9), false); // 入口前 12m 外
  assert.equal(inWarpClear(segs, 388), true);    // 入口前 12m 含左边界
  assert.equal(inWarpClear(segs, 460), true);    // 段内
  assert.equal(inWarpClear(segs, 532), true);    // 出口后 12m 含右边界
  assert.equal(inWarpClear(segs, 532.1), false);
  assert.equal(inWarpClear([], 460), false);
});

test('spawnRains/inRainWin：窗口预注册（避开反重力区）与 [start,end) 半开判定', () => {
  const wins = [];
  const cfg = parseRainCfg(raw.obstacles);
  spawnRains(wins, 0, 260, cfg, []); // 无 zones：照常登记
  assert.deepEqual(wins.map(w => [w.startM, w.endM]), [[250, 290]]);
  assert.equal(inRainWin(wins, 249.9), false);
  assert.equal(inRainWin(wins, 250), true);
  assert.equal(inRainWin(wins, 289.9), true);
  assert.equal(inRainWin(wins, 290), false);
  // 互斥：候选窗落进反重力区体±净空则跳过（区内玩家在天花板，地面雨币不可达）
  const wins2 = [];
  spawnRains(wins2, 0, 960, cfg, [{ startM: 600, endM: 690, ceilH: 4.6 }]);
  assert.deepEqual(wins2.map(w => w.startM), [250, 950]); // 600 窗撞 [600,690) 被跳过
});

test('stepFx：区内 warp=1/warpRemain 递减、区外归 0；lowGravRemain/gMul 透传', () => {
  const ev = [];
  const ctx = mkCtx({ warps: [{ startM: 400, endM: 520 }], lows: [{ startM: 400, endM: 470, gMul: 0.45 }] });
  const s = initialRunnerState();
  s.distance = 460; stepFx(s, 0.2, ev, [], ctx);
  assert.equal(s.warp, 1); assert.equal(s.warpRemain, 60); assert.equal(s.lowGravRemain, 10); assert.equal(ctx.lowGravMulNow, 0.45);
  s.distance = 470; stepFx(s, 0.2, ev, [], ctx);
  assert.equal(s.warpRemain, 50); assert.equal(s.lowGravRemain, 0); assert.equal(ctx.lowGravMulNow, 1); // 出低重力带倍率回 1
  s.distance = 530; stepFx(s, 0.2, ev, [], ctx);
  assert.equal(s.warp, 0); assert.equal(s.warpRemain, 0); // 出隧道归 0
});

test('stepFx：coinRain 一次性事件且提前 30m（RAIN_WARN_M）预告；多窗口逐个推进', () => {
  const cfg = { spanM: 40, count: 24, ampY: 1.6 };
  const ctx = mkCtx({ rains: [{ startM: 1000, endM: 1040, cfg }, { startM: 1350, endM: 1390, cfg }] });
  const s = initialRunnerState(); const ev = [];
  s.distance = 1000 - RAIN_WARN_M - 0.1; stepFx(s, 0.2, ev, [], ctx);
  assert.equal(ev.length, 0); // 未到预告位
  s.distance = 1000 - RAIN_WARN_M; stepFx(s, 0.2, ev, [], ctx);
  assert.deepEqual(ev.map(e => e.type), ['coinRain']); assert.equal(ev[0].startM, 1000); // 恰好提前 30m 触发
  s.distance = 1100; stepFx(s, 0.2, ev, [], ctx);
  s.distance = 1319.9; stepFx(s, 0.2, ev, [], ctx);
  assert.equal(ev.length, 1); // 一次性：同窗不重复、下一窗未到预告位
  s.distance = 1320; stepFx(s, 0.2, ev, [], ctx);
  assert.equal(ev.length, 2); assert.equal(ev[1].startM, 1350);
  s.distance = 1400; stepFx(s, 0.2, ev, [], ctx);
  assert.equal(ev.length, 2);
});

test('stepFx：未配置三表 ⇒ 全 0/倍率 1/无事件（恒零变化基线）', () => {
  const ctx = mkCtx(); const s = initialRunnerState(); const ev = [];
  for (const d of [0, 200, 460, 500, 900]) { s.distance = d; stepFx(s, 0.2, ev, [], ctx); }
  assert.equal(s.warp, 0); assert.equal(s.warpRemain, 0); assert.equal(s.lowGravRemain, 0);
  assert.equal(ctx.lowGravMulNow, 1); assert.equal(ctx.lastRain, -1); assert.equal(ev.length, 0);
});

test('金币河 layWarpCoins：数量=段长/间距、正弦 lane 与 y=0.55 可复现（重铺逐字节一致）', () => {
  const coins = [];
  layWarpCoins(coins, { startM: 400, endM: 520 }, 2.2, 1.5);
  assert.equal(coins.length, 80); // 120/1.5
  assert.equal(coins[0].worldZ, 400); assert.equal(coins[79].worldZ, 518.5);
  assert.equal(coins[0].lane, 0); // sin(0)=0 居中起步
  assert.equal(coins[10].lane, Math.sin(15 * 0.35)); // 段内里程×0.35 正弦蛇形
  for (const c of coins) assert.equal(c.y, 0.55); // 贴地跑吃
  const again = [];
  layWarpCoins(again, { startM: 400, endM: 520 }, 2.2, 1.5);
  assert.deepEqual(again, coins);
});

test('金币雨 layRainCoins：count 枚均布+y/lane 公式；同 seed 两次逐字节一致、异 seed 不同', () => {
  const win = { startM: 250, endM: 290, cfg: { spanM: 40, count: 24, ampY: 1.6 } };
  const a = [], b = [], c2 = [];
  layRainCoins(a, win, 2.2, new RunRng(99));
  layRainCoins(b, win, 2.2, new RunRng(99));
  layRainCoins(c2, win, 2.2, new RunRng(123));
  assert.equal(a.length, 24);
  assert.deepEqual(b, a); // 同 seed 同布局（确定性硬门）
  assert.notDeepEqual(c2, a); // rng 抖动真实生效
  assert.equal(a[0].y, 0.5); // sin(0)=0 基准高
  assert.equal(a[5].y, 0.5 + 1.6 * Math.sin(5 * 0.9)); // y=0.5+ampY×sin(i×0.9)
  assert.equal(a[5].lane, Math.sin(5 * 0.5)); // 蛇形 sin(i×0.5)
  assert.ok(a.some(c => c.y > 1.2), '部分金币应离地要跳吃');
});

test('低重力带 movement 联动：同起跳速度下最高点显著更高（g×gMul，起跳速度不变）', () => {
  // 定制带 [100,350)：不与 warp [400,520) 余量窗相交（互斥规则会让重叠带整段不出生）；对照组删 lowGrav 块
  const fix = (withLowGrav) => {
    const c = blankFix(true);
    c.obstacles.lowGrav = { lengthM: 250, everyM: 9999, fromM: 100, gMul: 0.45 };
    if (!withLowGrav) delete c.obstacles.lowGrav;
    return c;
  };
  const run = (c) => {
    const sim = new RunnerSim(c, 4242);
    while (sim.state.distance < 150) sim.step();
    const remain = sim.state.lowGravRemain;
    sim.applyAction('jump');
    const vy0 = sim.state.vy; // 起跳速度（积分前采样：步进后已含一帧重力，两变体本就不同）
    let apex = 0;
    for (let i = 0; i < 180; i++) { sim.step(); apex = Math.max(apex, sim.state.y); }
    return { apex, vy0, remain };
  };
  const lo = run(fix(true)), hi = run(fix(false));
  assert.ok(lo.remain > 0, '跳跃点应在低重力带内');
  assert.equal(hi.remain, 0, '对照组应无低重力带');
  assert.equal(lo.vy0, hi.vy0); // 起跳速度不变
  assert.ok(lo.apex > hi.apex + 1, `低重力最高点应更高（${lo.apex} vs ${hi.apex}）`);
});

test('隧道集成（净空世界+真实三事件配置）：段内无障碍/无 cross 判定体、金币河落位、coinRain 预告', () => {
  const c = blankFix(true);
  c.obstacles.zap = { ref: 'obs_lightning_circle', everyM: 200, fromM: 400 }; // 首枚恰在隧道入口（应被避让）
  const sim = new RunnerSim(c, 4242);
  while (sim.state.distance < 100) sim.step(); // 阶段 1：隧道已预注册、角色未进段（金币尚未被身后回收）
  const river = sim.coinsArr.filter(co => !co.flight && !co.taken && co.worldZ >= 400 && co.worldZ < 520);
  assert.equal(river.length, 80, '隧道段金币河应整段铺设');
  for (const co of river) { assert.equal(co.y, 0.55); assert.equal(co.lane, Math.sin((co.worldZ - 400) * 0.35)); }
  const rainCoins = sim.coinsArr.filter(co => !co.flight && !co.taken && co.worldZ >= 250 && co.worldZ < 290);
  assert.equal(rainCoins.length, 24, '金币雨窗口应铺 24 枚');
  const rainEvents = [];
  while (sim.state.distance < 540) { // 阶段 2：穿过隧道
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === 'coinRain') rainEvents.push(e);
  }
  assert.deepEqual(rainEvents.map(e => e.startM), [250]); // 首窗预告恰好一次（次窗 600 未到预告位）
  for (const o of sim.obstacles) {
    assert.ok(o.worldZ < 388 || o.worldZ > 532, `隧道净空内出现障碍 cls=${o.cls}@${o.worldZ}`);
  }
  for (const cr of sim.crossings) {
    assert.ok(cr.worldZ < 388 || cr.worldZ > 532, `隧道净空内出现穿越体 ${cr.kind}@${cr.worldZ}`);
  }
  assert.ok(sim.obstacles.some(o => o.zap === true && o.worldZ > 532), 'zap 系统仍活着（候选 600 应出生在净空外）');
  // 低重力带 [500,570) 与隧道 [400,520) 余量互斥 ⇒ 本段 lows 恒空
  assert.deepEqual(sim.gen.lows, []);
  assert.equal(sim.state.warp, 0); assert.equal(sim.state.warpRemain, 0); // 540 已出隧道
});

test('隧道状态派生（RunnerSim）：段内 warp=1、warpRemain 随推进递减', () => {
  const sim = new RunnerSim(blankFix(true), 4242);
  while (sim.state.distance < 455) sim.step();
  assert.equal(sim.state.warp, 1);
  const r1 = sim.state.warpRemain;
  assert.ok(r1 > 60 && r1 <= 65, `455m 处 warpRemain 应 ≈65（实际 ${r1}）`);
  sim.step();
  assert.ok(sim.state.warpRemain < r1, 'warpRemain 应随推进递减');
  while (sim.state.distance < 530 && sim.state.warp === 1) sim.step();
  assert.equal(sim.state.warp, 0); assert.equal(sim.state.warpRemain, 0);
});

test('未配置/坏值降级硬门：三块全删或全坏 ⇒ state 三字段恒 0 且轨迹与基线逐字节一致', () => {
  const run = (c) => {
    const sim = new RunnerSim(c, 777);
    const trace = [];
    for (let i = 0; i < 1200; i++) {
      sim.step();
      const s = sim.state;
      trace.push([s.distance, s.y, s.vy, s.coins, s.score, s.warp, s.warpRemain, s.lowGravRemain, s.flip]);
      assert.equal(s.warp, 0); assert.equal(s.warpRemain, 0); assert.equal(s.lowGravRemain, 0);
    }
    return trace;
  };
  const off = run(blankFix(false));
  const bad = blankFix(false);
  bad.obstacles.warp = { lengthM: -5, everyM: 700, fromM: 400 };
  bad.obstacles.coinRain = { spanM: 40, everyM: 350, fromM: 250, count: 0, ampY: 1.6 };
  bad.obstacles.lowGrav = { lengthM: 70, everyM: 620, fromM: 500, gMul: 1.5 };
  assert.deepEqual(run(bad), off); // 坏值 ⇒ null ⇒ 表空 ⇒ rng 序列不动（逐字节一致）
});
