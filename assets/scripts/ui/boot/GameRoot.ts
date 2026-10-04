import { _decorator, Component } from 'cc';
import type { IGameContext, IPlatformAdapter } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';
import { LocalPlatformAdapter } from '../../core/platform/LocalPlatformAdapter';
import { createGameContext } from '../../core/services';
import { PanelManager } from '../framework/PanelManager';
import { RedDots } from '../framework/RedDots';
import { UIRoot } from '../framework/UIRoot';
import { registerAllPanels } from '../panels';
import { CocosConfigSource } from './CocosConfigSource';

const { ccclass } = _decorator;
const log = new Logger();

/**
 * 平台适配器工厂。
 * S10 才接入微信平台：届时在此探测运行环境（typeof wx）并返回 WechatAdapter。
 * TODO(S10): 环境探测 + WechatAdapter（登录/广告/云/支付）装配。
 */
export function createPlatformAdapter(_ctx?: IGameContext): IPlatformAdapter {
  return new LocalPlatformAdapter({ log });
}

/**
 * 游戏根组件（挂到场景节点）：
 * 初始化 UIRoot → 平台适配器 → CocosConfigSource → createGameContext → UI 基座装配
 * （PanelManager/RedDots/面板注册）。
 * 启动页（Boot）调用 bootstrap() 获取 ctx；失败时抛出，由 Boot 展示错误与重试。
 */
@ccclass('GameRoot')
export class GameRoot extends Component {
  private bootPromise: Promise<IGameContext> | null = null;
  private adapter: IPlatformAdapter | null = null;

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
  }

  private async doBootstrap(): Promise<IGameContext> {
    const root = UIRoot.initialize(this.node);
    this.adapter = createPlatformAdapter();
    await this.adapter.init();
    const ctx = await createGameContext({
      platform: this.adapter,
      configSource: new CocosConfigSource(),
    });
    PanelManager.init(ctx, root);
    RedDots.setup(ctx);
    registerAllPanels();
    log.info('GameRoot 装配完成');
    return ctx;
  }
}
