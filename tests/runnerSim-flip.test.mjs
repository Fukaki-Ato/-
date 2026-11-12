/**
 * 反重力区 sim 闭环测试（失重图书馆 Phase B，brief §11.2 B-1~B-6）。
 * 同 seed 倒挂 fixture：blanked-pattern 内容（单一空模板=净空世界）+ 真实 antigrav 配置，
 * 断言：flip 轨迹（进区 -1/出区 1）、区内 low 障碍 yEff 镜像判负、单向门（flyT>0 进区
 * 不立即翻转）、区内金币带 y=ceilH−0.65 与倒挂收集、禁铺窗、flipWarn 预告窗（A-2，
 * 距下一区 ≤60m=剩余米数/区内 0/未配置恒 0）、以及
 * 「未配置 antigrav ⇒ flip 恒 1、ceilH 恒 0、既有行为逐字节不变」硬门。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { inNoPlantWindow, parseZoneCfg, spawnZones, zoneAt } from '../packages/game/dist/core/sim/zones.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const raw = Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));
delete raw.game.params.revive; // 机制断言在无复活下验证（对齐 runnerSim.test.mjs 口径）

const ZS = 600, ZE = 690, CEIL = 4.6; // obstacles.json antigrav 数值（B-8 地板：fromM/lengthM/ceilingH）

/** 净空世界内容：单一空模板（不铺任何障碍/教学币）+ 关闪电圈 + 空投掉落表（防拾到喷气背包改变轨迹）；antigrav 可选（硬门对照组用） */
function blankContent(withAntigrav = true) {
  const c = structuredClone(raw);
  c.obstacles.patterns = [{ id: 'pat_test_blank', minDifficulty: 0, weight: 1, lengthSegments: 4, cells: [] }];
  c.obstacles.difficultyCurve = [{ by: 0, poolWeights: { pat_test_blank: 1 } }];
  c.obstacles.dropTable = { weights: {} };
  delete c.obstacles.zap;
  if (!withAntigrav) delete c.obstacles.antigrav;
  return c;
}

test('zones.ts 纯函数：解析降级 / 二分查询 / 禁铺窗边界 / 游标预注册', () => {
  assert.ok(parseZoneCfg(raw.obstacles));
  assert.equal(parseZoneCfg({}), null);
  assert.equal(parseZoneCfg({ antigrav: { lengthM: 90, everyM: 500, fromM: 600 } }), null); // 缺 ceilingH
  assert.equal(parseZoneCfg({ antigrav: { lengthM: -1, everyM: 500, fromM: 600, ceilingH: 4.6 } }), null);
  const zn = { startM: 600, endM: 690, ceilH: 4.6 };
  assert.equal(zoneAt([zn], 599.9), null);
  assert.equal(zoneAt([zn], 600), zn);
  assert.equal(zoneAt([zn], 689.9), zn);   // 区体 [start, end) 半开
  assert.equal(zoneAt([zn], 690), null);
  assert.equal(inNoPlantWindow(zn, 588), true);   // 入口前 12m 含左边界
  assert.equal(inNoPlantWindow(zn, 587.9), false);
  assert.equal(inNoPlantWindow(zn, 600), false);  // 区体起点属区内
  assert.equal(inNoPlantWindow(zn, 689.9), false); // 区体内
  assert.equal(inNoPlantWindow(zn, 690), true);   // 出口后 12m 自区体终点起（半开拼接）
  assert.equal(inNoPlantWindow(zn, 702), true);
  assert.equal(inNoPlantWindow(zn, 702.1), false);
  const zones = [];
  let cur = spawnZones(zones, 0, 504, parseZoneCfg(raw.obstacles)); // target+LEAD(96)=600 恰好登记首个
  assert.deepEqual(zones.map(z => [z.startM, z.endM, z.ceilH]), [[600, 690, 4.6]]);
  cur = spawnZones(zones, cur, 1004, parseZoneCfg(raw.obstacles));
  assert.deepEqual(zones.map(z => z.startM), [600, 1100]);
  assert.equal(spawnZones(zones, cur, 9999, null), cur); // 未配置=游标不动
});

test('硬门：未配置 antigrav ⇒ flip 恒 1、ceilH 恒 0、y 恒 0，且与配置版进区前轨迹逐字节一致', () => {
  const run = c => {
    const sim = new RunnerSim(c, 777);
    const trace = [];
    for (let i = 0; i < 2700; i++) {
      sim.step();
      trace.push([sim.state.distance, sim.state.y, sim.state.vy, sim.state.flip, sim.state.ceilH]);
    }
    return { trace, summary: sim.summary() };
  };
  const off = run(blankContent(false));
  const on = run(blankContent(true));
  assert.ok(on.trace.at(-1)[0] < ZS - 12, 'fixture 应停在禁铺窗之前（未进区段）');
  for (const [, y, , flip, ceilH] of on.trace) {
    assert.equal(flip, 1); assert.equal(ceilH, 0); assert.equal(y, 0);
  }
  assert.deepEqual(off.trace, on.trace); // 同 seed 逐字节一致：antigrav 在进区前零影响
  assert.deepEqual(off.summary, on.summary);
});

