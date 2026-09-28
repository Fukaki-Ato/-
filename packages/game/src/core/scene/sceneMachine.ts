/**
 * 场景状态机（core 层）
 * 对应文档：docs/02 §5（场景机 Boot → Login → Menu → Run → Result → Menu）。
 * M0 只需要状态定义与切换钩子；具体页面在 ui 层实现。
 */

export interface SceneDef {
  /** 进入场景时调用；ctx 为透传参数（如配置内容、退出原因） */
  onEnter?(ctx?: unknown): void;
  /** 离开场景时调用（清理输入监听、暂停渲染等） */
  onExit?(): void;
}

export interface SceneMachine<S extends string> {
  current(): S;
  go(to: S, ctx?: unknown): void;
  /** 订阅切换事件（UI 用来决定显示哪个页面） */
  onChange(cb: (next: S, prev: S) => void): () => void;
}

export function createSceneMachine<S extends string>(scenes: Record<S, SceneDef>, initial: S): SceneMachine<S> {
  let now = initial;
  const listeners: Array<(next: S, prev: S) => void> = [];
  return {
    current: () => now,
    go(to, ctx) {
      if (to === now) return;              // 重复进入同一场景直接忽略
      if (!(to in scenes)) throw new Error(`未知场景: ${to}`);
      const prev = now;
      scenes[prev]?.onExit?.();
      now = to;
      scenes[to]?.onEnter?.(ctx);
      for (const cb of listeners) cb(to, prev);
    },
    onChange(cb) {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
}

/** 本项目的场景名常量（docs/02 §5 场景机；demo 场景已由 M1 真实跑酷 run 取代） */
export type SceneName = 'boot' | 'login' | 'menu' | 'run' | 'result';
