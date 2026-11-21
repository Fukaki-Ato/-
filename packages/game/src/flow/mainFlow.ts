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
import { consumeEquipped, runEnhance } from './localEconomy.js';
import { configLocked, isCharacterGated, selectUnlockActions } from './unlock.js';
import { createEventsScene } from './eventsScene.js';
import { createShopScene } from './shopScene.js';
import { createChestScene } from './chestScene.js';
import { createStartScene } from './startScene.js';
import { createAchievementsScene } from './achievementsScene.js';
import { createAchievementTracker, trackLocalAchievementRun } from './achievementTracker.js';
import type { AchievementApiLike } from './achievementApiCore.js';
import { TelemetryRecorder } from './telemetry.js';
import { createSettingsScene, currentThemeId, pruneThemeSelection, themeMusic, volumePrefs, THEME_KEY } from './settingsScene.js';
import { createRunnerScene } from '@tr/game/render/runnerScene.js';
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import type { GameViews, RunSummary } from './views.js';
import { readEntry, saveEntry, type EntryMethod } from './session.js';
import { CHAR_KEY, DEFAULT_CHAR, createFlowProgress } from './progress.js';
import type { PlayerAccount } from '../core/playerProfile.js';

export { BEST_KEY, CHAR_KEY, DEFAULT_CHAR, COINS_KEY, DIAMOND_KEY } from './progress.js';
export { THEME_KEY } from './settingsScene.js';

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
  /** QA 口径位（?anim/?ui=demo；debugMode 同源 qa=debug||test||qa）：关掉 run 局成就统计 */
  qa?: boolean;
  leaderboard?: LeaderboardService;
  account?: PlayerAccount;
  /** 宿主可录制任务回放，结束函数由 RunSession 在死亡或退出时调用。 */
  trackRun?: RunSessionDeps['trackRun'];
  /** 成就 API（web 壳注入）：缺省＝成就页入口不亮（防死按钮）；run 局成就统计不受此项影响 */
  achievementsApi?: AchievementApiLike;
}

export interface GameFlow {
  machine: ReturnType<typeof createSceneMachine<SceneName>>;
  /** 加载配置并进入开始页；失败则停在启动页显示错误（不静默吞错）。 */
  boot(): Promise<void>;
  /** 最近一局 seed（同种子复现赛道用）。 */
  currentSeed(): number;
  /** 遥测骨架读取口（S16b 前置；debug 探针/未来 QA 面板消费） */
  telemetry(): { snapshot(): unknown[]; summary(): Record<string, unknown> };
  finishRun(): boolean;
  dispose(): void;
}

