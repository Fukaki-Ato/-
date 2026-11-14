/**
 * 两端共享主流程：boot → 大厅/选角/商店/设置 → run → result。
 * 默认游客直入；登录页保留但不在 boot 路径上。页面由宿主注入，包内零 DOM/wx。
 */
import { loadAllConfig } from '@tr/game/core/config/configLoader.js';
import type { GameContent, NamedEntry } from '@tr/game/core/config/configTypes.js';
import { buildLoadout, isCharacterLocked, playableCharacters } from '@tr/game/core/sim/character.js';
import { createSceneMachine } from '@tr/game/core/scene/sceneMachine.js';
import type { SceneName } from '@tr/game/core/scene/sceneMachine.js';
import { createAudioDirector } from '@tr/game/core/audio/audioDirector.js';
import type { AudioDirector } from '@tr/game/core/audio/audioDirector.js';
import { hashSeed, mulberry32 } from '@tr/game/core/rng.js';
import { createRunSession, type RunSessionDeps } from './runSession.js';
import type { LeaderboardService } from './leaderboard.js';
import { createSettingsScene, currentThemeId, pruneThemeSelection, THEME_KEY } from './settingsScene.js';
import { createRunnerScene } from '@tr/game/render/runnerScene.js';
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import type { GameViews, RunSummary } from './views.js';
import { readEntry, saveEntry, type EntryMethod } from './session.js';
import { createStartScene } from './startScene.js';
import { CHAR_KEY, DEFAULT_CHAR, createFlowProgress } from './progress.js';
import type { PlayerAccount } from '../core/playerProfile.js';

export { BEST_KEY, CHAR_KEY, DEFAULT_CHAR, COINS_KEY, DIAMOND_KEY } from './progress.js';
export { THEME_KEY } from './settingsScene.js'; // 定义与读写语义见 settingsScene.ts

export interface GameFlowDeps {
  adapter: PlatformAdapter;
  views: GameViews;
  /** config 解析器：web 侧 './{name}.json'，wx 侧 'config/{name}.json'（extras.readJson 消费点，S6 接 CDN） */
  configResolve: (name: string) => string;
  debug?: boolean;
  /** 音频随机源（死亡音效池抽取）；缺省为独立于玩法 RNG 的 mulberry32 流，测试可注入 */
  audioRandom?: () => number;
  /** 局内场景工厂（缺省 createRunnerScene）；测试注入假场景以驱动 sim 事件回调而无需 GL */
  createScene?: typeof createRunnerScene;
  /** 测试模式（?debug/?test）：run 局内挂载 __trTest 技能开关 API，供左侧测试面板消费 */
  test?: boolean;
  leaderboard?: LeaderboardService;
  account?: PlayerAccount;
  /** 宿主可录制任务回放，结束函数由 RunSession 在死亡或退出时调用。 */
  trackRun?: RunSessionDeps['trackRun'];
}

export interface GameFlow {
  machine: ReturnType<typeof createSceneMachine<SceneName>>;
  /** 加载配置并进入开始页；失败则停在启动页显示错误（不静默吞错）。 */
  boot(): Promise<void>;
  /** 最近一局 seed（同种子复现赛道用）。 */
  currentSeed(): number;
  finishRun(): boolean;
  dispose(): void;
}

