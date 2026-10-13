import type { LeaderboardData, LeaderboardService, RankedReplay, RankedTicket } from '@tr/game/flow/leaderboard.js';

/** Same-origin anonymous identity is held in an HttpOnly cookie, never in game storage. */
export function createLeaderboardClient(base: string, request: typeof fetch = fetch,
  pageId = document.querySelector<HTMLMetaElement>('meta[name="tr-rank-page"]')?.content ?? ''): LeaderboardService {
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), body && path.endsWith('submit') ? 20000 : 5000);
    try {
      const response = await request(`${base}api/${path}`, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
      });
      if (!response.ok) throw new Error(`leaderboard ${response.status}`);
      return await response.json() as T;
    } finally { window.clearTimeout(timer); }
  };
  return {
    list: () => call<LeaderboardData>('leaderboard'),
    begin: (charId, rulesId) => call<RankedTicket>('runs', { charId, rulesId, pageId }),
    submit: (replay: RankedReplay) => call<{ accepted: boolean }>('runs/submit', { ...replay, pageId }),
    cancel: async runId => { await call('runs/cancel', { runId }); },
  };
}
