const COLLECTION = 'thunder_profiles';
const { createRunStore } = require('./run-store.cjs');
const { createWelfareStore } = require('./welfare-store.cjs');
const { createMarketStore } = require('./market-store.cjs');

function createCloudBaseStore(cloud) {
  // wx-server-sdk defaults to throwing on a missing doc. Transactions must read
  // an absent player as empty data, without swallowing unrelated DB errors.
  const db = cloud.database({ throwOnNotFound: false });
  return {
    ...createRunStore(db, COLLECTION),
    ...createWelfareStore(db, COLLECTION),
    ...createMarketStore(db, COLLECTION),
    async getOrCreate(playerId, initialize) {
      // wx-server-sdk (not @cloudbase/node-sdk) resolves the callback value
      // directly, after commit; its default conflict-only retry count is 3.
      return db.runTransaction(async transaction => {
        const document = transaction.collection(COLLECTION).doc(playerId);
        const { data } = await document.get();
        if (data) return data;
        const profile = initialize();
        await document.set({ data: profile });
        return profile;
      });
    },
  };
}

module.exports = { COLLECTION, createCloudBaseStore };
