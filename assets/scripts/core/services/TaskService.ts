import {
  FailReason,
  type GameplayResult,
  type IConfigService,
  type IRewardService,
  type ITaskService,
  type OpResult,
  type RewardBundle,
  type ServiceDeps,
  type TaskConfig,
  type TaskId,
  type TaskMetric,
  type TaskPeriodState,
  type TaskType,
  type TaskView,
} from '../contracts';
import { clamp, toInt } from '../framework/Utils';

const TASK_TYPES: TaskType[] = ['daily', 'weekly'];

/** 每日/每周任务：进度累加（单局最高分取最大）、周期重置、领取与一键领取。 */
export class TaskService implements ITaskService {
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
    this.refreshIfNeeded();
    const tasks = this.allTasks().filter((task) => task.metric === metric);
    if (tasks.length === 0) return;
    const changed: TaskId[] = [];
    for (const task of tasks) {
      const state = this.stateOf(task.type);
      if (this.applyProgress(state, task, value, opts.absolute === true)) changed.push(task.id);
    }
    if (changed.length > 0) this.afterChange(changed);
  }

  onRunFinished(result: GameplayResult): void {
    this.track('run.count', 1);
    this.track('run.distance', result.distance);
    this.track('run.score.single', result.score);
    this.track('run.coins.total', result.coins);
    this.track('run.diamonds.total', result.diamonds);
    this.advanceStats(result);
  }

  list(type: TaskType): TaskView[] {
    this.refreshIfNeeded();
    const state = this.stateOf(type);
    return this.config.tasksByType(type).map((task) => this.viewOf(task, state));
  }

  claim(id: TaskId): OpResult {
    this.refreshIfNeeded();
    const task = this.config.task(id);
    if (!task) return { ok: false, reason: FailReason.NotFound };
    const state = this.stateOf(task.type);
    if (state.claimed.includes(id)) return { ok: false, reason: FailReason.AlreadyClaimed };
    if (!this.isClaimable(task, state)) return { ok: false, reason: FailReason.Insufficient };
    state.claimed.push(id);
    this.reward.grant(task.reward, `task.${id}`);
    this.afterChange([id]);
    return { ok: true };
  }

  claimAll(type: TaskType): { claimed: TaskId[]; reward: RewardBundle } {
    this.refreshIfNeeded();
    const state = this.stateOf(type);
    const claimed: TaskId[] = [];
    const reward: RewardBundle = {};
    for (const task of this.config.tasksByType(type)) {
      if (!this.isClaimable(task, state)) continue;
      state.claimed.push(task.id);
      claimed.push(task.id);
      mergeReward(reward, task.reward);
    }
    if (claimed.length > 0) {
      this.reward.grant(reward, `task.claimAll.${type}`);
      this.afterChange(claimed);
    }
    return { claimed, reward };
  }

  refreshIfNeeded(): void {
    let changed = false;
    const today = this.deps.clock.gameDay();
    const week = this.deps.clock.weekKey();
    const tasks = this.deps.save.tasks;
    if (tasks.daily.date !== today) {
      tasks.daily = { date: today, progress: {}, claimed: [] };
      changed = true;
    }
    if (tasks.weekly.date !== week) {
      tasks.weekly = { date: week, progress: {}, claimed: [] };
      changed = true;
    }
    if (changed) this.afterChange();
  }

  hasClaimable(): boolean {
    this.refreshIfNeeded();
    for (const type of TASK_TYPES) {
      const state = this.stateOf(type);
      for (const task of this.config.tasksByType(type)) {
        if (this.isClaimable(task, state)) return true;
      }
    }
    return false;
  }

  private allTasks(): TaskConfig[] {
    return [...this.config.tasksByType('daily'), ...this.config.tasksByType('weekly')];
  }

  private stateOf(type: TaskType): TaskPeriodState {
    return this.deps.save.tasks[type];
  }

  /** 返回进度是否发生变化；未变化时不写存档也不发事件。 */
  private applyProgress(state: TaskPeriodState, task: TaskConfig, value: number, absolute: boolean): boolean {
    const current = this.progressOf(state.progress[task.id]);
    const target = this.targetOf(task);
    const next = absolute
      ? clamp(toInt(value), 0, target)
      : this.nextProgress(task.metric, current, value, target);
    if (next === current) return false;
    state.progress[task.id] = next;
    return true;
  }

  private nextProgress(metric: TaskMetric, current: number, value: number, target: number): number {
    if (metric === 'run.score.single') return clamp(Math.max(current, toInt(value)), 0, target);
    const delta = Math.max(0, toInt(value));
    return clamp(current + delta, 0, target);
  }

  private isClaimable(task: TaskConfig, state: TaskPeriodState): boolean {
    if (state.claimed.includes(task.id)) return false;
    return this.progressOf(state.progress[task.id]) >= this.targetOf(task);
  }

  private viewOf(task: TaskConfig, state: TaskPeriodState): TaskView {
    const progress = this.progressOf(state.progress[task.id]);
    const target = this.targetOf(task);
    const claimed = state.claimed.includes(task.id);
    return { config: task, progress, target, claimed, claimable: !claimed && progress >= target };
  }

  private progressOf(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? toInt(value) : 0;
  }

  private targetOf(task: TaskConfig): number {
    return Math.max(0, toInt(task.target));
  }

  /** 推进 stats（只增不减）；loginDays 由装配层在跨天时推进。 */
  private advanceStats(result: GameplayResult): void {
    const stats = this.deps.save.stats;
    stats.runs += 1;
    stats.totalDistance += Math.max(0, toInt(result.distance));
    stats.totalCoins += Math.max(0, toInt(result.coins));
    stats.totalDiamonds += Math.max(0, toInt(result.diamonds));
    stats.bestScore = Math.max(stats.bestScore, Math.max(0, toInt(result.score)));
    stats.totalPlayMs += Math.max(0, toInt(result.durationMs));
    this.deps.markDirty();
  }

  private afterChange(ids?: TaskId[]): void {
    this.deps.events.emit('task.changed', ids ? { ids } : {});
    this.deps.markDirty();
  }
}

/** 合并奖励：货币求和、道具按 id 合并、角色去重。 */
export function mergeReward(target: RewardBundle, add: RewardBundle): void {
  if (!add || typeof add !== 'object') return;
  if (add.gold) target.gold = (target.gold ?? 0) + add.gold;
  if (add.diamond) target.diamond = (target.diamond ?? 0) + add.diamond;
  for (const stack of add.items ?? []) {
    if (!stack || typeof stack.id !== 'string') continue;
    const items = target.items ?? (target.items = []);
    const exist = items.find((item) => item.id === stack.id);
    if (exist) exist.count += stack.count;
    else items.push({ id: stack.id, count: stack.count });
  }
  for (const id of add.characters ?? []) {
    if (typeof id !== 'string') continue;
    const characters = target.characters ?? (target.characters = []);
    if (!characters.includes(id)) characters.push(id);
  }
}