export function createGameFlow(deps: GameFlowDeps): GameFlow {
  const { adapter, views } = deps;
  let content: GameContent | null = null;
  let scene: ReturnType<typeof createRunSession> | null = null;
  let lastSeed = 0;
  /** 音频导演：配置加载成功后创建；game.params.audio 缺省时为空操作（不阻塞玩法） */
  let audio: AudioDirector | null = null;

  const progress = createFlowProgress(adapter.storage, deps.account);
  /** 上次选的角色（本机记忆；账号级保存在 S9 接 extras.cloud 后端） */
  let charId = progress.initialCharacter();
  const knownCharacterEntry = (id: string): NamedEntry | undefined =>
    content ? playableCharacters(content).find(character => character.id === id) : undefined;
  const knownCharacter = (id: string): boolean => knownCharacterEntry(id) !== undefined;
  const explicitlyLockedId = (id: string): boolean => {
    const character = knownCharacterEntry(id);
    return character ? isCharacterLocked(character) : false;
  };
  const availableCharacter = (id: string): boolean =>
    content !== null && progress.owns(id) && playableCharacters(content).some(character => character.id === id && !isCharacterLocked(character));
  const fallbackCharacter = (): string => {
    if (!content) return '';
    const available = playableCharacters(content).filter(character => !isCharacterLocked(character) && progress.owns(character.id));
    return available.find(character => character.id === DEFAULT_CHAR)?.id ?? available[0]?.id ?? '';
  };
  function rememberCharacter(id: string): boolean {
    if (!availableCharacter(id)) return false;
    charId = id;
    adapter.storage.set(CHAR_KEY, id);
    return true;
  }
  function normalizeCharacter(): void {
    if (!availableCharacter(charId)) charId = fallbackCharacter();
    const stored = adapter.storage.get(CHAR_KEY);
    if (charId) {
      if (stored !== charId) adapter.storage.set(CHAR_KEY, charId);
    } else if (stored !== null) adapter.storage.remove(CHAR_KEY);
  }
  /** 上次在开始页选的入口（本机记忆，选角页展示）；无记忆＝游客态直入主界面 */
  let entry: EntryMethod | null = readEntry(adapter.storage);

  const enterSelect = (method: EntryMethod): void => {
    entry = method;
    saveEntry(adapter.storage, method);
    machine.go('select');
  };
  let shopBack: (() => void) | null = null;

  const showSelect = (): void => {
    audio?.stopDeathMusic();
    if (content) views.renderSelect(content, {
      onStartRun: id => { if (rememberCharacter(id)) machine.go('run'); },
      onChooseCharacter: id => rememberCharacter(id), onBack: () => machine.go('start'),
      onCharacterSelect: views.renderCharacterSelectPage ? () => machine.go('characterSelect') : undefined,
      onShop: () => machine.go('shop', { returnTo: 'select' }), onSettings: () => machine.go('settings'),
      onLeaderboard: deps.leaderboard && views.renderLeaderboard ? () => machine.go('leaderboard') : undefined,
      onTasks: views.renderWelfare ? () => machine.go('tasks') : undefined,
      onHandbook: views.renderWelfare ? () => machine.go('handbook') : undefined,
      onInventory: views.renderInventory ? () => machine.go('inventory') : undefined,
    }, charId, entry, progress.wallet());
  };

  const machine: GameFlow['machine'] = createSceneMachine<SceneName>({
    boot: {},
    start: createStartScene(adapter, views, enterSelect, () => machine.current() === 'start'),
    select: {
      onEnter: showSelect,
    },
    characterSelect: {
      onEnter: ctx => {
        audio?.stopDeathMusic();
        if (!content || !views.renderCharacterSelectPage) { machine.go('select'); return; }
        const requested = typeof ctx === 'object' && ctx !== null ? (ctx as { characterId?: unknown }).characterId : undefined;
        const selected = typeof requested === 'string' && knownCharacter(requested) ? requested : charId;
        views.renderCharacterSelectPage(content, {
          onSelect: id => { rememberCharacter(id); },
          onStartRun: id => { if (rememberCharacter(id)) machine.go('run'); },
          onBack: () => machine.go('select'),
          onShop: id => {
            if (!knownCharacter(id)) return;
            if (!explicitlyLockedId(id)) rememberCharacter(id);
            machine.go('shop', { returnTo: 'characterSelect', characterId: id });
          },
        }, selected, entry);
      },
    },
    shop: {
      onEnter: ctx => {
        const request = typeof ctx === 'object' && ctx !== null ? ctx as { returnTo?: unknown; characterId?: unknown } : {};
        const returnTo = request.returnTo === 'characterSelect' ? 'characterSelect'
          : request.returnTo === 'inventory' ? 'inventory' : 'select';
        const characterId = typeof request.characterId === 'string' && knownCharacter(request.characterId)
          ? request.characterId : undefined;
        if (!content) { machine.go('select'); return; }
        shopBack = () => machine.go(returnTo, returnTo === 'characterSelect' ? { characterId } : undefined);
        views.renderShop(content, { onBack: () => shopBack?.() });
      },
      onExit: () => { shopBack = null; },
    },
    settings: createSettingsScene({
      storage: adapter.storage, views, content: () => content,
      goSelect: () => machine.go('select'), stopDeathMusic: () => audio?.stopDeathMusic(),
    }),
    leaderboard: {
      onEnter: () => {
        if (!deps.leaderboard || !views.renderLeaderboard) { machine.go('select'); return; }
        views.renderLeaderboard(deps.leaderboard, { onBack: () => machine.go('select') });
      },
    },
    tasks: { onEnter: () => {
      if (views.renderWelfare) views.renderWelfare('tasks', { onBack: () => machine.go('select') });
      else machine.go('select');
    } },
    handbook: { onEnter: () => {
      if (views.renderWelfare) views.renderWelfare('handbook', { onBack: () => machine.go('select') });
      else machine.go('select');
    } },
    inventory: { onEnter: () => {
      if (views.renderInventory) views.renderInventory({ onBack: () => machine.go('select'), onShop: () => machine.go('shop', { returnTo: 'inventory' }) });
      else machine.go('select');
    } },
    run: {
      onEnter: () => {
        if (!content) return;
        if (!availableCharacter(charId)) normalizeCharacter();
        if (!charId || !availableCharacter(charId)) { views.toast('暂无可用角色'); return; }
        audio?.enterRun(charId);
        scene = createRunSession({
          adapter, views, content, charId, service: deps.leaderboard,
          cloudProgress: !!deps.account,
          createScene: deps.createScene, debug: deps.debug, test: deps.test,
          trackRun: deps.trackRun,
          themeId: currentThemeId(adapter.storage, content) ?? undefined,
          onSeed: seed => { lastSeed = seed; }, onEnd: summary => machine.go('result', summary),
          onDeath: () => audio?.onDeath(),
          onCast: () => audio?.onCast(),
          onPickup: () => audio?.onPickup(),
        });
      },
      onExit: () => {
        scene?.dispose(); scene = null;
        // 已死亡时 exitRun 保留死亡 BGM 到结算页；中途退出则停 run BGM
        audio?.exitRun();
      },
    },
    result: {
      onEnter: ctx => {
        // 视图要显示角色名而非内部 id（char_volt → 小电）：查 characters 配置补 charName（content 可空）
        const summary: RunSummary = { ...(ctx as RunSummary) };
        if (content && summary.charId) summary.charName = buildLoadout(content, summary.charId).name;
        const best = progress.bestScore();
        progress.recordLocal(summary);
        views.renderResult(summary, best, {
          onRetry: () => { if (rememberCharacter(charId)) machine.go('run'); },
          onSelect: () => machine.go('select'),
          onLeaderboard: deps.leaderboard && views.renderLeaderboard ? () => machine.go('leaderboard') : undefined,
        });
      },
      // 离开结算（重开/回选角）：停死亡 BGM，避免与下一局 run BGM 重叠
      onExit: () => audio?.stopDeathMusic(),
    },
  }, 'boot');
  const syncAccountSelection = (): void => {
    const preferences = deps.account?.read().preferences;
    if (!preferences || !content) return;
    if (preferences.characterId !== charId) rememberCharacter(preferences.characterId);
    if (content.themes.items?.some(theme => theme.id === preferences.themeId)
      && adapter.storage.get(THEME_KEY) !== preferences.themeId) adapter.storage.set(THEME_KEY, preferences.themeId);
  };
  const offAccount = deps.account?.subscribe(() => {
    syncAccountSelection(); if (machine.current() === 'select') showSelect();
  });

  // 全局按键：run 中 Esc 退回选角页（v2 onInput 的 key 分支，替代 v1 adapter.onKey，S10 §7.3）
  const offInput = adapter.onInput(e => {
    if (e.type === 'key' && e.phase === 'down' && e.code === 'Escape' && machine.current() === 'run') machine.go('select');
    else if (e.type === 'key' && e.phase === 'down' && e.code === 'Escape' && machine.current() === 'shop') shopBack?.();
    else if (e.type === 'key' && e.phase === 'down' && e.code === 'Escape' && machine.current() === 'settings') machine.go('select');
    else if (e.type === 'key' && e.phase === 'down' && e.code === 'Escape' && machine.current() === 'leaderboard') machine.go('select');
    else if (e.type === 'key' && e.phase === 'down' && e.code === 'Escape'
      && (machine.current() === 'tasks' || machine.current() === 'handbook' || machine.current() === 'inventory')) machine.go('select');
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
    if (!report.ok) {
      bootUi.setStatus('配置加载失败：\n' + report.errors.join('\n'), true); // 停在启动页，错误信息可见
      return;
    }
    content = report.content;
    syncAccountSelection();
    normalizeCharacter();
    pruneThemeSelection(adapter.storage, content); // 存档主题已删/改名 → 清掉，不把无效 id 带进渲染
    audio = createAudioDirector(adapter, content.game.params, {
      random: deps.audioRandom ?? mulberry32(hashSeed('audio-' + Date.now())),
    });
    // 游客态直入主界面：不要求登录、不调 adapter.extras.login()、不显示授权弹窗。
    // 开始页（微信/游客两入口）保留在场景机里但不再有入口可达，登录代码零调用。
    if (entry === null) {
      entry = 'guest';
      saveEntry(adapter.storage, 'guest');
    }
    machine.go('select');
  }

  return {
    machine, boot, currentSeed: () => lastSeed,
    finishRun: () => machine.current() === 'run' ? scene?.finish() ?? false : false,
    dispose() { offInput(); offAccount?.(); machine.go('boot'); audio?.dispose(); },
  };
}
