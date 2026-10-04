import {
  FailReason,
  type ActivityConfig,
  type ActivityId,
  type ActivityMilestoneView,
  type ActivityView,
  type IActivityService,
  type IConfigService,
  type IRewardService,
  type OpResult,
  type ServiceDeps,
  type TaskMetric,
} from '../contracts';
import { toInt } from '../framework/Utils';

export type ActivityStatus = ActivityView['status'];

/** 活动：时间窗三态、里程碑进度/领取，过期（已结束）不再推进进度。 */
export class ActivityService implements IActivityService {
  private readonly deps: ServiceDeps;
  private readonly config: IConfigService;
  private readonly reward: IRewardService;
  private readonly lastStatus = new Map<ActivityId, ActivityStatus>();
  private initialized = false;

  constructor(deps: ServiceDeps, config: IConfigService, reward: IRewardService) {
    this.deps = deps;
    this.config = config;
    this.reward = reward;
  }

  list(): ActivityView[] {
    return this.config.allActivities()
      .filter((activity) => activity.enabled)
      .map((activity) => this.viewOf(activity));
  }

  get(id: ActivityId): ActivityView | null {
    const activity = this.config.activity(id);
    if (!activity || !activity.enabled) return null;
    return this.viewOf(activity);
  }

  claim(id: ActivityId, milestoneIndex: number): OpResult {
    const activity = this.config.activity(id);
    if (!activity || !activity.enabled) return { ok: false, reason: FailReason.NotFound };
    const milestones = activity.milestones ?? [];
    if (!Number.isInteger(milestoneIndex) || milestoneIndex < 0 || milestoneIndex >= milestones.length) {
      return { ok: false, reason: FailReason.NotFound };
    }
    const status = this.statusOf(activity);
    if (status === 'ended') return { ok: false, reason: FailReason.Expired };
    if (status === 'upcoming') return { ok: false, reason: FailReason.Locked };

    const claimed = this.claimedForClaim(id);
    if (claimed.includes(milestoneIndex)) return { ok: false, reason: FailReason.AlreadyClaimed };
    const target = Math.max(0, toInt(milestones[milestoneIndex].target));
    if (this.progressOf(id) < target) return { ok: false, reason: FailReason.Insufficient };

    claimed.push(milestoneIndex);
    this.reward.grant(milestones[milestoneIndex].reward, `activity.${id}.${milestoneIndex}`);
    this.afterChange(id);
    return { ok: true };
  }

  track(metric: TaskMetric, value: number, opts: { absolute?: boolean } = {}): void {
    if (!Number.isFinite(value)) return;
    const changed: ActivityId[] = [];
    for (const activity of this.config.allActivities()) {
      if (!activity.enabled || activity.metric !== metric) continue;
      // 只有进行中的活动推进进度；未开始/已结束忽略（过期后不可再 track）。
      if (this.statusOf(activity) !== 'active') continue;
      const current = this.progressOf(activity.id);
      const next = opts.absolute === true
        ? Math.max(0, toInt(value))
        : this.nextProgress(metric, current, value);
      if (next === current) continue;
      this.deps.save.activities.progress[activity.id] = next;
      changed.push(activity.id);
    }
    if (changed.length > 0) this.afterChange(changed);
  }

  /** 重新检测时间窗状态；状态翻转时 emit activity.changed（首次调用只建立基线，不发射）。 */
  refreshIfNeeded(): void {
    const changed: ActivityId[] = [];
    for (const activity of this.config.allActivities()) {
      if (!activity.enabled) continue;
      const status = this.statusOf(activity);
      const previous = this.lastStatus.get(activity.id);
      this.lastStatus.set(activity.id, status);
      if (this.initialized && previous !== status) changed.push(activity.id);
    }
    this.initialized = true;
    if (changed.length > 0) this.deps.events.emit('activity.changed', { ids: changed });
  }

  /** docs/02 §4：存在可领取里程碑或时间窗内（进行中）的活动即点亮。 */
  hasClaimable(): boolean {
    return this.config.allActivities().some(
      (activity) => activity.enabled && this.statusOf(activity) === 'active',
    );
  }

  private nextProgress(metric: TaskMetric, current: number, value: number): number {
    if (metric === 'run.score.single') return Math.max(current, Math.max(0, toInt(value)));
    return current + Math.max(0, toInt(value));
  }

  private viewOf(activity: ActivityConfig): ActivityView {
    const status = this.statusOf(activity);
    const progress = this.progressOf(activity.id);
    const claimed = this.claimedOf(activity.id);
    const milestones: ActivityMilestoneView[] = (activity.milestones ?? []).map((milestone, index) => {
      const target = Math.max(0, toInt(milestone.target));
      const isClaimed = claimed.includes(index);
      return {
        index,
        target,
        progress,
        claimable: status === 'active' && !isClaimed && progress >= target,
        claimed: isClaimed,
        reward: milestone.reward,
      };
    });
    return { config: activity, status, milestones };
  }

  private statusOf(activity: ActivityConfig): ActivityStatus {
    const now = this.deps.clock.now();
    const start = parseLocalTime(activity.startTime);
    const end = parseLocalTime(activity.endTime);
    if (start !== null && now < start) return 'upcoming';
    if (end !== null && now >= end) return 'ended';
    return 'active';
  }

  private progressOf(id: ActivityId): number {
    const value = this.deps.save.activities.progress[id];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? toInt(value) : 0;
  }

  /** 只读：缺失时返回临时空数组，不写入存档（list/get 等只读路径不应产生副作用）。 */
  private claimedOf(id: ActivityId): number[] {
    const value = this.deps.save.activities.claimed[id];
    return Array.isArray(value) ? value : [];
  }

  /** 领取路径：确保 claimed 数组存在并返回可写引用。 */
  private claimedForClaim(id: ActivityId): number[] {
    const record = this.deps.save.activities.claimed;
    if (!Array.isArray(record[id])) record[id] = [];
    return record[id];
  }

  private afterChange(ids?: ActivityId | ActivityId[]): void {
    this.deps.events.emit('activity.changed', ids === undefined ? {} : { ids: Array.isArray(ids) ? ids : [ids] });
    this.deps.markDirty();
  }
}

/** 解析本地时间字符串 `YYYY-MM-DD HH:mm(:ss)`；非法返回 null。 */
function parseLocalTime(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const value = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? 0),
  ).getTime();
  return Number.isFinite(value) ? value : null;
}
