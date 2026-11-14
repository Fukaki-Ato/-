/**
 * 分道具拾取统计（sim 层）：SimEvent {type:'pickup', itemRef}（collect.ts）是唯一带道具 id 的
 * 来源，而 drainEvents 每帧被渲染层消费、死亡收口时事件早已排空——per-id 统计必须在 sim 创建时
 * 安装观察器，包装 drainEvents 透传事件（monkey-patch 先例=recorder.ts 的 recordMissionRun）。
 * 服务端回放（apps/server/src/replay.mjs）在同一事件集上打点，两端口径一致。
 */
import type { RunnerSim } from './runnerSim.js';
import type { SimEvent } from './simTypes.js';

/** 包装 sim.drainEvents：每个 pickup 事件回调 itemRef（其余事件原样透传给既有消费方）。
 *  返回还原函数——卸载观察器，恢复原方法（局末收口时调用，快照统计在还原后读）。 */
export function observePickupEvents(sim: RunnerSim, onPickup: (itemRef: string) => void): () => void {
  const drain = sim.drainEvents;
  sim.drainEvents = function (this: RunnerSim): SimEvent[] {
    const out = drain.call(this);
    for (const event of out) if (event.type === 'pickup') onPickup(event.itemRef);
    return out;
  };
  return () => { sim.drainEvents = drain; };
}