export function createGameFlow(deps: GameFlowDeps): GameFlow {
  const { adapter, views } = deps;
  let content: GameContent | null = null;
  let scene: ReturnType<typeof createRunSession> | null = null;
  let lastSeed = 0;
  let casual = false;
  const telemetry = new TelemetryRecorder(adapter.storage);
  const tracker = createAchievementTracker(adapter.storage, () => content);
  const trackAchievements: RunSessionDeps['trackAchievements'] = deps.account || deps.debug || deps.test || deps.qa
    ? undefined : sim => trackLocalAchievementRun(tracker, sim, content);
  /** 音频导演：配置加载成功后创建；game.params.audio 缺省时为空操作（不阻塞玩法） */
  let audio: AudioDirector | null = null;

  const progress = createFlowProgress(adapter.storage, deps.account);
  /** 上次选的角色（本机记忆；账号级保存在 S9 接 extras.cloud 后端） */
  let charId = progress.initialCharacter();
  const knownCharacterEntry = (id: string): NamedEntry | undefined =>
    content ? playableCharacters(content).find(character => character.id === id) : undefined;
  const knownCharacter = (id: string): boolean => knownCharacterEntry(id) !== undefined;
  // 可出战 = 未被 config 锁定 且 不被解锁门槛挡住（unlock 字段：coin/key/loot/event，记录在 localEconomy）
  const availableCharacter = (id: string): boolean => {
    const c = content;
    return c !== null && progress.owns(id) && playableCharacters(c).some(character => character.id === id
      && !isCharacterLocked(character) && !isCharacterGated(c, id, adapter.storage));
  };
  const fallbackCharacter = (): string => {
    if (!content) return '';
    const available = playableCharacters(content).filter(character => availableCharacter(character.id));
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
  const shopScene = createShopScene({
    adapter, views, content: () => content,
    goShopBack: (returnTo, characterId) => machine.go(returnTo, returnTo === 'characterSelect' ? { characterId } : undefined),
    onCharacterUnlocked: () => tracker.applyCharacterUnlock(),
  });
  const chestScene = createChestScene({ adapter, views, content: () => deps.account ? null : content,
    goSelect: () => machine.go('select'), onCharacterUnlocked: () => tracker.applyCharacterUnlock() });

  const showSelect = (): void => {
    audio?.stopDeathMusic();
    if (content) views.renderSelect(content, {
      onStartRun: id => { if (rememberCharacter(id)) machine.go('run'); },
      onStartCasual: !deps.account && deps.leaderboard ? id => { if (rememberCharacter(id)) machine.go('run', 'casual'); } : undefined,
      onChooseCharacter: id => rememberCharacter(id), onBack: () => machine.go('start'),
      onCharacterSelect: views.renderCharacterSelectPage ? () => machine.go('characterSelect') : undefined,
      onShop: () => machine.go('shop', { returnTo: 'select' }), onSettings: () => machine.go('settings'),
      onChest: !deps.account && views.renderChest ? () => machine.go('chest') : undefined,
      onEvents: views.renderEvents ? () => machine.go('events') : undefined,
      onAchievements: views.renderAchievements && deps.achievementsApi ? () => machine.go('achievements') : undefined,
      onLeaderboard: deps.leaderboard && views.renderLeaderboard ? () => machine.go('leaderboard') : undefined,
      onTasks: views.renderWelfare ? () => machine.go('tasks') : undefined,
      onHandbook: views.renderWelfare ? () => machine.go('handbook') : undefined,
      onInventory: views.renderInventory ? () => machine.go('inventory') : undefined,
    }, charId, entry, progress.wallet());
  };

  const machine: GameFlow['machine'] = createSceneMachine<SceneName>({
    boot: {},
    start: createStartScene(adapter, views, enterSelect, () => machine.current() === 'start'),
    select: { onEnter: showSelect },
    characterSelect: {
      onEnter: ctx => {
        audio?.stopDeathMusic();
        if (!content || !views.renderCharacterSelectPage) { machine.go('select'); return; }
        const requested = typeof ctx === 'object' && ctx !== null ? (ctx as { characterId?: unknown }).characterId : undefined;
        const selected = typeof requested === 'string' && knownCharacter(requested) ? requested : charId;
        const c = content;
        views.renderCharacterSelectPage(content, {
          onSelect: id => { rememberCharacter(id); },
          onStartRun: id => { if (rememberCharacter(id)) machine.go('run'); },
          onBack: () => machine.go('select'),
          onShop: id => {
            if (!knownCharacter(id)) return;
            if (!configLocked(c, id)) rememberCharacter(id);
            machine.go('shop', { returnTo: 'characterSelect', characterId: id });
          },
          // 解锁门槛（本机经济，审查 M4-3）：coin/key 扣价、碎片合成、活动型只登记；
          // onUnlocked 是 charactersUnlocked 的唯一生产接线点（成就本地落盘）
          ...selectUnlockActions(adapter.storage, c, { onUnlocked: () => tracker.applyCharacterUnlock() }),
        }, selected, entry);
      },
    },
    shop: shopScene,
    chest: chestScene,
    events: createEventsScene({ adapter, views, content: () => content, goSelect: () => machine.go('select') }),
    settings: createSettingsScene({
      storage: adapter.storage, views, content: () => content,
      goSelect: () => machine.go('select'), stopDeathMusic: () => audio?.stopDeathMusic(),
    }),
    achievements: createAchievementsScene({
      views, content: () => content, goSelect: () => machine.go('select'),
      tracker, api: deps.achievementsApi,
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
      onEnter: mode => {
        if (!content) return;
        if (!availableCharacter(charId)) normalizeCharacter();
        if (!charId || !availableCharacter(charId)) { views.toast('暂无可用角色'); return; }
        casual = !deps.account && mode === 'casual';
        audio?.enterRun(charId, themeMusic(adapter.storage, content)); // 按当前主题选 BGM，缺省回退全局 run
        scene = createRunSession({
          adapter, views, content, charId, service: casual ? undefined : deps.leaderboard,
          cloudProgress: !!deps.account,
          createScene: deps.createScene, debug: deps.debug, test: deps.test,
          trackRun: deps.trackRun, trackAchievements,
          consumeItems: deps.account ? undefined : () => consumeEquipped(adapter.storage, content!),
          enhance: deps.account ? undefined : runEnhance(adapter.storage, content, charId),
          recordRun: (state, meta) => telemetry.recordRun(state, meta),
          themeId: currentThemeId(adapter.storage, content) ?? undefined,
          onSeed: seed => { lastSeed = seed; }, onEnd: summary => machine.go('result', summary),
          onDeath: () => audio?.onDeath(), onCast: () => audio?.onCast(),
          onPickup: () => audio?.onPickup(), onIntro: stage => audio?.onIntro(stage),
        });
      },
      // 已死亡时 exitRun 保留死亡 BGM 到结算页；中途退出则停 run BGM
      onExit: () => { scene?.dispose(); scene = null; audio?.exitRun(); },
    },
    result: {
      onEnter: ctx => {
        // 视图要显示角色名而非内部 id（char_volt → 小电）：查 characters 配置补 charName（content 可空）
        const summary: RunSummary = { ...(ctx as RunSummary) };
        if (content && summary.charId) summary.charName = buildLoadout(content, summary.charId).name;
        const best = progress.bestScore();
        progress.recordLocal(summary);
        const lbEntry = deps.leaderboard && views.renderLeaderboard ? () => machine.go('leaderboard') : undefined;
        views.renderResult(summary, best, {
          onRetry: () => { if (rememberCharacter(charId)) machine.go('run', casual ? 'casual' : undefined); },
          onSelect: () => machine.go('select'), onLeaderboard: lbEntry,
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

  const offInput = adapter.onInput(e => {
    if (e.type !== 'key' || e.phase !== 'down' || e.code !== 'Escape') return;
    const current = machine.current();
    if (current === 'shop') shopScene.escape();
    else if (current === 'chest') chestScene.escape();
    else if (['run', 'settings', 'achievements', 'leaderboard', 'tasks', 'handbook', 'inventory'].includes(current)) machine.go('select');
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
      volumes: () => volumePrefs(adapter.storage, content), // 用户音量偏好每次播放时读取，设置页改完即生效
    });
    // 游客态直入主界面：不要求登录、不调 adapter.extras.login()（开始页保留在场景机但入口不可达）
    if (entry === null) { entry = 'guest'; saveEntry(adapter.storage, 'guest'); }
    machine.go('select');
  }

  return {
    machine, boot, currentSeed: () => lastSeed,
    telemetry: () => ({ snapshot: () => telemetry.snapshot(), summary: () => telemetry.summary() }),
    finishRun: () => machine.current() === 'run' ? scene?.finish() ?? false : false,
    dispose() { offInput(); offAccount?.(); machine.go('boot'); audio?.dispose(); },
  };
}
