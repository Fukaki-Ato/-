import { Button, Color, Node, UIOpacity } from 'cc';
import {
  FailReason,
  type PurchaseResult,
  type ShopGoodsConfig,
  type ShopGoodsView,
  type ShopTab,
} from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';
import { formatNumber } from '../../core/framework/Utils';
import { applySprite, placeholderColorFor } from '../framework/Assets';
import { AudioService } from '../framework/AudioService';
import { BasePanel } from '../framework/BasePanel';
import { ConfirmDialog } from '../framework/ConfirmDialog';
import { CurrencyBar } from '../framework/CurrencyBar';
import { GridList } from '../framework/GridList';
import { LoadingMask } from '../framework/LoadingMask';
import { RewardPopup } from '../framework/RewardPopup';
import { Theme } from '../framework/Theme';
import { Toast } from '../framework/Toast';
import { type TabsView, divider, label, node, panelBg, tabs } from '../framework/UIKit';
import { backButton, currencyColor, currencyIcon, drawRoundRect, gainText, priceFull, priceShort, reasonText } from './panelHelpers';

const log = new Logger();

const SHOP_TABS: ReadonlyArray<{ tab: ShopTab; text: string }> = [
  { tab: 'gold', text: '金币' },
  { tab: 'diamond', text: '钻石' },
  { tab: 'props', text: '道具' },
  { tab: 'special', text: '特惠' },
];

/** 售罄/锁定遮罩色。 */
const MASK_COLOR = new Color(38, 30, 22, 118);

/**
 * iOS 判断占位（docs/04 §3.4）：
 * IPlatformAdapter 当前未暴露系统信息，这里只在微信宿主存在时做最小探测，且仅作为 CNY 商品
 * 可见性的单一实现点；S10 平台接口补齐 isIOS() 后应替换本函数（不改公共契约）。
 */
function isIOSPlatform(): boolean {
  // TODO(S10): 契约提供系统信息后改为平台接口，移除 UI 侧宿主访问。
  try {
    const host = globalThis as { wx?: { getSystemInfoSync?: () => { platform?: string; system?: string } } };
    const info = host.wx?.getSystemInfoSync?.();
    const text = `${info?.platform ?? ''} ${info?.system ?? ''}`.toLowerCase();
    return text.includes('ios');
  } catch {
    return false;
  }
}

/**
 * 商店面板（docs/04 §3.4）：
 * 金币/钻石/道具/特惠四页签；商品卡含价格、限购角标、售罄/锁定置灰；
 * 购买流程 ConfirmDialog → buy → 广告/支付/发货；订阅 shop.changed / currency.changed 刷新。
 */
export class ShopPanel extends BasePanel {
  private tabIndex = 0;
  private tabsView: TabsView | null = null;
  private list: GridList<ShopGoodsView> | null = null;
  private purchasing = false;

  private readonly onDataChanged = (): void => {
    if (this.isOpen) this.reload();
  };

  protected override onCreate(): void {
    const bg = panelBg({ parent: this.node, size: { width: 700, height: 1500 } });

    backButton(bg, () => this.close()).setPosition(-290, 668, 0);
    label('商店', {
      parent: bg,
      size: { width: 300, height: 76 },
      position: [0, 664],
      fontSize: Theme.fontSize.title,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });

    new CurrencyBar(bg, this.ctx, {
      width: 440,
      goldPlus: () => this.selectTab('gold'),
      diamondPlus: () => this.selectTab('diamond'),
    }).node.setPosition(0, 574, 0);
    divider({ parent: bg, width: 620, position: [0, 518] });

    this.tabsView = tabs({
      parent: bg,
      items: SHOP_TABS.map((item) => item.text),
      index: 0,
      width: 640,
      height: 76,
      gap: 10,
      position: [0, 452],
      onChange: (index) => {
        this.tabIndex = index;
        this.reload();
      },
    });

    this.list = new GridList<ShopGoodsView>({
      parent: bg,
      width: 660,
      height: 1130,
      cellWidth: 310,
      cellHeight: 300,
      columns: 2,
      gapX: 18,
      gapY: 22,
      padding: 8,
      emptyText: '本页商品暂时售罄',
    });
    this.list.node.setPosition(0, -170, 0);

    // 面板常驻期间只注册一次；node 销毁（场景切换）时统一解绑。
    this.ctx.events.on('shop.changed', this.onDataChanged, this);
    this.ctx.events.on('currency.changed', this.onDataChanged, this);
    this.node.once(Node.EventType.NODE_DESTROYED, () => this.ctx.events.offTarget(this));
  }

  protected override onOpen(data?: unknown): void {
    const tab = (data as { tab?: ShopTab } | undefined)?.tab;
    const index = SHOP_TABS.findIndex((item) => item.tab === tab);
    if (index >= 0) this.tabIndex = index;
    this.tabsView?.setActive(this.tabIndex, false);
    this.ctx.shop.refreshIfNeeded();
    this.reload();
  }

  // -------------------------------------------------------------------------
  // 列表
  // -------------------------------------------------------------------------

