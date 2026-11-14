/**
 * 成就场景（大厅「成就」勋章进入，settingsScene 同式装配）：进度合并与领取语义收口在本文件。
 * 数据两路：source=run 条目以服务端快照为准（进页 GET 一次；快照不可得=离线口径——本机 totals
 * 预览 + run 类领取置灰，任务服务恢复后重进成就页自动取数）；source=local 条目读本机 tracker。
 * 领取分流：local→tracker.claimLocal（本机经济发货，成功即重绘）；run→api.claim（服务端发放，
 * 快照钱包经壳侧 onSnapshot 已入本机钱包），成功/失败都以快照重绘整页。run 领取乐观受理即重绘
 * （claiming 置灰按钮防连点，提示「正在领取奖励…」随重绘上状态行——两端页面均整页替换，
 * 依赖 onClaim 返回后写旧节点的反馈会随重绘失效，故消息统一由页面数据 statusMessage 携带）；
 * load 失败把真实原因（网络不可用/服务错误/本机钱包损坏）上状态行，离线锁定口径不变。
 * 铁律同 flow：零 DOM——页面渲染经注入的 GameViews.renderAchievements。
 */
import type { AchievementEntry, GameContent } from '../core/config/configTypes.js';
import { achievementLive } from '../core/config/achievementsValidator.js';
import type { SceneDef } from '@tr/game/core/scene/sceneMachine.js';
import type { AchievementSectionView, AchievementsPageView, AchievementRowView, GameViews } from './views.js';
import type { AchTotals, AchievementTracker } from './achievementTracker.js';
import type { AchievementApiLike, AchSnapshot } from './achievementApiCore.js';
import type { BuyResult } from './localEconomy.js';

/** 分组标题与说明（UI 骨架文案，与设置页「跑酷场景/音量」同类；两端视图共用这一份） */
const GROUP_META: Record<AchievementRowView['group'], { title: string; note: string }> = {
  run: { title: '奔跑', note: '里程、跳跃与能量的积累' },
  skill: { title: '技巧', note: '操作技术与临场反应' },
  collect: { title: '收集', note: '局内拾取与道具图鉴' },
  chars: { title: '角色', note: '解锁更多跑者' },
};
const GROUP_ORDER: AchievementRowView['group'][] = ['run', 'skill', 'collect', 'chars'];
const OFFLINE_MESSAGE = '网络未连接，稍后重试';

/** 奖励文案：coin/key/diamond 直接计数，shard=「xx碎片 ×n」（碎片名查 characters 配置，任务页同口径） */
function rewardText(content: GameContent, reward: AchievementEntry['reward']): string {
  const parts: string[] = [];
  for (const [kind, value] of Object.entries(reward)) {
    if (kind === 'shard' && typeof value === 'string') {
      const [id, n] = value.split(':');
      const charId = (id ?? '').replace('shard_', 'char_');
      const charName = (content.characters.items ?? []).find(c => c.id === charId)?.name?.['zh-CN'];
      parts.push(`${charName ? `${charName}碎片` : id} ×${n}`);
    } else if (kind === 'coin') parts.push(`金币 ×${value}`);
    else if (kind === 'key') parts.push(`钥匙 ×${value}`);
    else if (kind === 'diamond') parts.push(`钻石 ×${value}`);
  }
  return parts.join(' · ');
}

/** 条目在本机 totals 里的进度（itemOf 分道具；score/distanceM 等其余与 stat 同名） */
function statTotal(entry: AchievementEntry, totals: AchTotals): number {
  if (entry.stat === 'itemOf') return totals.itemOf[entry.statRef ?? ''] ?? 0;
  const v = (totals as unknown as Record<string, number | Record<string, number>>)[entry.stat];
  return typeof v === 'number' ? v : 0;
}

