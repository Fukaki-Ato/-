const { createHash } = require('node:crypto');
const { publicProfile } = require('./profile.cjs');
const liveCharacters = runtime => runtime.content.characters.items
  .filter(item => item.id.startsWith('char_') && item.kind !== 'skin' && item.status === 'live');
const displayName = item => item.name?.['zh-CN'] ?? item.id;
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const positive = value => Number.isSafeInteger(value) && value > 0;

function itemName(id, runtime) {
  const currency = { coin: '金币', diamond: '钻石', key: '钥匙' };
  if (currency[id]) return currency[id];
  const shard = runtime.economy.params.shards.find(item => item.id === id);
  if (shard) {
    const character = runtime.content.characters.items.find(item => item.id === shard.grants);
    return `${character ? displayName(character) : shard.grants}碎片`;
  }
  const item = [...runtime.content.characters.items, ...runtime.content.items.items].find(item => item.id === id);
  return item ? displayName(item) : `道具（${id}）`;
}

function balance(profile, item) {
  return (['coin', 'diamond'].includes(item) ? profile.wallet[item] : profile.inventory.items[item]) ?? 0;
}

function createCatalog(runtime) {
  const characters = liveCharacters(runtime), ids = new Set(characters.map(item => item.id));
  const shards = runtime.economy.params.shards.filter(item => ids.has(item.grants));
  const recycling = runtime.economy.params.shop.shardRecycling;
  const supportedItem = id => ['coin', 'diamond', 'key'].includes(id) || shards.some(item => item.id === id);
  const sources = [
    ...characters.filter(item => item.unlock?.type === 'coin').map(item => ({
      id: `unlock_coin_${item.id}`, price: { coin: item.unlock.cost },
      give: [{ item: item.id, n: 1 }], limit: { once: true },
    })),
    ...shards.map(item => ({ id: `unlock_shard_${item.grants}`, price: { [item.id]: item.need['1'] },
      give: [{ item: item.grants, n: 1 }], limit: { once: true } })),
    ...(recycling ? shards.map(item => ({ id: `recycle_${item.id}`, price: { [item.id]: recycling.bundle },
      give: [{ item: 'coin', n: recycling.coin }], limit: { perDay: recycling.perDay } })) : []),
    ...runtime.economy.params.shop.offers,
  ];
  const offers = sources.map(source => {
    if (!source.id || !Object.keys(source.price).length
      || Object.values(source.price).some(value => !positive(value)) || !source.give.length
      || source.give.some(grant => !positive(grant.n))
      || (source.limit?.perDay !== undefined && !positive(source.limit.perDay))) throw new Error('Invalid market offer');
    const grants = source.give.map(grant => ({ item: grant.item, amount: grant.n, name: itemName(grant.item, runtime) }));
    let unsupportedReason = null;
    if (source.requiresEvent) unsupportedReason = '活动与皮肤尚未开放';
    else if (Object.keys(source.price).some(id => !supportedItem(id))) unsupportedReason = '兑换材料尚未开放';
    else if (grants.some(grant => grant.item.startsWith('char_') ? !ids.has(grant.item) || grant.amount !== 1
      : !supportedItem(grant.item))) unsupportedReason = '该道具的使用功能尚未开放';
    return { id: source.id, category: grants.some(grant => grant.item.startsWith('char_')) ? 'character' : 'exchange',
      title: grants.map(grant => grant.name).join('、'),
      description: grants.some(grant => grant.item.startsWith('char_')) ? '永久解锁角色' : '游戏内货币确定性交换',
      price: { ...source.price }, grants, limit: { ...source.limit }, unsupportedReason };
  });
  if (new Set(offers.map(offer => offer.id)).size !== offers.length) throw new Error('Duplicate market offer');
  const version = `market-v1-${createHash('sha256').update(canonical(offers)).digest('hex')}`;
  return { offers, version };
}

function offerStatus(offer, profile, periodId) {
  const owned = offer.grants.some(grant => grant.item.startsWith('char_') && profile.inventory.characters.includes(grant.item));
  const spent = profile.commerce?.daily?.periodId === periodId ? profile.commerce.daily.counts[offer.id] ?? 0 : 0;
  const once = offer.limit.once && profile.commerce?.once?.[offer.id];
  const remaining = offer.limit.once ? (owned || once ? 0 : 1)
    : offer.limit.perDay ? Math.max(0, offer.limit.perDay - spent) : null;
  const code = offer.unsupportedReason ? 'OFFER_UNAVAILABLE' : owned ? 'ALREADY_OWNED'
    : remaining === 0 ? 'PURCHASE_LIMIT' : Object.entries(offer.price).some(([item, n]) => balance(profile, item) < n)
      ? 'INSUFFICIENT_FUNDS' : null;
  const unavailableReason = offer.unsupportedReason ?? ({ ALREADY_OWNED: '已拥有该角色',
    PURCHASE_LIMIT: '已达到兑换次数上限', INSUFFICIENT_FUNDS: '余额或材料不足' }[code] ?? null);
  return { owned, remaining, canPurchase: code === null, unavailableReason, code };
}

function marketView(profile, runtime, catalog, timestamp) {
  const periodId = runtime.getMissionPeriods(timestamp).daily.periodId;
  return { profile: publicProfile(profile), catalogVersion: catalog.version,
    offers: catalog.offers.map(offer => {
      const { code, ...status } = offerStatus(offer, profile, periodId);
      return { id: offer.id, category: offer.category, title: offer.title, description: offer.description,
        price: { ...offer.price }, priceText: Object.entries(offer.price).map(([id, amount]) => `${itemName(id, runtime)}×${amount}`).join(' + '),
        grants: offer.grants.map(grant => ({ ...grant })), ...status };
    }),
    characters: liveCharacters(runtime).map(character => ({ id: character.id, name: displayName(character),
      tagline: character.tagline?.['zh-CN'] ?? '', rarity: character.rarity,
      owned: profile.inventory.characters.includes(character.id), equipped: profile.preferences.characterId === character.id })),
    items: Object.entries(profile.inventory.items).filter(([, amount]) => amount > 0)
      .sort(([a], [b]) => a.localeCompare(b)).map(([id, amount]) => ({ id, amount, name: itemName(id, runtime) })),
    themes: runtime.themes.items.filter(theme => theme.status !== 'retired').map(theme => ({
      id: theme.id, name: displayName(theme), selected: profile.preferences.themeId === theme.id })),
  };
}

module.exports = { createCatalog, marketView, offerStatus, balance, liveCharacters };
