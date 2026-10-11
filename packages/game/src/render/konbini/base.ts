/**
 * 微缩模型的公共基座：正方形底座 + 沿两条边贴边而过的街角路面。
 * 便利店与小花园共用这一套（同一块地皮上换内容），既省顶点数据，
 * 也让两种道具摆在跑道上看着像同一条街的连续街角，而不是两套不相干的东西。
 */
import { C } from './palette.js';
import type { Diorama } from './kit.js';

/** 底座边长（米）；顶面 y=0，底面 y=-0.34，另加一圈深色裙边显厚度 */
export const PLATE = 10;
/** 路缘石内缘：+X 与 +Z 两条边各留一条 1.85m 宽的马路，转角自然成形 */
export const ROAD = 3.15;

/** 正方形底座：顶面即人行道，深色裙边让「可收藏模型」的厚度看得见 */
export function buildBasePlate(d: Diorama): void {
  d.box('body', PLATE, 0.34, PLATE, 0, -0.17, 0, C.plate);
  d.box('body', PLATE + 0.04, 0.14, PLATE + 0.04, 0, -0.39, 0, C.plateEdge);
  // 铺装缝：几片略深的地砖把湿人行道分块，避免一大片纯色
  for (let i = 0; i < 5; i++) {
    const p = -4.2 + i * 1.7;
    d.slab('body', 0.05, 5.6, p, 0.005, -1.9, C.walkSeam);
    d.slab('body', 5.6, 0.05, -1.4, 0.005, p, C.walkSeam);
  }
}

/** 街角两条路：沥青 + 路缘石 + 排水沟盖 + 反光斑马线 + 停车位白框 + 转角护栏 */
export function buildStreet(d: Diorama): void {
  d.slab('body', PLATE - ROAD, PLATE, (ROAD + PLATE) / 2, 0.01, 0, C.road);       // +X 侧（沿 z 走）
  d.slab('body', PLATE, PLATE - ROAD, 0, 0.012, (ROAD + PLATE) / 2, C.roadDark);  // +Z 侧（沿 x 走）
  d.box('body', 0.14, 0.1, PLATE, ROAD, 0.03, 0, C.curb);
  d.box('body', PLATE, 0.1, 0.14, 0, 0.03, ROAD, C.curb);
  for (let i = 0; i < 11; i++) {                                                  // 沟盖：暗缝 + 横向短条
    const q = -4.6 + i * 0.92;
    d.slab('body', 0.26, 0.06, ROAD + 0.24, 0.02, q, C.drain);
    d.slab('body', 0.06, 0.26, q, 0.02, ROAD + 0.24, C.drain);
  }
  for (let i = 0; i < 7; i++) {                                                   // 两条路各一组斑马线
    const p = -2.4 + i * 0.8;
    d.slab('body', 0.44, 1.6, p, 0.05, 4.15, C.paint);
    d.slab('body', 1.6, 0.44, 4.15, 0.048, p, C.paint);
  }
  for (const [w, dd, x, z] of [[1.6, 0.08, 4.15, -3.5], [1.6, 0.08, 4.15, -1.3], [0.08, 2.2, 3.35, -2.4], [0.08, 2.2, 4.95, -2.4]] as const) {
    d.slab('body', w, dd, x, 0.052, z, C.paint);                                  // 停车位白框
  }
  for (let i = 0; i < 4; i++) {                                                   // 转角护栏（避开斑马线）
    const p = -4.6 + i * 0.62;
    d.box('body', 0.08, 0.78, 0.08, p, 0.39, 4.86, C.metal);
    d.box('body', 0.08, 0.78, 0.08, 4.86, 0.39, p, C.metal);
  }
  for (const y of [0.72, 0.44]) {
    d.box('body', 2.1, 0.07, 0.07, -3.67, y, 4.86, y > 0.5 ? C.metal : C.frame);
    d.box('body', 0.07, 0.07, 2.1, 4.86, y - 0.02, -3.67, y > 0.5 ? C.metal : C.frame);
  }
}
