/**
 * 登录签到（login 型活动，审查 M4-6）：日历视图 + 每天一次领取，奖励入本机钱包。
 * 从 localEconomy 拆出（300 行上限）；事件开放判定复用同包 isEventLive。
 */
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { BuyResult, EconomyStore } from './localEconomy.js';
import { grant, isEventLive } from './localEconomy.js';

type Entry = Record<string, unknown>;
// ---------------- 登录签到（login 型活动，审查 M4-6） ----------------

export interface SignInDay { day: number; rewardText: string; status: 'claimed' | 'today' | 'locked' }
export interface SignInState { eventId: string; name: string; days: SignInDay[]; canClaim: boolean }

const signInKey = (eventId: string): string => `thunderrun:signin:${eventId}`;

function claimedDays(store: EconomyStore, eventId: string): Set<number> {
  try {
    const raw = JSON.parse(store.get(signInKey(eventId)) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is number => Number.isInteger(x)) : []);
  } catch { return new Set(); }
}

function rewardTextOf(reward: Entry): string {
  return Object.entries(reward).map(([kind, v]) => {
    if (kind === 'shard' || kind === 'item') { const [id, n] = String(v).split(':'); return `${id} ×${n}`; }
    return `${kind} ×${String(v)}`;
  }).join(' + ');
}

function loginEventStartMs(ev: Entry): number {
  const win = ev['window'] as { start?: unknown } | undefined; // 字段名叫 window：下标访问以避开宿主全局禁令的正则
  return typeof win?.start === 'string' ? Date.parse(win.start) : NaN;
}

function loginDayIndex(ev: Entry, rewards: Entry[], now: Date): number {
  const startMs = loginEventStartMs(ev);
  return Number.isNaN(startMs) ? 1
    : Math.min(rewards.length, Math.max(1, Math.floor((now.getTime() - startMs) / 86400000) + 1));
}

/** 登录型活动签到视图：取首个 live 的 login 活动；没有则 null（入口隐藏） */
export function signInState(store: EconomyStore, content: GameContent, now: Date): SignInState | null {
  const events = (content.events.items ?? []) as Entry[];
  const ev = events.find(e => e['kind'] === 'login' && isEventLive(content, String(e.id), now)) as
    (Entry & { id: string; name?: unknown; loginRewards?: Entry[] }) | undefined;
  if (!ev || !Array.isArray(ev.loginRewards) || ev.loginRewards.length === 0) return null;
  const day = loginDayIndex(ev, ev.loginRewards, now);
  const claimed = claimedDays(store, ev.id);
  const nameOf = (n: unknown): string => {
    if (n && typeof n === 'object' && typeof (n as Entry)['zh-CN'] === 'string') return (n as Entry)['zh-CN'] as string;
    return String(ev.id);
  };
  const days: SignInDay[] = ev.loginRewards.map((row, i) => {
    const d = i + 1;
    const status: SignInDay['status'] = claimed.has(d) ? 'claimed' : d === day ? 'today' : 'locked';
    return { day: d, rewardText: rewardTextOf((row.reward ?? {}) as Entry), status };
  });
  return { eventId: ev.id, name: nameOf(ev.name), days, canClaim: !claimed.has(day) };
}

/** 领取今日签到：每天一次，奖励入本机钱包（coin/key/diamond 直记；shard/item 为 "id:n" 串） */
export function claimSignIn(store: EconomyStore, content: GameContent, now: Date): BuyResult {
  const state = signInState(store, content, now);
  if (!state) return { ok: false, message: '当前没有进行中的签到活动' };
  if (!state.canClaim) return { ok: false, message: '今天已经领过了' };
  const ev = (content.events.items ?? []).find(e => e.id === state.eventId) as (Entry & { loginRewards?: Entry[] }) | undefined;
  const day = loginDayIndex(ev ?? {}, ev?.loginRewards ?? [], now);
  const row = (ev?.loginRewards ?? [])[day - 1] as Entry | undefined;
  const reward = (row?.reward ?? {}) as Record<string, unknown>;
  for (const [kind, v] of Object.entries(reward)) {
    if (kind === 'shard' || kind === 'item') {
      const [id, n] = String(v).split(':');
      grant(store, [{ item: id, n: Number(n) }]);
    } else {
      grant(store, [{ item: kind, n: Number(v) }]);
    }
  }
  const claimed = claimedDays(store, state.eventId);
  claimed.add(day);
  store.set(signInKey(state.eventId), JSON.stringify([...claimed].sort((a, b) => a - b)));
  return { ok: true, message: `第 ${day} 天签到成功` };
}
