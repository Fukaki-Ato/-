import { _decorator, Component, Layers, Node, director } from 'cc';
import type { IGameContext, IStorage, LoginResult } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';
import { ConfirmDialog } from '../framework/ConfirmDialog';
import { PanelManager } from '../framework/PanelManager';
import { TextDialog } from '../framework/TextDialog';
import { Toast } from '../framework/Toast';
import { UIRoot } from '../framework/UIRoot';
import { PANEL_NAMES } from '../panels';
import { BootScreen } from './BootScreen';
import { DebugPanel } from './DebugPanel';
import { GameRoot } from './GameRoot';
import { resetSaveAndRestart } from './ResetSupport';

const { ccclass } = _decorator;
const log = new Logger();

/** 隐私摘要（完整文本见 app.json 的 privacyPolicy，通过 TextDialog 展示）。 */
const PRIVACY_DIGEST = '为了保障您的权益，请阅读并同意《隐私保护指引》。取得您的同意后，我们才会获取微信昵称、头像与登录标识，用于账号登录与云存档；完整条款可在启动页或设置中随时查看。';

/**
 * 启动流程组件（场景挂载点）：
 * 启动页展示 → 隐私授权（未同意先弹政策）→ 登录（失败降级游客）→ refreshDaily
 * → 打开主界面。任一步失败显示错误文本 + 重试/重置存档，不白屏。
 */
@ccclass('Boot')
export class Boot extends Component {
  private screen: BootScreen | null = null;
  private gameRoot: GameRoot | null = null;
  private ctx: IGameContext | null = null;

  protected override start(): void {
    try {
      this.gameRoot = findOrCreateGameRoot(this.node);
      UIRoot.initialize(this.node);
      this.screen = new BootScreen();
      this.screen.onVersionLongPress = () => this.openDebugIfEnabled();
      this.screen.onPolicyView = () => void this.viewPrivacyPolicy();
      this.screen.onConsentRetry = () => void this.retryConsent();
      void this.run();
    } catch (err) {
      log.error('Boot 启动异常', err);
    }
  }

  private async run(): Promise<void> {
    const gameRoot = this.gameRoot;
    if (!gameRoot) return;
    try {
      const screen = this.requireScreen();
      screen.hideError();
      screen.setStatus('正在加载配置...');
      const ctx = await gameRoot.bootstrap();
      this.ctx = ctx;
      screen.setVersion(ctx.config.app().version);
      screen.setStatus('正在初始化...');
      if (!(await this.ensurePrivacy(ctx))) {
        screen.setStatus('需同意隐私政策后才能继续游戏');
        screen.showConsentRetry(true);
        return;
      }
      await this.enterMainMenu(ctx);
    } catch (err) {
      this.showError(err);
    }
  }

  private async enterMainMenu(ctx: IGameContext): Promise<void> {
    const screen = this.requireScreen();
    screen.setStatus('正在登录...');
    await this.ensureLogin(ctx);
    ctx.refreshDaily();
    screen.setStatus('正在进入主界面...');
    const panel = await PanelManager.open(PANEL_NAMES.mainMenu);
    if (!panel) throw new Error('主界面面板未注册（registerAllPanels 未生效）');
    screen.dispose();
    this.screen = null;
    log.info('已进入主界面');
  }

  // -------------------------------------------------------------------------
  // 隐私授权
  // -------------------------------------------------------------------------

  private async ensurePrivacy(ctx: IGameContext): Promise<boolean> {
    if (ctx.save.flags.privacyAccepted === true) return true;
    return this.requestConsent(ctx);
  }

  private async requestConsent(ctx: IGameContext): Promise<boolean> {
    await TextDialog.show({
      title: '隐私政策',
      text: ctx.config.app().privacyPolicy,
      closeText: '已阅读',
    });
    const accepted = await ConfirmDialog.show({
      title: '隐私保护提示',
      content: PRIVACY_DIGEST,
      okText: '同意并继续',
      cancelText: '暂不同意',
    });
    if (accepted) {
      ctx.save.flags.privacyAccepted = true;
      ctx.markDirty();
    }
    return accepted;
  }

  private async viewPrivacyPolicy(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await TextDialog.show({ title: '隐私政策', text: ctx.config.app().privacyPolicy });
  }

  private async retryConsent(): Promise<void> {
    const ctx = this.ctx;
    const screen = this.screen;
    if (!ctx || !screen) return;
    try {
      if (!(await this.requestConsent(ctx))) return;
      screen.showConsentRetry(false);
      await this.enterMainMenu(ctx);
    } catch (err) {
      this.showError(err);
    }
  }

  // -------------------------------------------------------------------------
  // 登录
  // -------------------------------------------------------------------------

  private async ensureLogin(ctx: IGameContext): Promise<void> {
    try {
      const login = await ctx.platform.login();
      this.applyLogin(ctx, login);
    } catch (err) {
      log.warn('平台登录失败，降级游客模式', err);
      ctx.save.profile.isGuest = true;
      ctx.markDirty();
      Toast.show('游客模式');
    }
  }

  /** uid 不同视为新设备：仅更新 profile，不覆盖本地存档。 */
  private applyLogin(ctx: IGameContext, login: LoginResult): void {
    const prev = ctx.save.profile;
    const sameDevice = prev.uid === login.uid;
    ctx.save.profile = {
      uid: login.uid,
      nickname: login.nickname,
      avatarUrl: login.avatarUrl,
      isGuest: login.isGuest,
      createdAt: sameDevice ? prev.createdAt : Date.now(),
    };
    ctx.markDirty();
    if (!sameDevice) log.info(`新设备登录 ${login.uid}，保留本地存档`);
  }

  // -------------------------------------------------------------------------
  // 错误兜底与调试入口
  // -------------------------------------------------------------------------

  private showError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    log.error('启动失败', err);
    const screen = this.screen;
    if (!screen) {
      Toast.show(`启动失败：${message}`);
      return;
    }
    screen.showError(message, {
      onRetry: () => void this.retry(),
      onReset: () => void this.confirmResetSave(),
    });
  }

  private async retry(): Promise<void> {
    const gameRoot = this.gameRoot;
    const screen = this.screen;
    if (!gameRoot || !screen) return;
    this.ctx = null;
    gameRoot.resetBoot();
    screen.hideError();
    screen.showConsentRetry(false);
    await this.run();
  }

  private async confirmResetSave(): Promise<void> {
    const ok = await ConfirmDialog.show({
      title: '重置存档',
      content: '将清空本地存档并重新启动，确定继续吗？',
      okText: '重置并重启',
      cancelText: '取消',
    });
    if (!ok) return;
    resetSaveAndRestart(this.ctx, this.storageForReset());
  }

  private storageForReset(): IStorage | null {
    return this.ctx?.platform.storage ?? this.gameRoot?.platform?.storage ?? null;
  }

  private openDebugIfEnabled(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.config.app().debug !== true) return;
    DebugPanel.toggle(ctx);
  }

  private requireScreen(): BootScreen {
    if (!this.screen) throw new Error('启动页不可用');
    return this.screen;
  }
}

/** 场景中查找 GameRoot；不存在时在 Boot 同级节点下补建（兼容手动搭场景）。 */
function findOrCreateGameRoot(host: Node): GameRoot {
  const scene = director.getScene();
  const existing = scene?.getComponentInChildren(GameRoot) ?? null;
  if (existing) return existing;
  const holder = new Node('GameRoot');
  holder.layer = Layers.Enum.UI_2D;
  const parent = host.parent ?? scene;
  if (parent) parent.addChild(holder);
  return holder.addComponent(GameRoot);
}
