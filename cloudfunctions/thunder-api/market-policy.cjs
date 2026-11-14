const { createHash } = require('node:crypto');
const { reject } = require('./run-policy.cjs');
const { offerStatus, balance, liveCharacters } = require('./market-catalog.cjs');
const { touchProfile } = require('./welfare-policy.cjs');

const receiptIdFor = (playerId, requestId) => createHash('sha256').update(JSON.stringify([playerId, requestId])).digest('hex');

function copyProfile(profile) {
  const { _id, ...stored } = profile;
  return structuredClone(stored);
}

function matchReceipt(receipt, event, playerId) {
  if (receipt.playerId !== playerId || receipt.requestId !== event.requestId
    || receipt.offerId !== event.offerId || receipt.catalogVersion !== event.catalogVersion) reject('PURCHASE_CONFLICT');
}

function purchase(profile, offer, runtime, timestamp) {
  const next = copyProfile(profile), periodId = runtime.getMissionPeriods(timestamp).daily.periodId;
  const status = offerStatus(offer, next, periodId);
  if (status.code) reject(status.code);
  for (const [item, amount] of Object.entries(offer.price)) {
    const target = ['coin', 'diamond'].includes(item) ? next.wallet : next.inventory.items;
    target[item] = balance(next, item) - amount;
  }
  for (const grant of offer.grants) {
    if (grant.item.startsWith('char_')) next.inventory.characters.push(grant.item);
    else {
      const total = balance(next, grant.item) + grant.amount;
      if (!Number.isSafeInteger(total)) reject('PROFILE_LIMIT');
      const target = ['coin', 'diamond'].includes(grant.item) ? next.wallet : next.inventory.items;
      target[grant.item] = total;
    }
  }
  next.commerce ??= { once: {}, daily: { periodId, counts: {} } };
  if (next.commerce.daily.periodId !== periodId) next.commerce.daily = { periodId, counts: {} };
  if (offer.limit.once) next.commerce.once[offer.id] = true;
  if (offer.limit.perDay) next.commerce.daily.counts[offer.id] = (next.commerce.daily.counts[offer.id] ?? 0) + 1;
  return touchProfile(next, timestamp);
}

function selectPreference(profile, event, runtime, timestamp) {
  const next = copyProfile(profile);
  let key, id;
  if (event.action === 'character.equip') {
    key = 'characterId'; id = event.characterId;
    if (!liveCharacters(runtime).some(character => character.id === id)) reject('INVALID_CHARACTER');
    if (!next.inventory.characters.includes(id)) reject('CHARACTER_NOT_OWNED');
  } else {
    key = 'themeId'; id = event.themeId;
    if (!runtime.themes.items.some(theme => theme.id === id && theme.status !== 'retired')) reject('INVALID_THEME');
  }
  if (next.preferences[key] === id) return { profile: next, changed: false };
  next.preferences[key] = id;
  return { profile: touchProfile(next, timestamp), changed: true };
}

module.exports = { receiptIdFor, copyProfile, matchReceipt, purchase, selectPreference };
