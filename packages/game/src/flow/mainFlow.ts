/**
 * 主流程装配（@tr/game）——从 apps/web/src/bootstrap.ts 提取，两端共用（redesign §3.5）。
 * 职责：平台适配（经 adapter 注入）→ 场景状态机 → 加载配置 → 驱动页面流转；
 *       跑酷局内：每次进入 run 场景创建全新 RunnerSim（seed 记录在案，可复现），
 *       渲染场景消费 sim 事件；死亡 1.2s 后自动进结算页。
 * 铁律：本包零 DOM/wx——挂载点、登录页表单、回车快捷全部经 GameViews 由 apps/* 注入。
 */
import { loadAllConfig } from '@tr/game/core/config/configLoader.js';
import type { FileSource } from '@tr/game/core/config/configLoader.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import { buildLoadout } from '@tr/game/core/sim/character.js';
import { RunnerSim } from '@tr/game/core/sim/runnerSim.js';
import { createSceneMachine } from '@tr/game/core/scene/sceneMachine.js';
import type { SceneName } from '@tr/game/core/scene/sceneMachine.js';
import { createAudioDirector } from '@tr/game/core/audio/audioDirector.js';
import type { AudioDirector } from '@tr/game/core/audio/audioDirector.js';
import { hashSeed } from '@tr/game/core/rng.js';
import { createRunnerScene } from '@tr/game/render/runnerScene.js';
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import type { GameViews, RunSummary } from './views.js';

/** 历史最佳分存储键（v2 修正键；旧版笔误键含真省略号 U+2026，见 LEGACY_BEST_KEY） */
export const BEST_KEY = 'thunderrun:best';
/** 旧版笔误键 'thunderrun:b…st'：bestScore() 读取时一次性迁移，避免旧成绩静默丢失 */
const LEGACY_BEST_KEY = 'thunderrun:b\u2026st';
export const CHAR_KEY = 'thunderrun:character';
export const DEFAULT_CHAR = 'char_volt';

export interface GameFlowDeps {
  adapter: PlatformAdapter;
  views: GameViews;
  /** config 解析器：web 侧 './{name}.json'，wx 侧 'config/{name}.json'（extras.readJson 消费点，S6 接 CDN） */
  configResolve: (name: string) => string;
  debug?: boolean;
}

export interface GameFlow {
  machine: ReturnType<typeof createSceneMachine<SceneName>>;
  /** 加载配置并进入登录页；失败则停在启动页显示错误（不静默吞错）。 */
  boot(): Promise<void>;
  /** 最近一局 seed（同种子复现赛道用）。 */
  currentSeed(): number;
}

export function createGameFlow(deps: GameFlowDeps): GameFlow {
  const { adapter, views } = deps;
  let content: GameContent | null = null;
  let sources: Record<string, FileSource> = {};
  let scene: { dispose(): void } | null = null;
  let hud: ReturnType<GameViews['mountHud']> | null = null;
  let lastSeed = 0;
  /** 音频导演：配置加载成功后创建；game.params.audio 缺省时为空操作（不阻塞玩法） */
  let audio: AudioDirector | null = null;

  /**
   * 历史最佳分（v2 修正）：
   * - 修正键存在 → 解析；脏值（非有限数/非正数）按 0，不把 NaN 带进分数比较；
   * - 修正键缺失且旧笔误键存在 → 一次性迁移：旧值校验通过才写入修正键，随后删旧键；
   * - 两边都没有 / 旧值脏 → 0。写入路径见 result.onEnter（严格 > 才落盘，平纪录不覆盖好值）。
   */
  const bestScore = (): number => {
    const raw = adapter.storage.get(BEST_KEY);
    if (raw !== null) {
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
    const legacy = adapter.storage.get(LEGACY_BEST_KEY);
    if (legacy === null) return 0;
    const n = Number(legacy);
    adapter.storage.remove(LEGACY_BEST_KEY);
    if (!Number.isFinite(n) || n <= 0) return 0;
    adapter.storage.set(BEST_KEY, String(n));
    return n;
  };
  /** 上次选的角色（本机记忆；账号级保存在 S9 接 extras.cloud 后端） */
  let charId = adapter.storage.get(CHAR_KEY) ?? DEFAULT_CHAR;

  const machine = createSceneMachine<SceneName>({
    boot: {},
    login: { onEnter: () => views.renderLogin({ onGuest: () => machine.go('menu') }) },
    menu: {
      onEnter: () => content && views.renderMenu(content, sources, {
        onStartRun: id => { charId = id; adapter.storage.set(CHAR_KEY, id); machine.go('run'); },
        onClearCache: () => {
          Object.keys(sources).forEach(k => adapter.storage.remove('thunderrun:config:' + k));
          adapter.storage.remove('thunderrun:lastUser');
          views.toast('已清除，重新加载页面生效');
        },
      }, charId),
    },
    run: {
      onEnter: () => {
        if (!content) return;
        audio?.enterRun();
        lastSeed = hashSeed('run-' + Date.now());
        const sim: RunnerSim = new RunnerSim(content, lastSeed, charId);
        // v2：主画布幂等单例 + 即时窗口尺寸（S10 §7.2；跨局复用同一画布，不新建）
        const host = { canvas: adapter.canvas.mainCanvas(), size: adapter.canvas.windowSize() };
        hud = views.mountHud();
        hud.update({ score: 0, coins: 0, distance: 0, hits: 0, lives: sim.lives, buffs: [], skill: null });
        scene = createRunnerScene(host, adapter, sim, content, {
          onHud: h => hud?.update(h),
          onEnd: summary => machine.go('result', summary),
          onDeath: () => audio?.onDeath(),
          debug: deps.debug,
        });
      },
      onExit: () => { scene?.dispose(); scene = null; hud?.dispose(); hud = null; audio?.exitRun(); },
    },
    result: {
      onEnter: ctx => {
        // 视图要显示角色名而非内部 id（char_volt → 小电）：查 characters 配置补 charName（content 可空）
        const summary: RunSummary = { ...(ctx as RunSummary) };
        if (content && summary.charId) summary.charName = buildLoadout(content, summary.charId).name;
        const best = bestScore();
        if (summary.score > best) adapter.storage.set(BEST_KEY, String(summary.score));
        views.renderResult(summary, best, {
          onRetry: () => machine.go('run'),
          onMenu: () => machine.go('menu'),
        });
      },
    },
  }, 'boot');

  // 全局按键：run 中 Esc 退出到菜单（v2 onInput 的 key 分支，替代 v1 adapter.onKey，S10 §7.3）
  adapter.onInput(e => {
    if (e.type === 'key' && e.phase === 'down' && e.code === 'Escape' && machine.current() === 'run') {
      machine.go('menu');
    }
  });

  async function boot(): Promise<void> {
    const bootUi = views.renderBoot();
    bootUi.setStatus('加载配置中…', false);
    const report = await loadAllConfig(
      {
        // configLoader 本就是结构化 FileSource（S10 §7.5：S6 起在此前叠 extras.readJson 优先源）
        fetchJson: url => adapter.fetchJson(url),
        cacheGet: k => adapter.storage.get(k),
        cacheSet: (k, v) => adapter.storage.set(k, v),
      },
      deps.configResolve,
    );
    sources = report.sources;
    if (!report.ok) {
      bootUi.setStatus('配置加载失败：\n' + report.errors.join('\n'), true); // 停在启动页，错误信息可见
      return;
    }
    content = report.content;
    audio = createAudioDirector(adapter, content.game.params);
    machine.go('login');
  }

  return { machine, boot, currentSeed: () => lastSeed };
}
