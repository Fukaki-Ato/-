const { reject } = require('./run-policy.cjs');
const { createCatalog, marketView } = require('./market-catalog.cjs');
const { receiptIdFor, matchReceipt, purchase, selectPreference } = require('./market-policy.cjs');
const PURCHASES = 'thunder_purchases';

function createMarketStore(db, profiles) {
  return {
    async market(playerId, initialize, event, runtime, now) {
      const catalog = createCatalog(runtime);
      return db.runTransaction(async transaction => {
        const receipt = event.action === 'market.buy'
          ? transaction.collection(PURCHASES).doc(receiptIdFor(playerId, event.requestId)) : null;
        const saved = receipt ? (await receipt.get()).data : null;
        const player = transaction.collection(profiles).doc(playerId);
        const { data: existing } = await player.get();
        const timestamp = now();
        let profile = existing ?? initialize(timestamp), changed = false;
        if (saved) {
          // Match before checking today's catalogue or limit; a confirmed retry
          // must never be charged again, including after a deployment reprices it.
          matchReceipt(saved, event, playerId);
        } else if (event.action === 'market.buy') {
          if (event.catalogVersion !== catalog.version) reject('CATALOG_CHANGED');
          const offer = catalog.offers.find(item => item.id === event.offerId);
          if (!offer) reject('OFFER_UNAVAILABLE');
          profile = purchase(profile, offer, runtime, timestamp); changed = true;
          await receipt.set({ data: { playerId, requestId: event.requestId, offerId: event.offerId,
            catalogVersion: event.catalogVersion, createdAt: new Date(timestamp).toISOString() } });
        } else if (event.action !== 'market.get') {
          const selected = selectPreference(profile, event, runtime, timestamp);
          profile = selected.profile; changed = selected.changed;
        }
        if (!existing || changed) await player.set({ data: profile });
        return marketView(profile, runtime, catalog, timestamp);
      });
    },
  };
}

module.exports = { createMarketStore, PURCHASES };
