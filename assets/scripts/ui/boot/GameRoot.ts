import { _decorator, Component } from 'cc';
import type { AppConfig, IConfigSource, IGameContext, IPlatformAdapter } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';
import { LocalPlatformAdapter } from '../../core/platform/LocalPlatformAdapter';
import { AD_PLACEMENTS, readWechatExtras } from '../platform/wechat/WechatConfig';
import { WechatPlatformAdapter, type WechatLifecycleHooks } from '../platform/wechat/WechatPlatformAdapter';
import { getGlobalWx } from '../platform/wechat/WechatTypes';
import { createGameContext } from '../../core/services';
import { PanelManager } from '../framework/PanelManager';
import { RedDots } from '../framework/RedDots';
import { UIRoot } from '../framework/UIRoot';
import { registerAllPanels } from '../panels';
import { CocosConfigSource } from './CocosConfigSource';

const { ccclass } = _decorator;
const log = new Logger();

/**
 * 平台适配器工厂（docs/05 §1、S10 任务 1.4）：
 * `typeof wx !== 'undefined'` 且 app.json 配置了 `cloudEnvId` → WechatPlatformAdapter；
 * 否则 LocalPlatformAdapter。`app.json.debug + forceLocal` 可在开发期强制 Local。
 *
 * 需要在创建适配器前读取 app.json 扩展字段（cloudEnvId/adUnits/pay/share），
 * 因此配置源先加载 `app` 表（CocosConfigSource 内部缓存，createGameContext 复用时不会重复请求）。
 */
export async function createPlatformAdapter(
  configSource: IConfigSource,
  lifecycle: WechatLifecycleHooks,
): Promise<IPlatformAdapter> {
  const raw = await configSource.load('app');
  const app = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<AppConfig>;
  const extras = readWechatExtras(raw);
  const wx = getGlobalWx();
  const cloudEnvId = extras.cloudEnvId || (typeof app.cloudEnvId === 'string' ? app.cloudEnvId.trim() : '');
  const forceLocal = app.debug === true && extras.forceLocal;
  if (forceLocal) log.info('app.json debug+forceLocal：强制使用 Local 平台');
  if (wx && cloudEnvId && !forceLocal) {
    log.info(`运行环境：微信小游戏（云环境 ${cloudEnvId}）`);
    return new WechatPlatformAdapter({
      wx,
      log,
      lifecycle,
      cloudEnvId,
      adUnits: extras.adUnits,
      pay: extras.pay,
      share: extras.share,
    });
  }
  if (wx && !cloudEnvId) log.info('检测到微信环境但未配置 cloudEnvId，降级 Local 平台');
  return new LocalPlatformAdapter({ log });
}

/**
 * 游戏根组件（挂到场景节点）：
 * 初始化 UIRoot → 平台适配器（Local/Wechat）→ CocosConfigSource → createGameContext
 * → 广告预加载 → UI 基座装配（PanelManager/RedDots/面板注册）。
 * 启动页（Boot）调用 bootstrap() 获取 ctx；失败时抛出，由 Boot 展示错误与重试。
 */
@ccclass('GameRoot')
export class GameRoot extends Component {
  private bootPromise: Promise<IGameContext> | null = null;
  private adapter: IPlatformAdapter | null = null;
  private ctx: IGameContext | null = null;

  /** 当前平台适配器；bootstrap 完成前为 null（启动失败的清档兜底可用）。 */
  get platform(): IPlatformAdapter | null {
    return this.adapter;
  }

  bootstrap(): Promise<IGameContext> {
    if (!this.bootPromise) {
      this.bootPromise = this.doBootstrap().catch((err) => {
        this.bootPromise = null;
        throw err;
      });
    }
    return this.bootPromise;
  }

  /** 启动失败重试前调用：丢弃上一次失败的装配结果。 */
  resetBoot(): void {
    this.bootPromise = null;
    this.ctx = null;
  }

  private async doBootstrap(): Promise<IGameContext> {
    const root = UIRoot.initialize(this.node);
    const configSource = new CocosConfigSource();
    this.adapter = await createPlatformAdapter(configSource, {
      // wx.onShow → 刷新跨天（refreshDaily）；wx.onHide → 立即落盘（flush）。
      onShow: () => this.ctx?.refreshDaily(),
      onHide: () => this.ctx?.flush(),
    });
    await this.adapter.init();
    const ctx = await createGameContext({
      platform: this.adapter,
      configSource,
    });
    this.ctx = ctx;
    // 成绩结算后同步微信托管数据（好友榜开放数据域读取 bestScore；Local 为日志模拟）。
    ctx.events.on('run.settled', () => {
      this.adapter?.setUserCloudStorage([{ key: 'bestScore', value: String(ctx.save.stats.bestScore) }]);
    });
    // 启动装配完成后统一预加载各广告位一次（未配置广告位时走模拟实现，无副作用）。
    for (const placement of AD_PLACEMENTS) this.adapter.ad.preload(placement);
    PanelManager.init(ctx, root);
    RedDots.setup(ctx);
    registerAllPanels();
    log.info('GameRoot 装配完成');
    return ctx;
  }
}
