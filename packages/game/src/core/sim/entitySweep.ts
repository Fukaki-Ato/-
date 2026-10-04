/**
 * 实体回收与冲撞清道（从 runnerSim.ts 拆出，守 300 行模块上限）
 * 分工：runnerSim 负责输入路由与逐帧结算，这里只做「实体数组原地收缩 / 就地标记」这类生命周期杂务。
 * 口径：全部原地 swap-pop 或改标志位，不新建数组、不逐帧分配闭包（docs/02 §8 性能预算）。
 */
import { relZ } from './collision.js';
import type { ObstacleEntity } from './trackGen.js';

/** 清理已掠过角色身后 behindM 的障碍（用碰撞同款深度窗口径，保证与判负一致） */
export function cullObstacles(obstacles: ObstacleEntity[], distance: number, behindM: number): void {
  for (let i = obstacles.length - 1; i >= 0; i--) {
    if (relZ(obstacles[i], distance) <= behindM) continue;
    obstacles[i] = obstacles[obstacles.length - 1];
    obstacles.pop();
  }
}

/** 清理已掠过角色身后 behindM 的按世界 z 定位的实体（金币 / 道具箱 / 云团） */
export function cullByWorldZ<T extends { worldZ: number }>(arr: T[], distance: number, behindM: number): void {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (distance - arr[i].worldZ <= behindM) continue;
    arr[i] = arr[arr.length - 1];
    arr.pop();
  }
}

/** 冲撞体（moveZ<0）沿途撞飞同车道障碍：标记 done+clearT 交渲染下沉，不再阻挡/判负（就地标记，不摘数组） */
export function smashAhead(obstacles: ObstacleEntity[], rusher: ObstacleEntity, nowT: number): void {
  for (const b of obstacles) {
    if (b === rusher || b.done) continue;
    if (b.rideTop === true) continue; // 火车不撞火车：rideTop 载具（列车）不可被冲撞体撞飞
    if (b.lane !== rusher.lane) continue;
    if (Math.abs(b.worldZ - rusher.worldZ) >= (rusher.d + b.d) / 2 + 0.2) continue;
    b.done = true;
    b.passed = true;
    b.clearT = nowT;
  }
}
