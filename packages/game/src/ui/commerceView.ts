import { Box, ScrollView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { CommerceService, CommerceSnapshot, MarketOffer } from '../core/commerce.js';
import type { CommerceArtwork } from './commerceArtwork.js';
export type { CommerceArtwork } from './commerceArtwork.js';
import { coast, text, WelfareAction, commerceCard, offerDetails, offerAvailable,
  offerCard, characterCard, inventoryCard, themeCard } from './commerceCards.js';

export interface CommercePageActions {
  onBack(): void;
  onShop?(characterId: string): void;
  onStartRun?(characterId: string): void;
  onSelected?(characterId: string): void;
  onThemeSelected?(themeId: string): boolean | void;
}
type Operation = { kind: 'buy'; id: string; requestId: string; version: string }
  | { kind: 'equip' | 'theme'; id: string };
type Quote = { offer: MarketOffer; version: string; requestId?: string };
const definiteRejections = new Set(['INVALID_REQUEST', 'CATALOG_CHANGED', 'OFFER_UNAVAILABLE',
  'INSUFFICIENT_FUNDS', 'ALREADY_OWNED', 'PURCHASE_LIMIT', 'PURCHASE_CONFLICT', 'PURCHASE_NOT_SAVED']);
const errorCode = (error: unknown): string => typeof error === 'object' && error !== null
  && 'code' in error && typeof error.code === 'string' ? error.code : '';

export function mountCommercePage(host: UiHost, service: CommerceService | undefined,
  mode: 'shop' | 'inventory' | 'characters' | 'settings', actions: CommercePageActions,
  artwork: CommerceArtwork = {}): () => void {
  let disposed = false, loading = false, catalogChanged = false, unconfirmed = false;
  let data: CommerceSnapshot | undefined, pending: Operation | undefined, retry: Operation | undefined;
  let quote: Quote | undefined, category: MarketOffer['category'] = 'character';
  let message = service ? '加载中…' : '云服务未配置，暂时无法读取和保存。';
  let loadFailed = false;
  const names = { shop: '商店', inventory: '仓库', characters: '角色', settings: '设置' };
  const intros = { shop: '海岸补给站', inventory: '我的跑酷收藏', characters: '选择你的跑酷伙伴', settings: '我的海岸风景' };
  const view = host.makeView();
  const header = new Box({ direction: 'row', gap: 8, padding: 14, align: 'center' });
  const content = new Box({ gap: 12, padding: { left: 14, right: 14, bottom: 18 } });
  const scroll = new ScrollView({ axis: 'y', height: 0, flex: 1, content });
  const footer = new Box({ padding: { left: 14, right: 14, top: 8, bottom: 12 } });
  const active = (): boolean => !disposed && host.overlay.current === view;
  const busy = (): boolean => loading || !!pending;
  const locked = (): boolean => !!pending || unconfirmed;
  const equipped = () => {
    const snapshot = data;
    return snapshot?.characters.find(character => character.owned && character.equipped
      && character.id === snapshot.profile.preferences.characterId);
  };
  const leave = (callback: (() => void) | undefined): void => {
    if (!active() || locked() || !callback) return;
    disposed = true; callback();
  };
  const cancel = (): void => {
    if (!active() || locked()) return;
    quote = undefined; retry = undefined; message = '已返回商店。'; scroll.physics.snapTo(0); paint();
  };
  const back = (): void => { if (quote) cancel(); else leave(actions.onBack); };
  const showQuote = (offer: MarketOffer): void => {
    if (!active() || busy() || unconfirmed || catalogChanged || !data || !offerAvailable(offer)) return;
    quote = { offer, version: data.catalogVersion }; retry = undefined;
    message = '请核对商品与报价，确认后由服务器处理。'; scroll.physics.snapTo(0); paint();
  };
  const confirm = (): void => {
    if (!active() || busy() || !quote || !service) return;
    quote.requestId ??= service.newRequestId();
    void run({ kind: 'buy', id: quote.offer.id, requestId: quote.requestId, version: quote.version });
  };
  const paint = (): void => {
    if (!active()) return;
    for (const child of [...header.children]) header.remove(child);
    for (const child of [...content.children]) content.remove(child);
    for (const child of [...footer.children]) footer.remove(child);
    if (mode === 'characters') footer.add(new WelfareAction(host, '开始跑酷', () => {
      const current = equipped();
      if (!busy() && current) leave(() => actions.onStartRun?.(current.id));
    }, !busy() && !locked() && !!equipped() && !!actions.onStartRun));
    header.add(new WelfareAction(host, quote ? '取消' : '返回', back, !locked(), coast.paper, 64),
      new Box({ width: 0, flex: 1 }, [text(quote ? '确认购买' : names[mode], 22)]),
      new WelfareAction(host, '刷新', () => { void load(); }, !!service && !busy(), coast.paper, 64));
    content.add(new Box({ background: host.solidSkin, backgroundColor: coast.foam, padding: 14, gap: 6 }, [
      text('海滨跑酷俱乐部', 12, coast.sea), text(quote ? '确认本次补给' : intros[mode], 22),
      text(mode === 'settings' ? '主题选择会保存到云端。' : '余额与收藏以服务器记录为准。', 13, coast.muted),
    ]));
    if (data) content.add(text(`金币 ${data.profile.wallet.coin}  ·  钻石 ${data.profile.wallet.diamond}`, 16));
    const notice = new Box({ background: host.solidSkin, backgroundColor: coast.paper, padding: 12, gap: 8 }, [
      text(message, 13, coast.muted),
    ]);
    if (loadFailed) notice.add(new WelfareAction(host, '重试加载', () => { void load(); }, !busy()));
    if (retry && retry.kind !== 'buy') {
      const operation = retry;
      notice.add(new WelfareAction(host, operation.kind === 'equip' ? '重试出战' : '重试保存',
        () => { void run(operation); }, !busy()));
    }
    content.add(notice);
    if (!data) return;
    if (quote) {
      content.add(commerceCard(host, [...offerDetails(quote.offer, artwork),
        text('确认后才会扣除对应资源。', 13, coast.muted),
        new WelfareAction(host, pending ? '购买中…' : quote.requestId ? '重试购买' : '确认购买', confirm, !busy()),
        new WelfareAction(host, '返回商店', cancel, !locked(), coast.foam),
      ], true));
      return;
    }
    if (mode === 'shop') {
      const tabs = new Box({ direction: 'row', gap: 8 });
      for (const [key, title] of [['character', '角色'], ['exchange', '兑换']] as const) {
        tabs.add(new Box({ width: 0, flex: 1 }, [new WelfareAction(host, title, () => {
          if (!active() || busy()) return;
          category = key; scroll.physics.snapTo(0); paint();
        }, !busy(), category === key ? coast.gold : coast.paper)]));
      }
      content.add(tabs);
      const offers = data.offers.filter(offer => offer.category === category);
      if (!offers.length) content.add(text('暂无商品', 16, coast.muted));
      for (const offer of offers) content.add(offerCard(host, offer, busy() || unconfirmed || catalogChanged, () => showQuote(offer), artwork));
    } else if (mode === 'settings') {
      if (!data.themes.length) content.add(text('暂无可选主题', 16, coast.muted));
      for (const theme of data.themes) content.add(themeCard(host, theme, busy(), () => { void run({ kind: 'theme', id: theme.id }); }, artwork));
    } else {
      const characters = mode === 'inventory' ? data.characters.filter(character => character.owned) : data.characters;
      if (mode === 'characters') {
        const selected = equipped();
        content.add(text(selected ? `当前出战：${selected.name}` : '暂无出战角色', 15));
      }
      if (mode === 'inventory') {
        content.add(text(`道具 ${data.items.length}`, 16), text('钥匙和碎片可在商店兑换，拥有的角色可直接出战。', 12, coast.muted));
        if (actions.onShop) content.add(new WelfareAction(host, '前往商店',
          () => leave(() => actions.onShop!(data!.profile.preferences.characterId)), !busy()));
        if (!data.items.length) content.add(text('暂无道具', 15, coast.muted));
        for (const item of data.items) content.add(inventoryCard(host, item));
      }
      content.add(text(mode === 'inventory' ? `拥有角色 ${characters.length}` : `全部角色 ${characters.length}`, 16));
      if (!characters.length) content.add(text('暂无角色', 15, coast.muted));
      for (const character of characters) content.add(characterCard(host, character, busy(),
        () => { void run({ kind: 'equip', id: character.id }); },
        actions.onShop ? () => { if (!busy()) leave(() => actions.onShop!(character.id)); } : undefined,
        artwork, pending?.kind === 'equip' && pending.id === character.id));
    }
  };
  const load = async (): Promise<void> => {
    if (!service || !active() || busy()) return;
    loading = true; quote = undefined; retry = undefined; loadFailed = false; message = '加载中…'; paint();
    try {
      const snapshot = await service.load();
      if (!active()) return;
      data = snapshot; catalogChanged = false; unconfirmed = false; message = '已同步服务器记录。';
    } catch (error) {
      if (!active()) return;
      const code = errorCode(error);
      if (definiteRejections.has(code)) unconfirmed = false;
      loadFailed = true;
      if (code === 'CATALOG_CHANGED') {
        catalogChanged = true; message = '商品报价已更新，请刷新后重新确认购买。';
      } else message = data ? '刷新失败，已保留当前内容。' : '加载失败，请重试。';
    } finally { loading = false; if (active()) paint(); }
  };
  const run = async (operation: Operation): Promise<void> => {
    if (!service || !data || !active() || busy()) return;
    if (operation.kind === 'equip' && !data.characters.some(character => character.id === operation.id && character.owned && !character.equipped)) return;
    if (operation.kind === 'theme' && !data.themes.some(theme => theme.id === operation.id && !theme.selected)) return;
    pending = operation; retry = undefined; loadFailed = false;
    message = operation.kind === 'buy' ? '购买处理中，请等待结果后再离开。'
      : operation.kind === 'equip' ? '正在保存出战角色，请等待。' : '正在保存主题，请等待。'; paint();
    let snapshot: CommerceSnapshot;
    try {
      snapshot = await (operation.kind === 'buy' ? service.buy(operation.id, operation.requestId, operation.version)
        : operation.kind === 'equip' ? service.equip(operation.id) : service.selectTheme(operation.id));
    } catch (error) {
      pending = undefined;
      if (!active()) return;
      const code = errorCode(error);
      if (operation.kind === 'buy') unconfirmed = !definiteRejections.has(code);
      if (operation.kind === 'buy' && code === 'CATALOG_CHANGED') {
        catalogChanged = true; quote = undefined;
        message = '商品报价已更新，请刷新后重新确认购买。';
      } else if (operation.kind === 'buy' && code === 'PENDING_PURCHASE') {
        quote = undefined; message = '上一笔交易尚未确认，请刷新商店。';
      } else if (operation.kind === 'buy' && code === 'PURCHASE_NOT_SAVED') {
        retry = operation; message = '本地记录保存失败，购买未发送。请检查存储后重试。';
      } else {
        retry = operation;
        message = operation.kind === 'buy' ? unconfirmed ? '购买结果尚未确认，请重试或刷新后再离开。' : '购买失败，可重试或刷新。'
          : operation.kind === 'equip' ? '出战保存失败，请重试或刷新。' : '主题保存失败，请重试或刷新。';
      }
      paint(); return;
    }
    pending = undefined;
    if (!active()) return;
    data = snapshot; quote = undefined; unconfirmed = false;
    message = operation.kind === 'buy' ? '购买完成，余额与仓库已更新。'
      : operation.kind === 'equip' ? '出战角色已保存。' : '主题已保存。';
    paint();
    if (operation.kind === 'equip' && equipped()?.id === operation.id) actions.onSelected?.(operation.id);
    if (operation.kind === 'theme' && data.themes.some(theme => theme.id === operation.id && theme.selected)) {
      if (actions.onThemeSelected?.(operation.id) === false && active()) {
        message = '主题已保存，当前场景暂未更新。'; paint();
      }
    }
  };
  view.add(new Box({ height: { percent: 100 }, background: host.solidSkin, backgroundColor: coast.sand },
    [header, scroll, ...(mode === 'characters' ? [footer] : [])]));
  host.mount(view); paint();
  if (service) void load();
  return () => { disposed = true; };
}
