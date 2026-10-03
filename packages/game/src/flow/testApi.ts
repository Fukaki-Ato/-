/**
 * 测试模式 API（?debug / ?test 开启）：把「手动施加任意 buff」暴露成结构化接口，
 * 供 apps/web 的左侧技能开关面板消费（用户要求：不方便测试，要一个能选开/关的技能面板）。
 *
 * 设计约束：
 *  - 定义全部来自 config（items/skills/characters 的 effects），不发明配置里没有的效果；
 *  - 开关语义 = 以长效（TEST_DURATION_S）施加同一原语，关闭 = 从引擎移除该原语；
 *  - 只通过 RunnerSim.buffs 这一个入口施加（与技能/道具/被动同一条通路），不碰 sim 内部状态；
 *  - 挂载在 globalThis.__trTest，仅测试模式下存在，局结束即卸载（不污染正式运行）。
 */
import type { GameContent } from '../core/config/configTypes.js';
import type { EffectParams } from '../core/effects/buffEngine.js';
import type { StackRule } from '../core/effects/effectTypes.js';
import type { RunnerSim } from '../core/sim/runnerSim.js';

/** 开关类 buff 的测试时长（秒）：一局测试足够长，且不触碰引擎 5400s 绝对上限 */
const TEST_DURATION_S = 3600;

export interface TestToggleDef {
  primitive: string;
  label: string;
  group: string;
  /** 施加参数：配置原值 + 测试时长（durationS 覆盖为 TEST_DURATION_S） */
  params: EffectParams;
  stackRule: StackRule;
}

export interface TestActionDef {
  primitive: string;
  label: string;
  params: EffectParams;
}

export interface TestApi {
  /** 可开关的持续性 buff（按分组顺序） */
  toggles(): TestToggleDef[];
  /** 一次性技能（点击即结算） */
  actions(): TestActionDef[];
  /** 当前各原语剩余秒数（0 = 未开启） */
  state(): Record<string, number>;
  /** 开/关一个持续性 buff */
  set(primitive: string, on: boolean): void;
  /** 触发一个一次性技能 */
  fire(primitive: string): void;
  /** 全部关闭 */
  allOff(): void;
}

const GROUPS: Record<string, string> = {
  fly: '飞行 · 机动', jumpBoost: '飞行 · 机动', slideExtend: '飞行 · 机动',
  invincible: '防护', shieldAdd: '防护', boardArmor: '防护', lifeAdd: '防护',
  magnet: '增益', speedMul: '增益', timeSlow: '增益', coinValueAdd: '增益',
  buffDurationAdd: '增益', cooldownMul: '增益', laneAutoAvoid: '增益',
};
const groupOf = (p: string) => GROUPS[p] ?? '其他';
/** 一次性技能（代码原语，配置里没有对应道具：仅供测试面板触发） */
const ACTIONS: TestActionDef[] = [
  { primitive: 'dash', label: '冲刺 12m（撞碎障碍）', params: { distanceM: 12 } },
  { primitive: 'blink', label: '相位闪烁 12m', params: { distanceM: 12, phase: true } },
];

const text = (v: unknown, dflt: string): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, string>;
    return o['zh-CN'] ?? o['en-US'] ?? dflt;
  }
  return dflt;
};

/** 从配置收集「原语 → 定义」：道具（pickup）优先，其次主动技能，最后被动天赋 */
function collectToggles(content: GameContent): TestToggleDef[] {
  const byPrimitive = new Map<string, TestToggleDef>();
  const consider = (entry: Record<string, unknown> | undefined, fallbackRule: StackRule) => {
    const list = (entry?.['effects'] as Array<Record<string, unknown>> | undefined) ?? [];
    const label = text(entry?.['name'], '');
    const rule = (entry?.['stackRule'] as StackRule | undefined) ?? fallbackRule;
    for (const e of list) {
      const p = e['primitive'];
      if (typeof p !== 'string' || byPrimitive.has(p)) continue;
      const { durationS, ...rest } = e;
      void durationS; // 开关语义统一用长效，配置里的 10s/12s 不适用于面板
      byPrimitive.set(p, {
        primitive: p, label: label || p, group: groupOf(p),
        params: { durationS: TEST_DURATION_S, ...rest } as EffectParams, stackRule: rule,
      });
    }
  };
  for (const it of content.items.items ?? []) {
    if (it['kind'] === 'pickup') consider(it, 'refresh');
  }
  for (const s of content.skills.items ?? []) consider(s, 'refresh');
  for (const c of content.characters.items ?? []) {
    const passive = (c['passive'] as Array<Record<string, unknown>> | undefined) ?? [];
    for (const e of passive) {
      const p = e['primitive'];
      if (typeof p !== 'string' || byPrimitive.has(p)) continue;
      byPrimitive.set(p, {
        primitive: p, label: text(c['name'], p), group: groupOf(p),
        params: { durationS: TEST_DURATION_S }, stackRule: 'refresh',
      });
    }
  }
  return [...byPrimitive.values()];
}

export function installTestApi(sim: RunnerSim, content: GameContent): TestApi {
  const toggles = collectToggles(content);
  const actions = ACTIONS;
  const api: TestApi = {
    toggles: () => toggles,
    actions: () => actions,
    state() {
      const out: Record<string, number> = {};
      for (const t of toggles) out[t.primitive] = sim.buffs.left(t.primitive);
      return out;
    },
    set(primitive, on) {
      const def = toggles.find(t => t.primitive === primitive);
      if (!def) return;
      if (on) {
        const s = sim.state;
        sim.buffs.add(def.primitive, def.params, def.label, { distance: s.distance, lane: s.lane }, def.stackRule);
      } else {
        sim.buffs.remove(primitive);
      }
    },
    fire(primitive) {
      const def = actions.find(a => a.primitive === primitive);
      if (!def) return;
      const s = sim.state;
      sim.buffs.add(def.primitive, def.params, def.label, { distance: s.distance, lane: s.lane });
    },
    allOff() { for (const t of toggles) sim.buffs.remove(t.primitive); },
  };
  (globalThis as Record<string, unknown>).__trTest = api;
  return api;
}

export function uninstallTestApi(): void {
  delete (globalThis as Record<string, unknown>).__trTest;
}
