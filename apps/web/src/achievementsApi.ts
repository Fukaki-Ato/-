/**
 * Web 成就 API：AchievementsApiCore 的 web 装配（fetch 同源 cookie）。会话与任务 API 共用
 * （MissionApiCore.ensureConnected 的幂等游客 cookie 会话，不自建）；快照钱包经 wallet.syncRewards
 * 按 rewardLedgerId 幂等导入——与任务奖励同一账本高水位（两快照共用同一游标，漏传只会延迟入账）。
 * 队列/会话/错误语义在 packages/game/flow/achievementApiCore（wx 侧接通后复用同一份）。
 */
import type { RewardWalletStore } from '@tr/game/flow/missionRewardWallet.js';
import type { MissionApiCore, MissionTransport } from '@tr/game/flow/missionApiCore.js';
import { AchievementsApiCore } from '@tr/game/flow/achievementApiCore.js';

export class AchievementsApi extends AchievementsApiCore {
  constructor(session: MissionApiCore, wallet?: RewardWalletStore) {
    super(webTransport(), session, wallet ? snapshot => wallet.syncRewards(snapshot) : undefined);
  }
}

function webTransport(): MissionTransport {
  return {
    async request(path, method, body) {
      const response = await fetch(`/api/achievements${path}`, {
        method, credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
      const data = await response.json().catch(() => null);
      return { status: response.status, data };
    },
  };
}