/** 合并服务端快照（run 类）+本机 totals（local 类/离线预览）→ 整页视图（纯函数，视图零计算） */
export function buildAchPageView(
  content: GameContent,
  d: {
    snapshot: AchSnapshot | null;
    totals: AchTotals;
    claimed: ReadonlySet<string>;
    /** 受理中的 run 条目（乐观受理→回包）：行按钮置灰防连点 */
    claiming?: ReadonlySet<string>;
    /** 需随本次重绘保留的状态行消息；空=默认口径（offlineMessage/联网说明） */
    statusMessage?: string;
  },
): AchievementsPageView {
  // draft/retired 条目不进页面也不可领（items 的 availability 同款口径，见 achievementLive）
  const entries = (content.achievements?.items ?? []).filter(achievementLive);
  const serverById = new Map((d.snapshot?.achievements ?? []).map(a => [a.id, a]));
  const rows = entries.map((entry): AchievementRowView => {
    const server = serverById.get(entry.id);
    const isRun = entry.source === 'run';
    const raw = isRun && server ? server.progress : statTotal(entry, d.totals);
    const progress = Math.min(entry.target, Math.round(raw * 100) / 100);
    // run 条目已领态以服务端为准；离线时本机 claimed 仅记 local 领取，run 条目按未领展示（联网即校正）
    const claimed = isRun ? (server ? server.claimed : false) : d.claimed.has(entry.id);
    const reached = progress >= entry.target;
    const offline = isRun && d.snapshot === null;
    return {
      id: entry.id,
      name: entry.name['zh-CN'] ?? entry.id,
      desc: entry.desc['zh-CN'] ?? '',
      tier: entry.tier, group: entry.group, source: entry.source,
      target: entry.target, progress, claimed,
      claimable: reached && !claimed && !offline,
      locked: reached && !claimed && offline, // 达标但服务端不可得：按钮置灰而非隐藏（离线口径）
      claiming: d.claiming?.has(entry.id) ?? false,
      rewardText: rewardText(content, entry.reward),
    };
  });
  const sections: AchievementSectionView[] = GROUP_ORDER
    .map(group => ({ group, ...GROUP_META[group], rows: rows.filter(r => r.group === group) }))
    .filter(section => section.rows.length > 0);
  return {
    sections, rows,
    offline: d.snapshot === null,
    offlineMessage: OFFLINE_MESSAGE,
    ...(d.statusMessage ? { statusMessage: d.statusMessage } : {}),
    claimedCount: rows.filter(r => r.claimed).length,
    total: rows.length,
  };
}

export interface AchievementsSceneDeps {
  views: GameViews;
  /** 当前配置（boot 后才非空；未加载＝直接回大厅） */
  content(): GameContent | null;
  goSelect(): void;
  tracker: AchievementTracker;
  /** run 条目的服务端 API；缺省＝run 类置灰（入口在 mainFlow 侧按同条件置空，防死按钮） */
  api?: AchievementApiLike;
}

export function createAchievementsScene(d: AchievementsSceneDeps): SceneDef {
  /** 代次守卫（startScene.startGen 同式）：onEnter 递增——已离开页面的 load/claim 不再渲染 */
  let gen = 0;
  let snapshot: AchSnapshot | null = null;
  /** 状态行消息（load 失败原因/领取提示）：随整页重绘携带（旧节点写入会随页面替换失效）；空=默认口径 */
  let statusMessage = '';
  return {
    onEnter: () => {
      const content = d.content();
      const renderAchievements = d.views.renderAchievements;
      if (!content || !renderAchievements) { d.goSelect(); return; }
      const ticket = ++gen;
      snapshot = null;
      statusMessage = '';
      const claiming = new Set<string>(); // 受理中的 run 条目：回包前防连点（服务端幂等，重复 POST 仍属冗余）
      const render = (): void => {
        if (ticket !== gen) return;
        renderAchievements(content, buildAchPageView(content, {
          snapshot, totals: d.tracker.totals(), claimed: d.tracker.claimedIds(),
          claiming, statusMessage: statusMessage || undefined,
        }), {
          onBack: () => d.goSelect(),
          onClaim: id => claim(id),
        });
      };
      const claim = (id: string): BuyResult => {
        // 与页面同一生效清单：draft/retired 条目视同不存在（服务端亦 404，双端口径一致）
        const def = (content.achievements?.items ?? []).filter(achievementLive).find(e => e.id === id);
        if (!def) return { ok: false, message: '找不到该成就' };
        if (def.source === 'local') {
          const result = d.tracker.claimLocal(def);
          if (result.ok) { statusMessage = result.message; render(); } // 本机领取即时重绘：提示经 statusMessage 随重绘保留
          return result;
        }
        if (!d.api) return { ok: false, message: OFFLINE_MESSAGE };
        if (claiming.has(id)) return { ok: false, message: '正在领取奖励…' };
        claiming.add(id);
        statusMessage = '正在领取奖励…';
        render(); // 乐观受理即重绘：按钮置灰（claiming）+ 提示上状态行
        void d.api.claim(id).then(snap => {
          if (ticket !== gen) return;
          claiming.delete(id);
          snapshot = snap;
          statusMessage = '';
          render();
          d.views.toast('奖励已存入本机钱包');
        }).catch((error: Error) => {
          if (ticket !== gen) return;
          claiming.delete(id);
          statusMessage = ''; // 领取失败：以旧快照重绘，状态复位为可领取，原因经 toast 呈现
          render();
          d.views.toast(error.message);
        });
        return { ok: true, message: '正在领取奖励…' };
      };
      render();
      void d.api?.load().then(snap => {
        if (ticket === gen) { snapshot = snap; statusMessage = ''; render(); }
      }).catch((error: Error) => {
        // 失败不吞：真实原因上状态行（本机钱包损坏 ≠ 网络问题），离线锁定口径不变
        if (ticket === gen) { statusMessage = error.message || OFFLINE_MESSAGE; render(); }
      });
    },
  };
}
