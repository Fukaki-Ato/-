import type { GameFlowDeps } from '@tr/game/flow/mainFlow.js';
import type { OverlayViewsDeps } from '@tr/game/ui/overlayViews.js';
import { recordMissionRun } from '@tr/game/core/missions/recorder.js';
import { MissionApi } from './missionApi.js';
import { createMobileLobby } from './mobileLobby.js';
import { createMissionPanel } from './missionPanel.js';

export function createMissionIntegration(testMode: boolean): {
  lobbyRenderer: NonNullable<OverlayViewsDeps['lobbyRenderer']>;
  trackRun: NonNullable<GameFlowDeps['trackRun']>;
} {
  const api = new MissionApi();
  const lobbyRenderer: NonNullable<OverlayViewsDeps['lobbyRenderer']> = (content, actions, charId, extras) => {
    let disposed = false;
    let panelOpen = false;
    let clear: () => void = () => undefined;
    const showLobby = (): void => {
      if (disposed) return;
      clear(); panelOpen = false;
      clear = createMobileLobby(content, { ...actions, onTasks: () => {
        clear(); panelOpen = true;
        clear = createMissionPanel(api, content, showLobby);
      } }, charId, { coins: (extras?.coins ?? 0) + (api.snapshot?.wallet.coin ?? 0), diamonds: extras?.diamonds ?? 0 });
    };
    showLobby();
    void api.load().then(() => { if (!disposed && !panelOpen) showLobby(); }).catch(() => undefined);
    return () => { disposed = true; clear(); };
  };
  const trackRun: NonNullable<GameFlowDeps['trackRun']> = (sim, seed) => {
    if (testMode) { api.feedback = '调试模式不计任务，请退出调试模式后正常开局'; return () => undefined; }
    api.feedback = '';
    const ticket = api.start(seed, sim.loadout.charId).catch((error: Error) => {
      api.feedback = `本局未连接任务服务：${error.message}`; return null;
    });
    const finishRecording = recordMissionRun(sim);
    return () => {
      try {
        const replay = finishRecording();
        api.settling = ticket.then(async runId => {
          if (runId && replay.frames > 0) await api.finish({ runId, ...replay });
        }).catch((error: Error) => { api.feedback = `进度尚未同步：${error.message}，可在任务页重试`; });
      } catch (error) { api.feedback = (error as Error).message; }
    };
  };
  return { lobbyRenderer, trackRun };
}
