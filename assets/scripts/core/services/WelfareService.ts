import {
  FailReason,
  type IConfigService,
  type IRewardService,
  type IWelfareService,
  type OpResult,
  type ServiceDeps,
  type WelfareConfig,
  type WelfareSignInDayView,
  type WelfareSignInState,
} from '../contracts';
import { toInt } from '../framework/Utils';

const HISTORY_MAX = 90;
const DAILY_AD_FLAG = 'welfare.dailyAdDate';

/** 福利：7 日签到循环（按游戏日）与每日免费广告奖励。 */
export class WelfareService implements IWelfareService {
  private readonly deps: ServiceDeps;
  private readonly config: IConfigService;
  private readonly reward: IRewardService;

  constructor(deps: ServiceDeps, config: IConfigService, reward: IRewardService) {
    this.deps = deps;
    this.config = config;
    this.reward = reward;
  }

  signInState(): WelfareSignInState {
    const welfare = this.config.welfare();
    const today = this.deps.clock.gameDay();
    const state = this.deps.save.welfare;
    const todaySigned = state.lastSignInDate === today;
    const cycleDay = this.cycleDayOf(welfare);
    const days: WelfareSignInDayView[] = welfare.signIn.days.map((entry) => ({
      day: entry.day,
      reward: entry.reward,
      state: this.dayStateOf(entry.day, cycleDay, todaySigned),
    }));
    return { todaySigned, cycleDay, days };
  }

  signIn(): OpResult {
    const welfare = this.config.welfare();
    const days = welfare.signIn.days;
    if (days.length === 0) return { ok: false, reason: FailReason.NotFound };
    const state = this.deps.save.welfare;
    const today = this.deps.clock.gameDay();
    if (state.lastSignInDate === today) return { ok: false, reason: FailReason.AlreadyClaimed };

    const maxDay = Math.max(...days.map((entry) => entry.day));
    let nextDay = this.cycleDayOf(welfare) + 1;
    if (nextDay < 1 || nextDay > maxDay) nextDay = 1;
    const entry = days.find((item) => item.day === nextDay);
    if (!entry) {
      this.deps.log.warn(`签到配置缺少第 ${nextDay} 天奖励`);
      return { ok: false, reason: FailReason.NotFound };
    }

    state.signInCycleDay = nextDay >= maxDay ? 0 : nextDay;
    state.lastSignInDate = today;
    const history = Array.isArray(state.signInHistory) ? state.signInHistory : [];
    const deduped = history.filter((date) => date !== today);
    deduped.push(today);
    state.signInHistory = deduped.slice(-HISTORY_MAX);
    this.reward.grant(entry.reward, `welfare.signIn.day${nextDay}`);
    this.afterChange();
    return { ok: true };
  }

  dailyFreeAdClaimed(): boolean {
    return this.deps.save.flags[DAILY_AD_FLAG] === this.deps.clock.gameDay();
  }

  claimDailyFreeAd(): OpResult {
    const freeAd = this.config.welfare().dailyFreeAd;
    if (!freeAd) return { ok: false, reason: FailReason.Unsupported };
    if (this.dailyFreeAdClaimed()) return { ok: false, reason: FailReason.AlreadyClaimed };
    this.deps.save.flags[DAILY_AD_FLAG] = this.deps.clock.gameDay();
    this.reward.grant(freeAd.reward, 'welfare.dailyAd');
    this.afterChange();
    return { ok: true };
  }

  /** 签到与每日广告状态均按游戏日实时比对，无需重置存档字段。 */
  refreshIfNeeded(): void {
    // 状态由 lastSignInDate / welfare.dailyAdDate 与当前游戏日比较得出，此处无需变更。
  }

  private dayStateOf(day: number, cycleDay: number, todaySigned: boolean): WelfareSignInDayView['state'] {
    if (day <= cycleDay) return 'claimed';
    if (day === cycleDay + 1 && !todaySigned) return 'today';
    return 'future';
  }

  private cycleDayOf(welfare: WelfareConfig): number {
    const maxDay = welfare.signIn.days.length > 0
      ? Math.max(...welfare.signIn.days.map((entry) => entry.day))
      : 0;
    const raw = toInt(this.deps.save.welfare.signInCycleDay);
    return Math.min(Math.max(raw, 0), maxDay);
  }

  private afterChange(): void {
    this.deps.events.emit('welfare.changed', {});
    this.deps.markDirty();
  }
}
