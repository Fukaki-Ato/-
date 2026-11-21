const { ensureWelfare, touchProfile, welfareView, claimWelfare } = require('./welfare-policy.cjs');
const { freeCharacterIds, syncFreeCharacters } = require('./profile.cjs');

function createWelfareStore(db, profiles) {
  return {
    async welfare(playerId, initialize, event, runtime, now) {
      return db.runTransaction(async transaction => {
        const timestamp = now();
        const player = transaction.collection(profiles).doc(playerId);
        const { data: existing } = await player.get();
        const synced = syncFreeCharacters(existing ?? initialize(timestamp), freeCharacterIds(runtime.content.characters));
        const state = ensureWelfare(synced.profile, runtime, timestamp);
        const claimed = event.action === 'welfare.get' ? false : claimWelfare(state.profile, event);
        const changed = synced.changed || state.changed || claimed;
        const profile = existing && changed ? touchProfile(state.profile, timestamp) : state.profile;
        if (!existing || changed) await player.set({ data: profile });
        return welfareView(profile, runtime, timestamp);
      });
    },
  };
}

module.exports = { createWelfareStore };
