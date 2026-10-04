import {
  FailReason,
  type AchievementConfig,
  type AchievementId,
  type AchievementView,
  type GameplayResult,
  type IAchievementService,
  type IConfigService,
  type IRewardService,
  type OpResult,
  type ServiceDeps,
  type TaskMetric,
} from '../contracts';
import { clamp, toInt } from '../framework/Utils';

/** 成就：与任务同构的进度累加/最高值规则，无周期重置。 */
export class AchievementService implements IAchievementService {
  private readonly deps: ServiceDeps;
  private readonly config: IConfigService;
  private readonly reward: IRewardService;

  constructor(deps: ServiceDeps, config: IConfigService, reward: IRewardService) {
    this.deps = deps;
    this.config = config;
    this.reward = reward;
  }

  track(metric: TaskMetric, value: number, opts: { absolute?: boolean } = {}): void {
    if (!Number.isFinite(value)) return;
    const achievements = this.config.allAchievements().filter((item) => item.metric === metric);
    if (achievements.length === 0) return;
    const state = this.deps.save.achievements;
    const changed: AchievementId[] = [];
    for (const achievement of achievements) {
      const current = this.progressOf(state.progress[achievement.id]);
      const target = this.targetOf(achievement);
      const next = opts.absolute === true
        ? clamp(toInt(value), 0, target)
        : this.nextProgress(achievement.metric, current, value, target);
      if (next === current) continue;
      state.progress[achievement.id] = next;
      changed.push(achievement.id);
    }
    if (changed.length > 0) this.afterChange(changed);
  }

  onRunFinished(result: GameplayResult): void {
    this.track('run.count', 1);
    this.track('run.distance', result.distance);
    this.track('run.score.single', result.score);
    this.track('run.coins.total', result.coins);
    this.track('run.diamonds.total', result.diamonds);
  }

  list(): AchievementView[] {
    const state = this.deps.save.achievements;
    return this.config.allAchievements().map((achievement) => {
      const progress = this.progressOf(state.progress[achievement.id]);
      const target = this.targetOf(achievement);
      const claimed = state.claimed.includes(achievement.id);
      return { config: achievement, progress, target, claimed, claimable: !claimed && progress >= target };
    });
  }

  claim(id: AchievementId): OpResult {
    const achievement = this.config.achievement(id);
    if (!achievement) return { ok: false, reason: FailReason.NotFound };
    const state = this.deps.save.achievements;
    if (state.claimed.includes(id)) return { ok: false, reason: FailReason.AlreadyClaimed };
    if (!this.isClaimable(achievement)) return { ok: false, reason: FailReason.Insufficient };
    state.claimed.push(id);
    this.reward.grant(achievement.reward, `achievement.${id}`);
    this.afterChange([id]);
    return { ok: true };
  }

  hasClaimable(): boolean {
    return this.config.allAchievements().some((achievement) => this.isClaimable(achievement));
  }

  private nextProgress(metric: TaskMetric, current: number, value: number, target: number): number {
    if (metric === 'run.score.single') return clamp(Math.max(current, toInt(value)), 0, target);
    const delta = Math.max(0, toInt(value));
    return clamp(current + delta, 0, target);
  }

  private isClaimable(achievement: AchievementConfig): boolean {
    const state = this.deps.save.achievements;
    if (state.claimed.includes(achievement.id)) return false;
    return this.progressOf(state.progress[achievement.id]) >= this.targetOf(achievement);
  }

  private progressOf(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? toInt(value) : 0;
  }

  private targetOf(achievement: AchievementConfig): number {
    return Math.max(0, toInt(achievement.target));
  }

  private afterChange(ids?: AchievementId[]): void {
    this.deps.events.emit('achievement.changed', ids ? { ids } : {});
    this.deps.markDirty();
  }
}