  private reload(): void {
    if (!this.list) return;
    this.ctx.shop.refreshIfNeeded();
    const tab = SHOP_TABS[this.tabIndex]?.tab ?? 'gold';
    this.list.setData(this.visibleGoods(tab), (view, cell) => this.renderCard(view, cell));
  }

  /** iOS 隐藏 iosVisible=false 的 CNY 商品（仅微信平台生效）。 */
  private visibleGoods(tab: ShopTab): ShopGoodsView[] {
    const views = this.ctx.shop.list(tab);
    if (this.ctx.platform.kind !== 'wechat' || !isIOSPlatform()) return views;
    return views.filter((view) => !(view.config.price?.currency === 'CNY' && view.config.iosVisible === false));
  }

  private selectTab(tab: ShopTab): void {
    const index = SHOP_TABS.findIndex((item) => item.tab === tab);
    if (index < 0 || !this.tabsView) return;
    this.tabIndex = index;
    this.tabsView.setActive(index, false);
    this.reload();
  }

  private renderCard(view: ShopGoodsView, cell: Node): void {
    const goods = view.config;
    const card = node('card', { parent: cell, size: { width: 310, height: 300 } });
    const bgNode = node('bg', { parent: card, size: { width: 306, height: 296 } });
    drawRoundRect(bgNode, 306, 296, Theme.color.panel, 20, Theme.color.border, 2);

    const content = node('content', { parent: card, size: { width: 310, height: 300 } });
    const iconNode = node('icon', { parent: content, size: { width: 118, height: 118 }, position: [0, 68] });
    applySprite(iconNode, goods.icon, {
      size: { width: 118, height: 118 },
      radius: Theme.radius.md,
      color: placeholderColorFor(goods.icon),
      placeholderText: goods.name ? goods.name.slice(0, 1) : '?',
    });
    label(goods.name, {
      parent: content,
      size: { width: 292, height: 38 },
      position: [0, -12],
      fontSize: 28,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    label(goods.desc, {
      parent: content,
      size: { width: 286, height: 48 },
      position: [0, -54],
      fontSize: 20,
      color: Theme.color.textSub,
      maxWidth: 286,
      align: 'center',
      overflow: 'clamp',
    });
    this.renderPrice(content, view);

    if (goods.tag) {
      const tagBg = node('tag', { parent: content, size: { width: 92, height: 34 }, position: [-108, 122] });
      drawRoundRect(tagBg, 92, 34, Theme.color.red, 17);
      label(goods.tag, {
        parent: tagBg,
        size: { width: 84, height: 30 },
        fontSize: 20,
        bold: true,
        color: Theme.color.textOnDark,
        align: 'center',
        overflow: 'shrink',
      });
    }
    if (view.remainingDaily !== null) {
      const limit = goods.dailyLimit ?? view.remainingDaily;
      const limitBg = node('limit', { parent: content, size: { width: 110, height: 30 }, position: [96, 124] });
      drawRoundRect(limitBg, 110, 30, MASK_COLOR, 15);
      label(`今日 ${formatNumber(view.remainingDaily)}/${formatNumber(limit)}`, {
        parent: limitBg,
        size: { width: 102, height: 26 },
        fontSize: 18,
        color: Theme.color.sand,
        align: 'center',
        overflow: 'shrink',
      });
    }

    if (view.soldOut || !view.affordable) {
      const opacity = content.addComponent(UIOpacity);
      opacity.opacity = 130;
      const mask = node('lockMask', { parent: card, size: { width: 306, height: 296 } });
      drawRoundRect(mask, 306, 296, MASK_COLOR, 20);
      label(this.lockText(view), {
        parent: mask,
        size: { width: 280, height: 60 },
        position: [0, 30],
        fontSize: 32,
        bold: true,
        color: Theme.color.textOnDark,
        align: 'center',
        overflow: 'shrink',
      });
    }

    const buttonComp = card.addComponent(Button);
    buttonComp.transition = Button.Transition.SCALE;
    buttonComp.target = card;
    buttonComp.zoomScale = 0.96;
    buttonComp.duration = 0.08;
    card.on(Button.EventType.CLICK, () => AudioService.playSfx(Theme.assets.sfxClick));
    card.on(Button.EventType.CLICK, () => void this.purchase(view));
  }

  private renderPrice(parent: Node, view: ShopGoodsView): void {
    const goods = view.config;
    const price = goods.price;
    const y = -118;

    if (goods.viaAd) {
      const pill = node('adPill', { parent, size: { width: 176, height: 56 }, position: [0, y] });
      drawRoundRect(pill, 176, 56, Theme.color.btnGreen, 28);
      label('看视频', {
        parent: pill,
        size: { width: 164, height: 50 },
        fontSize: 26,
        bold: true,
        color: Theme.color.textOnDark,
        align: 'center',
        overflow: 'shrink',
      });
      return;
    }
    if (!price) {
      label('免费', {
        parent,
        size: { width: 160, height: 50 },
        position: [0, y],
        fontSize: 30,
        bold: true,
        color: Theme.color.btnGreen,
        align: 'center',
        overflow: 'shrink',
      });
      return;
    }
    if (price.currency === 'CNY') {
      label(priceShort(price), {
        parent,
        size: { width: 220, height: 50 },
        position: [0, y],
        fontSize: 32,
        bold: true,
        color: Theme.color.wood,
        align: 'center',
        overflow: 'shrink',
      });
      return;
    }
    const iconNode = node('priceIcon', { parent, size: { width: 40, height: 40 }, position: [-42, y] });
    applySprite(iconNode, currencyIcon(price.currency), {
      size: { width: 40, height: 40 },
      radius: 10,
      color: currencyColor(price.currency),
    });
    label(priceShort(price), {
      parent,
      size: { width: 130, height: 46 },
      position: [22, y],
      fontSize: 30,
      bold: true,
      align: 'left',
      overflow: 'shrink',
      color: view.affordable ? Theme.color.text : Theme.color.red,
    });
  }

  private lockText(view: ShopGoodsView): string {
    if (view.soldOut) return '已售罄';
    const price = view.config.price;
    if (price && price.currency !== 'CNY') return `${price.currency === 'gold' ? '金币' : '钻石'}不足`;
    return '暂不可购买';
  }

  // -------------------------------------------------------------------------
  // 购买流程（docs/03 §2.2）
  // -------------------------------------------------------------------------

  private async purchase(view: ShopGoodsView): Promise<void> {
    if (this.purchasing) return;
    const goods = view.config;
    if (view.soldOut) {
      Toast.show('今日已售罄');
      return;
    }
    this.purchasing = true;
    try {
      const content = goods.viaAd
        ? `观看视频广告，免费获得：${gainText(this.ctx, goods.gain)}`
        : `${priceFull(goods.price)}，获得：${gainText(this.ctx, goods.gain)}`;
      const ok = await ConfirmDialog.show({
        title: goods.viaAd ? '免费领取' : '购买确认',
        content,
        okText: goods.viaAd ? '开始观看' : '购买',
      });
      if (!ok || !this.isOpen) return;

      const result = this.ctx.shop.buy(goods.id);
      if (result.ok && result.needAd) {
        await this.claimAd(goods);
        return;
      }
      if (result.ok && result.needPay) {
        await this.payFlow(goods, result.needPay);
        return;
      }
      if (result.ok) {
        this.playReward(result, goods.gain);
        return;
      }
      await this.handleFail(result.reason, view);
    } finally {
      this.purchasing = false;
    }
  }

  private async claimAd(goods: ShopGoodsConfig): Promise<void> {
    LoadingMask.show('广告加载中...');
    try {
      const ad = await this.ctx.platform.ad.show('shop.free.gold');
      if (!this.isOpen) return;
      if (!ad.completed) {
        Toast.show('看完视频才能领取');
        return;
      }
      const result = this.ctx.shop.claimAd(goods.id);
      if (result.ok) this.playReward(result, goods.gain);
      else Toast.show(reasonText(result.reason));
    } catch (err) {
      log.error('广告播放异常', err);
      Toast.show('广告加载失败，请稍后重试');
    } finally {
      LoadingMask.hide();
    }
  }

  private async payFlow(goods: ShopGoodsConfig, needPay: { productId: string; priceFen: number }): Promise<void> {
    LoadingMask.show('支付中...');
    try {
      const pay = await this.ctx.platform.pay({ id: needPay.productId, priceFen: needPay.priceFen });
      if (!this.isOpen) return;
      if (pay.ok) {
        const result = this.ctx.shop.claimPay(goods.id);
        if (result.ok) this.playReward(result, goods.gain);
        else Toast.show(reasonText(result.reason));
        return;
      }
      if (pay.reason === 'cancel') Toast.show('已取消支付');
      else if (pay.reason === 'unsupported') Toast.show('当前环境暂不支持支付');
      else Toast.show('支付失败，请稍后重试');
    } catch (err) {
      log.error('支付异常', err);
      Toast.show('支付异常，请稍后重试');
    } finally {
      LoadingMask.hide();
    }
  }

  private playReward(result: PurchaseResult, fallback: ShopGoodsConfig['gain']): void {
    AudioService.playSfx(Theme.assets.sfxReward);
    void RewardPopup.show(this.ctx.reward.describe(result.reward ?? fallback));
  }

  private async handleFail(reason: string | undefined, view: ShopGoodsView): Promise<void> {
    AudioService.playSfx(Theme.assets.sfxError);
    if (reason === FailReason.Insufficient) {
      const price = view.config.price;
      const currency = price && price.currency !== 'CNY' ? price.currency : 'gold';
      const goGold = currency === 'gold';
      const go = await ConfirmDialog.show({
        title: currency === 'gold' ? '金币不足' : '钻石不足',
        content: goGold ? '去金币页领取免费金币？' : '去钻石页看看充值礼包？',
        okText: goGold ? '去赚金币' : '去充值',
      });
      if (go && this.isOpen) this.selectTab(goGold ? 'gold' : 'diamond');
      return;
    }
    Toast.show(reasonText(reason));
  }
}
