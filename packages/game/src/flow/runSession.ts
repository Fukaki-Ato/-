import type { GameContent } from '../core/config/configTypes.js';
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import { RunnerSim } from '../core/sim/runnerSim.js';
import { hashSeed } from '../core/rng.js';
import { leaderboardRulesId, MAX_RANKED_FRAMES, type LeaderboardService, type RankingFeedback, type RankedTicket } from './leaderboard.js';
import { createRunnerScene } from '../render/runnerScene.js';
import { installTestApi, uninstallTestApi } from './testApi.js';
import type { GameViews, RunSummary } from './views.js';

export interface RunSessionDeps {
  adapter: PlatformAdapter; views: GameViews; content: GameContent; charId: string;
  service?: LeaderboardService; debug?: boolean; test?: boolean; themeId?: string;
  createScene?: typeof createRunnerScene;
  trackRun?: (sim: RunnerSim, seed: number) => () => void;
  onSeed(seed: number): void; onEnd(summary: RunSummary): void;
  onDeath(): void; onCast(): void; onPickup(): void;
}

function feedback(message: string): RankingFeedback & { set(message: string): void } {
  const listeners = new Set<(message: string) => void>();
  return {
    message,
    set(value) { this.message = value; for (const listener of listeners) listener(value); },
    subscribe(listener) { listeners.add(listener); listener(this.message); return () => { listeners.delete(listener); }; },
  };
}

/** Async challenge acquisition is cancellable; unavailable ranking never blocks normal play. */
export function createRunSession(d: RunSessionDeps): { dispose(): void } {
  let cancelled = false;
  let scene: { dispose(): void } | null = null;
  let hud: ReturnType<GameViews['mountHud']> | null = null;
  let activeTicket: RankedTicket | undefined, completed = false;
  let finishTracking: (() => void) | undefined;
  const release = (ticket?: RankedTicket): void => {
    if (ticket && d.service?.cancel) void d.service.cancel(ticket.runId).catch(() => {});
  };
  const eligibleMode = d.service && !d.debug && !d.test;
  const ranking = feedback(d.test || d.debug ? '测试局不参与排行榜' : '本局未连接排行榜');
  const start = (ticket?: RankedTicket): void => {
    if (cancelled) { release(ticket); return; }
    activeTicket = ticket;
    const seed = ticket?.seed ?? hashSeed('run-' + Date.now());
    d.onSeed(seed);
    const sim = new RunnerSim(d.content, seed, d.charId, !!ticket);
    finishTracking = d.trackRun?.(sim, seed);
    const host = { canvas: d.adapter.canvas.mainCanvas(), size: d.adapter.canvas.windowSize() };
    hud = d.views.mountHud();
    hud.update({ score: 0, coins: 0, distance: 0, hits: 0, lives: sim.lives, buffs: [], skill: null });
    scene = (d.createScene ?? createRunnerScene)(host, d.adapter, sim, d.content, {
      onHud: h => hud?.update(h),
      onEnd: summary => {
        if (cancelled) return;
        completed = true;
        if (ticket) {
          if (sim.replayOverflow || sim.replayFrames > MAX_RANKED_FRAMES) { ranking.set('本局超出比赛上限，不参与排行榜'); release(ticket); }
          else {
            ranking.set('金币前距离成绩校验中…');
            const replay = { runId: ticket.runId, frames: sim.replayFrames, inputs: sim.replayInputs.slice() };
            void d.service!.submit(replay).then(
              result => ranking.set(result.accepted ? '金币前距离成绩已入全服榜' : '成绩未通过排行榜校验'),
              () => ranking.set('成绩上传失败，请检查网络'),
            );
          }
        }
        d.onEnd({ ...summary, ranking, beforeFirstCoin: sim.firstCoinRecord.snapshot(summary) });
      },
      onDeath: d.onDeath, onCast: d.onCast, onPickup: d.onPickup, debug: d.debug,
    }, { themeId: d.themeId });
    if (d.test) installTestApi(sim, d.content);
  };
  if (eligibleMode) {
    const rulesId = leaderboardRulesId(d.content);
    d.views.renderBoot().setStatus('准备排行榜比赛…（Esc 可返回）', false);
    const fallback = (): void => {
      if (!cancelled) { ranking.set('排行榜服务不可用，本局不入榜'); start(); }
    };
    void d.service!.begin(d.charId, rulesId).then(ticket => {
      if (ticket.rulesId !== rulesId) { release(ticket); fallback(); return; }
      start(ticket);
    }, fallback);
  } else start();
  return { dispose() {
    cancelled = true;
    finishTracking?.(); finishTracking = undefined;
    if (!completed) release(activeTicket);
    scene?.dispose(); hud?.dispose();
    if (d.test) uninstallTestApi();
  } };
}
