import type { PlayerAccount, PlayerProfile } from '@tr/game/core/playerProfile.js';
import type { LeaderboardService } from '@tr/game/core/leaderboard.js';
import type { WxLike } from './wxTypes.js';
import { CloudApiError, parseCloudLeaderboard, parseCloudProfile, record } from './cloudProtocol.js';
import { parseWelfareSnapshot } from './welfareProtocol.js';
import type { WelfareService } from '@tr/game/core/welfare.js';
import type { CommerceService } from '@tr/game/core/commerce.js';
import type { SyncStorage } from '@tr/framework/platform/platformAdapter.js';
import { createCommerceClient } from './commerceClient.js';

export interface WxCloudClient extends PlayerAccount {
  refresh(): Promise<PlayerProfile>;
  leaderboard: LeaderboardService;
  welfare: WelfareService;
  commerce: CommerceService;
}

/** 空 envId 明确代表本地开发，不初始化云 SDK、更不把本地游客串当作微信身份。 */
export async function connectWxCloud(wx: Pick<WxLike, 'cloud'>, config: unknown, storage?: SyncStorage): Promise<WxCloudClient | null> {
  if (!record(config) || typeof config.envId !== 'string' || typeof config.functionName !== 'string'
    || !config.functionName.trim()) throw new CloudApiError('INVALID_CONFIG', '云服务配置不完整');
  const envId = config.envId.trim(), name = config.functionName.trim();
  if (!envId) return null;
  const api = wx.cloud;
  if (!api) throw new CloudApiError('CLOUD_UNAVAILABLE', '当前微信环境不支持云开发');
  try { await api.init({ env: envId, traceUser: false }); }
  catch { throw new CloudApiError('CLOUD_UNAVAILABLE', '云服务初始化失败，请稍后重试'); }
  const send = async (action: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    let response: unknown;
    try { response = await api.callFunction({ name, data: { ...data, action } }); }
    catch { throw new CloudApiError('NETWORK_UNAVAILABLE', '云服务连接失败，请稍后重试'); }
    if (!record(response) || !record(response.result)) throw new CloudApiError('INVALID_RESPONSE', '云服务响应异常');
    const result = response.result;
    if (result.ok === false && record(result.error) && typeof result.error.code === 'string'
      && typeof result.error.message === 'string') throw new CloudApiError(result.error.code, result.error.message);
    if (result.ok !== true) throw new CloudApiError('INVALID_RESPONSE', '云服务响应异常');
    return result;
  };
  let profile = parseCloudProfile((await send('profile.get')).profile);
  const listeners = new Set<() => void>();
  const update = (value: unknown): PlayerProfile => {
    const next = parseCloudProfile(value);
    // 使用事务版本排序；不同云实例的时钟和同毫秒响应不能决定经济快照的新旧。
    if (next.playerId !== profile.playerId) throw new CloudApiError('IDENTITY_CHANGED', '微信身份已变化，请重新进入游戏');
    if (next.revision > profile.revision) {
      profile = next;
      for (const listener of listeners) listener();
    }
    return profile;
  };
  const welfareRequest = async (action: string, data?: Record<string, unknown>) => {
    const snapshot = parseWelfareSnapshot((await send(action, data)).welfare);
    update(snapshot.profile);
    return snapshot;
  };
  return {
    read: () => profile,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async refresh() { return update((await send('profile.get')).profile); },
    commerce: createCommerceClient(send, update, `${envId}:${name}:${profile.playerId}`, storage),
    welfare: {
      load: () => welfareRequest('welfare.get'),
      claimMission: (period, periodId, missionId) => welfareRequest('mission.claim', { period, periodId, missionId }),
      claimChapter: chapterId => welfareRequest('handbook.claim', { chapterId }),
    },
    leaderboard: {
      async list() { return parseCloudLeaderboard((await send('leaderboard.list')).leaderboard); },
      async begin(charId, rulesId) {
        const { ticket } = await send('run.begin', { charId, rulesId });
        if (!record(ticket) || typeof ticket.runId !== 'string' || !ticket.runId
          || !Number.isInteger(ticket.seed) || (ticket.seed as number) < 0 || (ticket.seed as number) > 0xffffffff
          || ticket.rulesId !== rulesId) throw new CloudApiError('INVALID_RESPONSE', '对局凭据异常');
        return { runId: ticket.runId, seed: ticket.seed as number, rulesId };
      },
      async submit(replay) {
        const result = await send('run.finish', { ...replay });
        if (typeof result.accepted !== 'boolean') throw new CloudApiError('INVALID_RESPONSE', '对局未获云端确认');
        update(result.profile);
        return { accepted: result.accepted };
      },
      async cancel(runId) { await send('run.cancel', { runId }); },
    },
  };
}
