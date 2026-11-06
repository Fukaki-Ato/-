/**
 * Web 任务 API：MissionApiCore 的 web 装配（fetch 同源 cookie + localStorage 队列）。
 * 队列/会话/幂等结算逻辑在 packages/game/flow/missionApiCore（wx 侧复用同一份，M5-3）。
 */
import type { MissionQueueStorage, MissionTransport } from '@tr/game/flow/missionApiCore.js';
import { MissionApiCore } from '@tr/game/flow/missionApiCore.js';

export class MissionApi extends MissionApiCore {
  constructor() {
    super(webTransport(), webStorage());
  }
}

function webTransport(): MissionTransport {
  return {
    async request(path, method, body) {
      const response = await fetch(`/api/missions${path}`, {
        method, credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
      const data = await response.json().catch(() => null);
      return { status: response.status, data };
    },
  };
}

function webStorage(): MissionQueueStorage {
  return {
    get: key => localStorage.getItem(key),
    set: (key, value) => localStorage.setItem(key, value),
  };
}
