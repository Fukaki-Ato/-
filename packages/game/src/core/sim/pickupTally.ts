/**
 * 拾取事件观察器（兼容既有订阅方，包装方式同 recorder.ts 的 recordMissionRun）。
 * 成就/服务端的权威分道具累计直接读取 sim.missionStats.itemOf，不依赖渲染层排空事件；
 * 此观察器仅提供逐次通知，调用方不要把通知再次累加到 missionStats 的快照。
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