test('flip 轨迹：地面步入 flip=-1 升到天花板，出区 flip=1 落回地面，进/出各发一次 flip 事件', () => {
  const sim = new RunnerSim(blankContent(), 777);
  sim.state.t = 20; sim.state.distance = 560; sim.gen.genZ = 560; // 传送近区缩短步数（同 seed 仍确定性）
  sim.step();
  const flips = [];
  let firstFlipD = null, lastFlipD = null, maxY = 0, entered = false;
  for (let i = 0; i < 1200 && sim.state.distance < ZE + 30; i++) {
    sim.step();
    const s = sim.state;
    if (s.distance < ZS) assert.ok(s.flip === 1 && s.y === 0, '进区前应贴地正常重力');
    if (!entered && s.distance >= ZS) entered = true;
    if (s.flip === -1) {
      if (firstFlipD === null) firstFlipD = s.distance;
      lastFlipD = s.distance;
      assert.equal(s.ceilH, CEIL, '倒挂期间 ceilH=区顶高');
      maxY = Math.max(maxY, s.y);
    }
    for (const e of sim.drainEvents()) if (e.type === 'flip') flips.push([e.flip, e.ceilH]);
  }
  assert.ok(entered, 'fixture 应已步入反重力区');
  assert.ok(firstFlipD >= ZS && firstFlipD < ZS + 0.5, `进区即翻转（首个 flip=-1 于 ${firstFlipD}）`);
  assert.ok(lastFlipD < ZE, '出区前保持倒挂');
  assert.ok(maxY > CEIL - 0.05, '倒挂后应钳到天花板平面');
  assert.deepEqual(flips, [[-1, CEIL], [1, 0]]); // 进区/出区各一次，携带区顶高
  assert.equal(sim.state.y, 0, '出区后落回地面');
  assert.equal(sim.state.flip, 1);
  assert.equal(sim.state.ceilH, 0);
});

test('yEff 镜像判负：倒挂站天花板（y=4.6）时区内 low 障碍仍判负（不镜像则 y=4.6>0.9 不应命中）', () => {
  const sim = new RunnerSim(blankContent(), 99);
  sim.state.t = 20; sim.state.distance = ZS + 20; sim.gen.genZ = 10000; // 净空世界+手工布置
  let guard = 0;
  while (sim.state.flip !== -1 && guard++ < 10) sim.step(); // 首步 ensure 预注册区，次步起推导 flip
  assert.equal(sim.state.flip, -1);
  while (sim.state.y < CEIL - 0.05 && guard++ < 120) sim.step(); // 升到天花板
  assert.ok(sim.state.y >= CEIL - 0.05, '应已站上天花板');
  sim.obstacles.push({ obsRef: 'test_low', cls: 'low', w: 2, h: 1.2, d: 0.8, lane: 0, worldZ: sim.state.distance + 2 });
  guard = 0;
  while (sim.state.alive && guard++ < 120) sim.step();
  assert.equal(sim.state.hits, 1, '镜像高度 yEff=0 < 0.75·h ⇒ 判负');
  assert.equal(sim.state.alive, false);
});

test('单向门：flyT>0 进区不立即翻转，滑翔按正常重力落地（y≈0）后才翻转', () => {
  const sim = new RunnerSim(blankContent(), 5);
  sim.state.t = 20; sim.state.distance = 560; sim.gen.genZ = 560;
  sim.step();
  sim.buffs.add('fly', { durationS: 1.8 }, 'test_fly', { distance: sim.state.distance, lane: 0 });
  let entered = false, premature = false, flipAt = null;
  const flips = [];
  for (let i = 0; i < 1500 && sim.state.distance < ZE; i++) {
    sim.step();
    const s = sim.state;
    if (!entered && s.distance >= ZS) {
      entered = true;
      assert.equal(s.flip, 1, '飞进区段瞬间不翻转');
      assert.equal(s.ceilH, CEIL, '但 ceilH 已随区上下文写回');
    }
    if (entered && s.distance < ZE && (sim.fx.flyT > 0 || s.gliding) && s.flip === -1) premature = true;
    if (!flipAt && s.flip === -1) flipAt = { d: s.distance, y: s.y, flyT: sim.fx.flyT, gliding: s.gliding };
    for (const e of sim.drainEvents()) if (e.type === 'flip') flips.push([e.flip, e.ceilH]);
  }
  assert.ok(entered, 'fixture 应已飞进反重力区');
  assert.equal(premature, false, '飞行/滑翔段不得翻转');
  assert.ok(flipAt, '落地后应翻转');
  assert.ok(flipAt.y < 0.5, `翻转发生在贴地之后（翻转时 y=${flipAt.y}）`);
  assert.equal(flipAt.flyT, 0);
  assert.equal(flipAt.gliding, false);
  assert.deepEqual(flips[0], [-1, CEIL]);
});

test('金币带：真实铺设落进区内的地面金币统一改到 y=ceilH−0.65，区外保持地面高度', () => {
  const c = structuredClone(raw); delete c.obstacles.zap;
  const sim = new RunnerSim(c, 4242);
  sim.state.t = 20; sim.state.distance = 500; sim.gen.genZ = 500; // 与生成前沿对齐后铺进区段
  for (let i = 0; i < 4; i++) sim.step(); // ensure 一次铺到 ~820m（zone 过滤与金币改写均在铺设时生效）
  const inZone = sim.coinsArr.filter(co => !co.flight && co.worldZ >= ZS && co.worldZ < ZE);
  assert.ok(inZone.length > 0, 'fixture 需至少一枚区内金币（选 seed 保证）');
  for (const co of inZone) assert.equal(co.y, CEIL - 0.65, `区内金币 y 应为 ${CEIL - 0.65}`);
  for (const co of sim.coinsArr) {
    if (co.flight || (co.worldZ >= ZS - 12 && co.worldZ < ZE + 12)) continue;
    assert.equal(co.y ?? 0.65, 0.65, '区外金币保持地面高度');
  }
});

test('禁铺窗：入口前 12m 与出口后 12m 不铺任何障碍 cell；区内只放 low/high/full/hazard', () => {
  const c = structuredClone(raw); delete c.obstacles.zap;
  const sim = new RunnerSim(c, 4242);
  sim.state.t = 20; sim.state.distance = 500; sim.gen.genZ = 500;
  for (let i = 0; i < 4; i++) sim.step();
  for (const o of sim.obstacles) {
    const inEntry = o.worldZ >= ZS - 12 && o.worldZ < ZS;
    const inExit = o.worldZ >= ZE && o.worldZ <= ZE + 12;
    assert.ok(!(inEntry || inExit), `禁铺窗内出现障碍 ${o.obsRef}@${o.worldZ}`);
    if (o.worldZ >= ZS && o.worldZ < ZE) {
      assert.ok(['low', 'high', 'full', 'hazard'].includes(o.cls), `区内出现禁放类别 ${o.cls}（${o.obsRef}）`);
    }
  }
});

test('flipWarn 预告窗（A-2）：区外距下一区 ≤60m=剩余米数、距区 30m 处 ≈30、区内=0、未配置恒 0', () => {
  const sim = new RunnerSim(blankContent(), 777);
  sim.state.t = 20; sim.state.distance = ZS - 45; sim.gen.genZ = ZS - 45;
  sim.step(); // 首步 ensure 预注册区（同 yEff 镜像测试口径），次步起 stepFx 写 flipWarn
  let at30 = null;
  for (let i = 0; i < 4000 && sim.state.distance < ZS + 5; i++) {
    sim.step();
    const s = sim.state;
    if (s.distance < ZS) {
      assert.ok(s.flipWarn > 0 && s.flipWarn <= 60, `预告窗内 flipWarn∈(0,60]（${s.flipWarn}@${s.distance}）`);
      assert.ok(Math.abs(s.flipWarn - (ZS - s.distance)) < 1e-9, 'flipWarn=距下一区起点的剩余米数');
      if (at30 === null && s.distance >= ZS - 30) at30 = s.flipWarn; // fromM-30 处取样
    } else assert.equal(s.flipWarn, 0, '区内 flipWarn=0');
  }
  assert.ok(at30 !== null && Math.abs(at30 - 30) < 1, `距区 30m 处 flipWarn≈30（实测 ${at30}）`);
  const off = new RunnerSim(blankContent(false), 777); // 无 antigrav 对照：同起点跑同里程
  off.state.t = 20; off.state.distance = ZS - 45; off.gen.genZ = ZS - 45;
  for (let i = 0; i < 600; i++) { off.step(); assert.equal(off.state.flipWarn, 0, '未配置 ⇒ flipWarn 恒 0（全主题零变化）'); }
});

test('倒挂收集：天花板带金币（y=ceilH−0.65）被翻转身体中心命中；地面高度币不吃', () => {
  const sim = new RunnerSim(blankContent(), 7);
  sim.gen.nextZoneZ = Infinity; // 冻结配置游标，手工布置近距 zone（直构 fixture）
  sim.gen.zones.push({ startM: 60, endM: 150, ceilH: CEIL });
  sim.state.t = 20; sim.state.distance = 62; sim.gen.genZ = 10000;
  sim.coinsArr.push({ lane: 0, worldZ: 75, y: CEIL - 0.65 }, { lane: 0, worldZ: 90, y: 0.65 });
  sim.step(); // 首步 ensure 后推导 flip（预注册已见手工 zone）
  assert.equal(sim.state.flip, -1, '区内落地即倒挂');
  for (let i = 0; i < 600 && sim.state.distance < 160; i++) sim.step();
  assert.equal(sim.state.coins, 1, '只吃天花板带币：地面币与倒挂身体中心差 |3.7−0.65|=3.05 > 容差 1.3');
});
